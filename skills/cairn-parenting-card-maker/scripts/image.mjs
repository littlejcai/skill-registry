#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path, { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findSystemBrowserExecutable, imageSize, parseArgs, readJson, requireArg, sha256File, skillRoot } from './core.mjs';

const STYLE_REFERENCE = resolve(skillRoot, 'assets/style-reference.jpg');
const SUBJECT_MODES = new Set(['girl', 'boy', 'mixed-group', 'child-adult', 'object-detail', 'environment-metaphor']);
const SHOTS = new Set(['wide', 'medium', 'close', 'detail']);

const clean = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim() : fallback;

export function buildIllustrationPrompt(candidate) {
  if (!candidate?.card || candidate.decision === 'rejected') throw new Error('只能为 selected 或 review 候选构造插画提示词');
  const plan = candidate.illustrationPlan ?? {};
  const subjectMode = SUBJECT_MODES.has(plan.subjectMode) ? plan.subjectMode : 'child-adult';
  const shot = SHOTS.has(plan.shot) ? plan.shot : 'medium';
  const scene = clean(plan.scene, candidate.card.front?.text ?? candidate.theme ?? '亲子日常对话');
  const action = clean(plan.action, '人物用自然克制的动作表达正在思考或交流');
  const setting = clean(plan.setting, '简化的日常生活环境');
  const composition = clean(plan.composition, '主体位于画面中下部，保留呼吸感和大块安静留白');
  const palette = clean(plan.palette, candidate.card.categoryColor ?? '低饱和粉彩底色，深蓝灰线条，最多一个暖色小点缀');

  const prompt = [
    'Create ONE single-frame horizontal editorial illustration for a parent-child conversation card.',
    'STYLE LOCK — match the supplied Talkcard style board, but do not copy any character or scene from it:',
    '- flat, quiet pastel color field as the dominant background;',
    '- hand-drawn dark blue-gray pencil/ink contour lines, slightly imperfect and warm;',
    '- sparse colored-pencil fill, mostly unpainted white clothing and objects;',
    '- simplified everyday forms, restrained facial expression, generous negative space;',
    '- 2 to 4 main colors, soft daylight, low contrast, almost no background texture;',
    '- editorial vignette, not a fully rendered storybook scene.',
    '',
    `CARD IDEA: ${candidate.card.title} — ${candidate.card.front?.text ?? ''}`,
    `SCENE: ${scene}`,
    `SUBJECT MODE: ${subjectMode}. The subject is fictional and must not resemble a real child.`,
    `ACTION: ${action}`,
    `SETTING: ${setting}`,
    `SHOT: ${shot}.`,
    `COMPOSITION: ${composition}`,
    `PALETTE: ${palette}`,
    '',
    'OUTPUT RULES:',
    '- one continuous scene only; never output a collage, grid, split panel, mockup, card frame or UI;',
    '- no words, letters, numbers, punctuation, signs, logos, badges, school emblems or watermarks;',
    '- no anime, manga, Ghibli imitation, glossy digital painting, 3D, photorealism or cinematic lighting;',
    '- no dense environment, atmospheric watercolor wash, grainy full-frame paper texture, dramatic shadows or saturated black/red clothing;',
    '- no oversized sparkling eyes, chibi proportions, beauty-poster pose or centered character portrait;',
    '- preserve natural anatomy and clear hands; keep important action inside a safe crop.',
    'Landscape 4:3 illustration. No typography.',
  ].join('\n');

  return {
    prompt,
    referenceImage: STYLE_REFERENCE,
    referenceUse: '将该图作为风格板随提示词传给生图模型；只学习线条、平涂、留白和简化程度，不复制人物、场景或四宫格布局。',
    acceptance: [
      '单一横向场景，不是拼贴、卡片或界面',
      '背景以低饱和平涂色块为主，没有整幅水彩雾化或复杂环境',
      '深蓝灰手绘轮廓清楚，填色克制，整体接近风格板',
      '人物身份、数量、动作与本卡内容一致，不默认复用同一个男孩',
      '无文字、标志、校徽、水印、明显肢体错误或真实可识别儿童',
      '与同批已通过插画的线条粗细、背景密度、对比度相近',
    ],
  };
}

export function promptForCandidateSet(input, candidateId) {
  const candidates = Array.isArray(input?.candidates) ? input.candidates : [];
  const candidate = candidates.find((item) => item.candidateId === candidateId);
  if (!candidate) throw new Error(`找不到候选：${candidateId}`);
  return { candidateId, ...buildIllustrationPrompt(candidate) };
}

function commandPath(name) {
  const command = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(command, [name], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return '';
  return (result.stdout || '').split(/\r?\n/u).map((value) => value.trim()).find(Boolean) ?? '';
}
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || `${command} 执行失败`);
  return result.stdout;
}

function sniffMime(file) {
  const bytes = readFileSync(file);
  if (bytes.length >= 3 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) return 'image/png';
  return 'image/jpeg';
}

