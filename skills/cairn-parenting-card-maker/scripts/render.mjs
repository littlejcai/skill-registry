#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path, { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  findSystemBrowserExecutable,
  imageSize,
  PACKAGE_GENERATOR,
  parseArgs,
  readJson,
  requireArg,
  sha256,
  sha256File,
  skillRoot,
  themeCssFile,
  validateCandidateSet,
  walkFiles,
  writeJson,
} from './core.mjs';

const viewerFile = resolve(skillRoot, 'assets/viewer.html');
const mimeFor = (file) => /\.jpe?g$/iu.test(file) ? 'image/jpeg' : /\.png$/iu.test(file) ? 'image/png' : null;
const dataUrl = (file) => { const mime = mimeFor(file); if (!mime) throw new Error(`不支持的图片格式：${path.extname(file)}`); return `data:${mime};base64,${readFileSync(file).toString('base64')}`; };
const escapeHtml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const safeJson = (value) => JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
const within = (root, target) => { const rel = path.relative(root, target); return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)); };

function ownedPackage(directory) {
  const manifest = resolve(directory, 'manifest.json');
  if (!existsSync(manifest)) return false;
  try { return JSON.parse(readFileSync(manifest, 'utf8')).generator === PACKAGE_GENERATOR; } catch { return false; }
}
export function assertReplaceableTarget(target) {
  const destination = resolve(target);
  if (!existsSync(destination) || readdirSync(destination).length === 0) return;
  if (!ownedPackage(destination)) throw new Error(`拒绝覆盖未知目录：${destination}；缺少本 Skill 的 manifest 标记`);
}
export function createStagingDirectory(target) {
  const destination = resolve(target);
  return mkdtempSync(resolve(dirname(destination), `.${basename(destination)}.staging-`));
}
export function atomicReplaceDirectory(staging, target) {
  const source = resolve(staging); const destination = resolve(target); assertReplaceableTarget(destination);
  const backup = resolve(dirname(destination), `.${basename(destination)}.backup-${randomUUID()}`); let backedUp = false;
  try {
    if (existsSync(destination)) { renameSync(destination, backup); backedUp = true; }
    renameSync(source, destination);
    if (backedUp) rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (!existsSync(destination) && backedUp && existsSync(backup)) renameSync(backup, destination);
    throw error;
  }
  return destination;
}

export function preparePackage({ input, assetRoot, outputDir, includeReview = false }) {
  const root = resolve(assetRoot); const destination = resolve(outputDir); const validation = validateCandidateSet(readJson(resolve(input)));
  if (!validation.valid) throw new Error(`候选数据校验失败：\n${validation.errors.map((item) => item.message).join('\n')}`);
  if (validation.nextAction !== 'complete' && !includeReview) throw new Error(`候选仍需 ${validation.nextAction}，不得提前渲染；人工确认后可显式使用 --include-review`);
  const candidateSet = validation.normalized; const allowed = new Set(includeReview ? ['selected', 'review'] : ['selected']);
  const candidates = candidateSet.candidates.filter((candidate) => allowed.has(candidate.decision));
  if (candidates.length === 0) throw new Error('没有可打包的 selected 卡牌');
  const categories = new Map(candidateSet.categories.map((category) => [category.id, category])); const assets = new Map();
  const cards = candidates.map((candidate) => {
    const card = candidate.card;
    if (!card?.illustration?.file) throw new Error(`${candidate.candidateId} 缺少 card.illustration.file`);
    const sourceImage = resolve(root, card.illustration.file);
    if (!within(root, sourceImage)) throw new Error(`${candidate.candidateId} 的插画路径越出 asset-root`);
    if (!existsSync(sourceImage) || !/\.jpe?g$/iu.test(sourceImage)) throw new Error(`${candidate.candidateId} 的插画不存在或不是 JPEG：${sourceImage}`);
    const category = categories.get(card.categoryId); if (!category) throw new Error(`${candidate.candidateId} 引用了未知分类 ${card.categoryId}`);
    const relativeIllustration = `cards/${candidate.candidateId}/illustration.jpg`; assets.set(candidate.candidateId, { sourceImage, relativeIllustration });
    return {
      id: candidate.candidateId, decision: candidate.decision, title: card.title, audience: card.audience,
      category: { id: category.id, label: category.label, color: category.color, lines: category.lines }, front: { text: card.front.text },
      back: { sections: card.back.sections.map((section) => ({ id: section.id, label: section.label, ...(section.note ? { note: section.note } : {}), ...(section.audience ? { audience: section.audience } : {}), ...(section.audienceLabel ? { audienceLabel: section.audienceLabel } : {}), body: section.body })) },
      illustration: { file: relativeIllustration, alt: card.illustration.alt }, evidenceLevel: candidateSet.source.evidenceLevel, sourceId: candidateSet.source.sourceId,
    };
  });
  const cardSet = {
    schemaVersion: '2.1.0', preset: 'parent-talk', deck: candidateSet.deck,
    source: { sourceId: candidateSet.source.sourceId, sourceType: candidateSet.source.sourceType, sourceTitle: candidateSet.source.sourceTitle, evidenceLevel: candidateSet.source.evidenceLevel, requiresSourceConfirmation: Boolean(candidateSet.source.requiresSourceConfirmation) },
    generatedAt: new Date().toISOString(), cards,
  };
  mkdirSync(destination, { recursive: true });
  for (const [cardId, asset] of assets) {
    const target = resolve(destination, asset.relativeIllustration); mkdirSync(dirname(target), { recursive: true }); copyFileSync(asset.sourceImage, target); assets.set(cardId, { ...asset, outputImage: target });
  }
  writeJson(resolve(destination, 'card-set.json'), cardSet); return { cardSet, assets, outputDir: destination, validation };
}

