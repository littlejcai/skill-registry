#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path, { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { imageSize, parseArgs, requireArg, sha256File } from './core.mjs';

function commandPath(name) {
  const result = spawnSync('which', [name], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || `${command} 执行失败`);
  return result.stdout;
}

export function normalizeIllustration({ input, output }) {
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
  } else throw new Error('缺少图片规范化工具：请安装 ImageMagick，或在 macOS 使用系统 sips');
  const size = imageSize(target);
  if (!size || size.format !== 'jpeg' || size.width !== 870 || size.height !== 660) throw new Error(`规范化结果必须是 870x660 JPEG，实际为 ${JSON.stringify(size)}`);
  return { output: target, ...size, sha256: sha256File(target) };
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  try {
    const args = parseArgs(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(normalizeIllustration({ input: requireArg(args, 'input'), output: requireArg(args, 'output') }), null, 2)}\n`);
  } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