// 不需要额外安装任何图片工具的规范化路径：复用渲染环节本就必需的 Chromium。
// 把图片以 data: URL 注入空白页，画到 870x660 canvas 上居中裁切后导出 JPEG 88。
export async function normalizeWithBrowser({ source, target }) {
  let chromium;
  try { ({ chromium } = await import('playwright-core')); } catch { throw new Error('缺少 playwright-core；请先在 Skill 目录运行 npm install'); }
  const executablePath = findSystemBrowserExecutable();
  if (!executablePath) throw new Error('未找到 Chrome、Edge 或 Chromium：图片规范化复用渲染所用的浏览器；可用 CHROME_PATH、EDGE_PATH 或 CHROMIUM_PATH 指定');
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const browserContext = await browser.newContext({ viewport: { width: 870, height: 660 }, deviceScaleFactor: 1 });
    const page = await browserContext.newPage();
    await page.setContent('<!doctype html><meta charset="utf-8"><title>normalize</title>');
    const dataUrl = `data:${sniffMime(source)};base64,${readFileSync(source).toString('base64')}`;
    const encoded = await page.evaluate(async ({ dataUrl }) => {
      const image = new Image();
      image.src = dataUrl;
      if (typeof image.decode === 'function') await image.decode();
      else await new Promise((done, fail) => { image.onload = done; image.onerror = () => fail(new Error('图片解码失败')); });
      if (!image.naturalWidth || !image.naturalHeight) throw new Error('图片尺寸为 0，无法规范化');
      const canvas = document.createElement('canvas');
      canvas.width = 870; canvas.height = 660;
      const surface = canvas.getContext('2d');
      surface.imageSmoothingEnabled = true; surface.imageSmoothingQuality = 'high';
      surface.fillStyle = '#ffffff'; surface.fillRect(0, 0, 870, 660);
      const scale = Math.max(870 / image.naturalWidth, 660 / image.naturalHeight);
      const width = image.naturalWidth * scale; const height = image.naturalHeight * scale;
      surface.drawImage(image, (870 - width) / 2, (660 - height) / 2, width, height);
      return canvas.toDataURL('image/jpeg', 0.88).split(',')[1];
    }, { dataUrl });
    writeFileSync(target, Buffer.from(encoded, 'base64'));
    await browserContext.close();
  } finally { await browser.close(); }
  return target;
}

export async function normalizeIllustration({ input, output }) {
  const source = resolve(input); const target = resolve(output);
  if (!existsSync(source)) throw new Error(`输入图片不存在：${source}`);
  if (source === target) throw new Error('输入和输出不能是同一文件');
  if (/\.svg$/iu.test(source)) throw new Error('输入必须是大模型生成的 PNG 或 JPEG；不接受 SVG 或程序化占位图');
  if (!/\.jpe?g$/iu.test(target)) throw new Error('输出文件必须使用 .jpg 或 .jpeg');
  mkdirSync(path.dirname(target), { recursive: true });
  const magick = commandPath('magick'); const sips = commandPath('sips');
  if (magick) {
    run(magick, [source, '-auto-orient', '-resize', '870x660^', '-gravity', 'center', '-extent', '870x660', '-strip', '-quality', '88', target]);
  } else if (sips) {
    const probe = run(sips, ['-g', 'pixelWidth', '-g', 'pixelHeight', source]);
    const width = Number(probe.match(/pixelWidth:\s*(\d+)/u)?.[1]); const height = Number(probe.match(/pixelHeight:\s*(\d+)/u)?.[1]);
    if (!width || !height) throw new Error('sips 无法读取输入图片尺寸');
    const targetRatio = 870 / 660; let cropWidth = width; let cropHeight = height;
    if (width / height > targetRatio) cropWidth = Math.round(height * targetRatio); else cropHeight = Math.round(width / targetRatio);
    const temporary = mkdtempSync(path.join(os.tmpdir(), 'conversation-card-')); const cropped = path.join(temporary, 'cropped.png');
    try {
      run(sips, ['--cropToHeightWidth', String(cropHeight), String(cropWidth), source, '--out', cropped]);
      run(sips, ['--resampleHeightWidth', '660', '870', '--setProperty', 'format', 'jpeg', '--setProperty', 'formatOptions', '88', cropped, '--out', target]);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  } else await normalizeWithBrowser({ source, target });
  const size = imageSize(target);
  if (!size || size.format !== 'jpeg' || size.width !== 870 || size.height !== 660) throw new Error(`规范化结果必须是 870x660 JPEG，实际为 ${JSON.stringify(size)}`);
  return { output: target, ...size, sha256: sha256File(target) };
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const action = typeof args.action === 'string' ? args.action : 'normalize';
    if (action === 'prompt') {
      const result = promptForCandidateSet(readJson(resolve(requireArg(args, 'input'))), requireArg(args, 'candidate-id'));
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else if (action === 'normalize') {
      process.stdout.write(`${JSON.stringify(await normalizeIllustration({ input: requireArg(args, 'input'), output: requireArg(args, 'output') }), null, 2)}\n`);
    } else throw new Error('--action 仅支持 prompt 或 normalize');
  } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