export function writeViewerHtml({ cardSet, outputDir, downloads = new Map(), outputFile = 'cards.html' }) {
  const template = readFileSync(viewerFile, 'utf8'); const css = readFileSync(themeCssFile, 'utf8');
  const cards = cardSet.cards.map((card) => {
    const imageFile = resolve(outputDir, card.illustration.file); if (!existsSync(imageFile)) throw new Error(`打包插画不存在：${imageFile}`);
    const download = downloads.get(card.id) ?? {};
    return { ...card, illustration: { ...card.illustration, dataUrl: dataUrl(imageFile) }, downloads: { front: download.front && existsSync(download.front) ? dataUrl(download.front) : '', back: download.back && existsSync(download.back) ? dataUrl(download.back) : '' } };
  });
  const viewerData = { schemaVersion: cardSet.schemaVersion, deck: cardSet.deck, sourceTitle: cardSet.source.sourceTitle, cards };
  const html = template.replace('__DOCUMENT_TITLE__', escapeHtml(`${cardSet.deck.title} · ${cardSet.source.sourceTitle}`)).replace('__THEME_CSS__', css).replace('__CARD_DATA__', safeJson(viewerData));
  const target = resolve(outputDir, outputFile); writeFileSync(target, html); return target;
}

async function launchChromium() {
  let chromium;
  try { ({ chromium } = await import('playwright-core')); } catch { throw new Error('缺少 playwright-core；请先在 Skill 目录运行 npm install'); }
  const systemBrowser = findSystemBrowserExecutable();
  if (systemBrowser) return chromium.launch({ headless: true, executablePath: systemBrowser });
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    throw new Error(`未找到可用的 Chrome、Edge 或 Chromium。可设置 CHROME_PATH、EDGE_PATH 或 CHROMIUM_PATH 指向本机浏览器；只有机器上完全没有 Chromium 内核浏览器时，才需要运行 npx playwright install chromium。原始错误：${error instanceof Error ? error.message : String(error)}`);
  }
}
async function loadOffline(page, htmlFile, consoleErrors, networkRequests) {
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('request', (request) => { if (/^https?:/iu.test(request.url())) networkRequests.push(request.url()); });
  await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load' }); await page.waitForFunction(() => Boolean(window.cardStudio));
}
async function fitOrFail(page, cardId) {
  const result = await page.evaluate((id) => {
    window.cardStudio.show(id, 'front');
    for (const level of ['normal', 'compact', 'tight']) { window.cardStudio.fit(level); const measured = window.cardStudio.measure(); if (!measured.frontOverflow && !measured.backOverflow) return { level, measured }; }
    return { level: 'overflow', measured: window.cardStudio.measure() };
  }, cardId);
  if (result.level === 'overflow') { const error = new Error(`layout-overflow：${cardId} 在 tight 级别仍溢出 ${JSON.stringify(result.measured)}`); error.code = 'layout-overflow'; throw error; }
  return result;
}
export async function captureCardImages({ htmlFile, cardSet, outputDir }) {
  const browser = await launchChromium(); const files = []; const layoutFits = []; const consoleErrors = []; const networkRequests = [];
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, reducedMotion: 'reduce', colorScheme: 'light' });
    const page = await context.newPage(); await loadOffline(page, htmlFile, consoleErrors, networkRequests); await page.evaluate(() => { document.body.dataset.capture = 'true'; });
    await page.evaluate(async () => { await Promise.all([...document.images].map((image) => image.decode?.().catch(() => undefined))); });
    for (const card of cardSet.cards) {
      const fit = await fitOrFail(page, card.id); layoutFits.push({ cardId: card.id, ...fit }); const cardDir = resolve(outputDir, 'cards', card.id); mkdirSync(cardDir, { recursive: true });
      for (const face of ['front', 'back']) {
        await page.evaluate(({ id, targetFace, fitLevel }) => { window.cardStudio.show(id, targetFace); window.cardStudio.fit(fitLevel); }, { id: card.id, targetFace: face, fitLevel: fit.level });
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
        await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });
        const file = resolve(cardDir, `card-${face}.png`); const surface = page.locator('#captureSurface');
        let previous = await surface.screenshot({ animations: 'disabled', omitBackground: true }); let stable = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
          const current = await surface.screenshot({ animations: 'disabled', omitBackground: true });
          if (sha256(previous) === sha256(current)) { stable = current; break; }
          previous = current;
        }
        if (!stable) throw new Error(`重复截图哈希不稳定：${card.id}/${face}`);
        writeFileSync(file, stable);
        const size = imageSize(file); if (!size || size.format !== 'png' || size.width !== 1080 || size.height !== 1620) throw new Error(`导出尺寸错误：${file} ${JSON.stringify(size)}`);
        files.push({ cardId: card.id, face, file, ...size, sha256: sha256File(file), stableHash: true, fitLevel: fit.level });
      }
    }
    await context.close();
  } finally { await browser.close(); }
  if (consoleErrors.length > 0) throw new Error(`HTML 控制台错误：${consoleErrors.join(' | ')}`);
  if (networkRequests.length > 0) throw new Error(`离线 HTML 发起了网络请求：${networkRequests.join(' | ')}`);
  return { files, layoutFits, consoleErrors, networkRequests };
}
async function verifyViewport(browser, htmlFile, viewport, expectedCount, expectedDeckTitle, detailed) {
  const consoleErrors = []; const networkRequests = []; const context = await browser.newContext({ viewport, reducedMotion: 'reduce' }); const page = await context.newPage();
  await loadOffline(page, htmlFile, consoleErrors, networkRequests);
  if (await page.evaluate(() => window.cardStudio.getCardCount()) !== expectedCount) throw new Error('HTML 卡牌数量错误');
  if ((await page.locator('#deckTitle').textContent())?.trim() !== expectedDeckTitle) throw new Error('卡组标题不一致');
  if (await page.locator('#captureSurface').evaluate((node) => node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight)) throw new Error('查看器布局溢出');
  if (detailed) {
    await page.locator('#flipper').click(); if (await page.locator('#card').getAttribute('data-face') !== 'back') throw new Error('点击翻面失败');
    await page.locator('#flipper').press('Enter'); if (await page.locator('#card').getAttribute('data-face') !== 'front') throw new Error('Enter 翻面失败');
    await page.locator('#flipper').press(' '); if (await page.locator('#card').getAttribute('data-face') !== 'back') throw new Error('Space 翻面失败');
    if (expectedCount > 1) {
      for (const selector of ['#previousButton', '#nextButton', '#position']) if (!(await page.locator(selector).isVisible())) throw new Error(`多卡模式下 ${selector} 未显示`);
      await page.locator('#nextButton').click(); if (await page.locator('#card').getAttribute('data-face') !== 'front') throw new Error('背面换卡后未回到正面');
      if ((await page.locator('#position').textContent())?.trim() !== `2 / ${expectedCount}`) throw new Error('下一张交互失败');
      await page.locator('#previousButton').click();
    } else for (const selector of ['#previousButton', '#nextButton', '#position']) if (await page.locator(selector).isVisible()) throw new Error(`单卡模式下 ${selector} 不应显示`);
    const series = (await page.locator('#frontSeries').textContent())?.trim(); const backHeading = (await page.locator('.back-heading').textContent())?.trim();
    if (!series || !backHeading?.includes(series)) throw new Error('正反面缺少卡组名称');
    for (const [selector, suffix] of [['#downloadFront', '-front.png'], ['#downloadBack', '-back.png']]) {
      const href = await page.locator(selector).getAttribute('href'); const filename = await page.locator(selector).getAttribute('download');
      if (!href?.startsWith('data:image/png;base64,') || !filename?.endsWith(suffix)) throw new Error(`${selector} 下载数据或文件名错误`);
    }
  }
  await context.close();
  if (consoleErrors.length > 0 || networkRequests.length > 0) throw new Error(`HTML 非离线或有控制台错误：${[...consoleErrors, ...networkRequests].join(' | ')}`);
}
export async function verifyInteractiveHtml({ htmlFile, expectedCount, expectedDeckTitle }) {
  const browser = await launchChromium();
  try {
    await verifyViewport(browser, htmlFile, { width: 390, height: 844 }, expectedCount, expectedDeckTitle, true);
    await verifyViewport(browser, htmlFile, { width: 1280, height: 900 }, expectedCount, expectedDeckTitle, false);
  } finally { await browser.close(); }
  return { mobile: '390x844', desktop: '1280x900', clickFlip: true, enterFlip: true, spaceFlip: true, navigation: expectedCount > 1, singleCardNavigationHidden: expectedCount === 1, switchResetsFace: expectedCount > 1, deckMark: true, downloads: true, offline: true, noOverflow: true };
}

