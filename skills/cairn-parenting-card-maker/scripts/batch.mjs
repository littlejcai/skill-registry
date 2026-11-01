#!/usr/bin/env node
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path, { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, readJson, requireArg, writeJson } from './core.mjs';
import { fileSource, getnoteSource, inlineSource, sourceDocument } from './source.mjs';
import { renderPackage } from './render.mjs';

const STATUSES = new Set(['prepared', 'review', 'ready', 'rendered', 'material-thin', 'failed']);

function prepare(args) {
  const manifest = readJson(resolve(requireArg(args, 'manifest'))); const output = resolve(requireArg(args, 'output'));
  if (manifest.schemaVersion !== '1.0.0' || manifest.kind !== 'batch-manifest' || !Array.isArray(manifest.items)) throw new Error('批量清单必须是 batch-manifest@1.0.0');
  const batchRoot = mkdtempSync(path.join(os.tmpdir(), 'conversation-card-batch-')); chmodSync(batchRoot, 0o700); writeFileSync(resolve(batchRoot, '.conversation-card-maker-run.json'), '{"generator":"conversation-card-maker"}\n');
  const seen = new Set(); const items = [];
  for (let index = 0; index < manifest.items.length; index += 1) {
    const item = manifest.items[index]; const id = String(item.id ?? `item-${index + 1}`);
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(id) || seen.has(id)) { items.push({ id, status: 'failed', error: 'item id 非法或重复' }); continue; }
    seen.add(id); const workDir = resolve(batchRoot, id); const sourceFile = resolve(workDir, 'source.json');
    try {
      const input = item.input ?? {}; const kinds = [input.inline !== undefined, input.file !== undefined, input.getnote !== undefined].filter(Boolean).length;
      if (kinds !== 1) throw new Error('input 必须且只能包含 inline、file、getnote 之一');
      if (item.preset !== undefined && item.preset !== 'parent-talk') throw new Error('当前仅支持 parent-talk');
      const source = input.inline !== undefined ? inlineSource(String(input.inline), { title: item.title }) : input.file !== undefined ? fileSource(String(input.file), { title: item.title }) : getnoteSource(String(input.getnote));
      writeJson(sourceFile, sourceDocument(source)); const status = source.evidenceLevel === 'material_thin' ? 'material-thin' : 'prepared';
      items.push({ id, status, preset: 'parent-talk', deck: item.deck ?? null, sourceId: source.sourceId, evidenceLevel: source.evidenceLevel, privacyStatus: source.privacyStatus, workDir, sourceFile });
    } catch (error) { items.push({ id, status: 'failed', error: error instanceof Error ? error.message : String(error) }); }
  }
  const report = { schemaVersion: '1.0.0', kind: 'batch-state', preparedAt: new Date().toISOString(), temporaryRoot: batchRoot, items, summary: Object.fromEntries([...STATUSES].map((status) => [status, items.filter((item) => item.status === status).length])) };
  writeJson(output, report); return { output, temporaryRoot: batchRoot, items: items.length, summary: report.summary };
}

async function render(args) {
  const state = readJson(resolve(requireArg(args, 'state'))); const output = resolve(requireArg(args, 'output'));
  if (state.schemaVersion !== '1.0.0' || state.kind !== 'batch-state' || !Array.isArray(state.items)) throw new Error('状态文件必须是 batch-state@1.0.0');
  const items = [];
  for (const item of state.items) {
    if (item.status !== 'ready') { items.push({ id: item.id, status: item.status, nextAction: item.status === 'review' ? 'review' : item.status === 'material-thin' ? 'stop' : undefined }); continue; }
    try {
      const rendered = await renderPackage({ input: item.candidateSet, assetRoot: item.assetRoot, outputDir: item.outputDir });
      items.push({ id: item.id, status: 'rendered', nextAction: 'complete', theme: 'talkcard-paper-v1', candidateCount: rendered.cards, artifactPath: rendered.html });
    } catch (error) { items.push({ id: item.id, status: 'failed', nextAction: 'stop', error: error instanceof Error ? error.message : String(error) }); }
  }
  const report = { schemaVersion: '1.0.0', kind: 'batch-report', renderedAt: new Date().toISOString(), items, summary: { rendered: items.filter((item) => item.status === 'rendered').length, failed: items.filter((item) => item.status === 'failed').length, skipped: items.filter((item) => !['rendered', 'failed'].includes(item.status)).length } };
  writeJson(output, report); return { output, summary: report.summary };
}

async function main() {
  const args = parseArgs(process.argv.slice(2)); const action = requireArg(args, 'action');
  const result = action === 'prepare' ? prepare(args) : action === 'render' ? await render(args) : (() => { throw new Error('--action 仅支持 prepare 或 render'); })();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