export async function renderPackage({ input, assetRoot, outputDir, includeReview = false }) {
  const destination = resolve(outputDir); assertReplaceableTarget(destination); const staging = createStagingDirectory(destination);
  try {
    const prepared = preparePackage({ input, assetRoot, outputDir: staging, includeReview }); const htmlFile = writeViewerHtml(prepared);
    const captured = await captureCardImages({ htmlFile, cardSet: prepared.cardSet, outputDir: staging }); const downloads = new Map();
    for (const item of captured.files) { const current = downloads.get(item.cardId) ?? {}; current[item.face] = item.file; downloads.set(item.cardId, current); }
    writeViewerHtml({ cardSet: prepared.cardSet, outputDir: staging, downloads });
    const interaction = await verifyInteractiveHtml({ htmlFile, expectedCount: prepared.cardSet.cards.length, expectedDeckTitle: prepared.cardSet.deck.title });
    const report = { schemaVersion: '2.1.0', sourceId: prepared.cardSet.source.sourceId, preset: 'parent-talk', deck: prepared.cardSet.deck, html: 'cards.html', interaction, layoutFits: captured.layoutFits, files: captured.files.map((item) => ({ ...item, file: relative(staging, item.file).split(path.sep).join('/') })) };
    writeJson(resolve(staging, 'render-report.json'), report);
    const manifestFile = resolve(staging, 'manifest.json'); const files = walkFiles(staging).filter((file) => resolve(file) !== manifestFile).map((file) => ({ path: relative(staging, file).split(path.sep).join('/'), bytes: statSync(file).size, sha256: sha256File(file), ...(imageSize(file) ? { image: imageSize(file) } : {}) }));
    writeJson(manifestFile, { generator: PACKAGE_GENERATOR, schemaVersion: '2.1.0', sourceId: prepared.cardSet.source.sourceId, preset: 'parent-talk', deck: prepared.cardSet.deck, generatedAt: new Date().toISOString(), files });
    atomicReplaceDirectory(staging, destination);
    return { html: resolve(destination, 'cards.html'), cardSet: resolve(destination, 'card-set.json'), manifest: resolve(destination, 'manifest.json'), cards: prepared.cardSet.cards.length, interaction, nextAction: prepared.validation.nextAction };
  } catch (error) { rmSync(staging, { recursive: true, force: true }); throw error; }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await renderPackage({ input: requireArg(args, 'input'), assetRoot: requireArg(args, 'asset-root'), outputDir: requireArg(args, 'output-dir'), includeReview: args['include-review'] === true });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 1; }
}
