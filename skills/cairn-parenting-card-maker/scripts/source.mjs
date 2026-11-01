#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path, { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  parseArgs,
  parseJsonPreservingLargeIntegers,
  requireArg,
  sha256,
  unique,
  writeJson,
} from './core.mjs';

export const RUN_MARKER = '.conversation-card-maker-run.json';

export function redactSensitiveContent(value) {
  const findings = []; let content = String(value ?? '');
  const replace = (pattern, label, type) => { content = content.replace(pattern, () => { findings.push(type); return label; }); };
  replace(/!\[([^\]]*)\]\((https?:\/\/[^)]*(?:Expires|OSSAccessKeyId|Signature)[^)]*)\)/giu, '[signed image omitted]', 'signed-url');
  replace(/\[[^\]]*\]\((https?:\/\/[^)]*(?:Expires|OSSAccessKeyId|Signature)[^)]*)\)/giu, '[signed link omitted]', 'signed-url');
  replace(/https?:\/\/[^\s<>)"']*(?:Expires|OSSAccessKeyId|Signature)=[^\s<>)"']*/giu, '[signed URL omitted]', 'signed-url');
  replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[email omitted]', 'email');
  replace(/(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/gu, '[phone omitted]', 'phone');
  replace(/(?:微信|QQ|账号|帐号|账户)\s*[：:]?\s*[A-Za-z0-9_-]{5,}/giu, '[account omitted]', 'account');
  return { content, findings: unique(findings) };
}

function dialogueMetadata(content) {
  const lines = content.split(/\r?\n/u); const turns = [];
  lines.forEach((line, index) => {
    const match = line.match(/^\s*([^：:]{1,20})[：:]\s*(.+)$/u);
    if (match) turns.push({ turn: turns.length + 1, line: index + 1, speaker: match[1].trim() });
  });
  return { lineCount: lines.length, nonEmptyLineCount: lines.filter((line) => line.trim()).length, turns };
}

function baseSource({ raw, sourceId, sourceType, sourceTitle, sourceUrl, createdAt = '', metadata = {} }) {
  const sanitized = redactSensitiveContent(raw); const dialogue = dialogueMetadata(sanitized.content);
  const evidenceLevel = dialogue.turns.length >= 2 ? 'high' : 'medium';
  return {
    sourceId, sourceType, ...(sourceUrl ? { sourceUrl } : {}), sourceTitle, createdAt,
    content: sanitized.content, contentSha256: sha256(sanitized.content), evidenceLevel,
    requiresSourceConfirmation: evidenceLevel !== 'high',
    privacyStatus: sanitized.findings.length > 0 ? 'needs-review' : 'clear',
    privacyFindings: sanitized.findings, metadata: { ...metadata, ...dialogue },
  };
}

export function inlineSource(raw, args = {}) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('stdin 对话内容不能为空');
  const sanitized = redactSensitiveContent(raw);
  return baseSource({
    raw, sourceId: `inline-${sha256(sanitized.content).slice(0, 16)}`, sourceType: 'inline-dialogue',
    sourceTitle: typeof args.title === 'string' && args.title.trim() ? args.title.trim() : '用户提供的对话',
  });
}

export function fileSource(file, args = {}) {
  const absolute = resolve(file);
  if (!existsSync(absolute)) throw new Error(`来源文件不存在：${absolute}`);
  const raw = readFileSync(absolute, 'utf8'); const extension = path.extname(absolute).toLowerCase();
  let content = raw; let inferredTitle = path.basename(absolute, extension); let sourceType = ['.md', '.markdown'].includes(extension) ? 'markdown' : 'text';
  if (extension === '.json') {
    sourceType = 'json'; const parsed = parseJsonPreservingLargeIntegers(raw);
    if (typeof parsed?.content === 'string') content = parsed.content;
    if (typeof parsed?.title === 'string' && parsed.title.trim()) inferredTitle = parsed.title;
  }
  if (!content.trim()) throw new Error('来源文件内容为空');
  const sanitized = redactSensitiveContent(content);
  return baseSource({
    raw: content,
    sourceId: typeof args['source-id'] === 'string' && args['source-id'].trim() ? args['source-id'].trim() : `file-${sha256(sanitized.content).slice(0, 16)}`,
    sourceType,
    sourceUrl: typeof args['source-url'] === 'string' ? args['source-url'] : undefined,
    sourceTitle: typeof args.title === 'string' && args.title.trim() ? args.title.trim() : inferredTitle,
    metadata: { originalFile: absolute },
  });
}

function runGetnote(args) {
  const result = spawnSync(process.env.GETNOTE_BIN || 'getnote', args, { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `getnote 退出码 ${result.status}`);
  return parseJsonPreservingLargeIntegers(result.stdout);
}

export function getnoteSource(noteId) {
  const raw = runGetnote(['note', noteId, '-o', 'json']); const note = raw?.data?.note;
  if (!raw?.success || !note) throw new Error('Get笔记未返回有效 note');
  const source = baseSource({
    raw: note.content, sourceId: String(noteId), sourceType: 'getnote', sourceUrl: `https://biji.com/note/${String(noteId)}`,
    sourceTitle: String(note.title ?? ''), createdAt: String(note.created_at ?? ''),
    metadata: {
      noteType: String(note.note_type ?? ''), updatedAt: String(note.updated_at ?? ''),
      sourceSegments: {
        body: { present: Boolean(String(note.content ?? '').trim()), provenance: 'note-body', directQuoteEligible: false },
        summary: { present: Boolean(String(note.summary ?? '').trim()), provenance: 'note-summary', directQuoteEligible: false },
        children: { count: Array.isArray(note.children_ids) ? note.children_ids.length : 0, provenance: 'child-note', expanded: false },
        attachments: { count: Array.isArray(note.attachments) ? note.attachments.length : 0, provenance: 'attachment-metadata', transcribed: false },
      },
      directQuotePolicy: '只有独立确认的逐字内容才能标记为 direct_quote。',
      tags: Array.isArray(note.tags) ? note.tags.map(String) : [],
      childrenIds: Array.isArray(note.children_ids) ? note.children_ids.map(String) : [],
      attachments: Array.isArray(note.attachments) ? note.attachments.map((item) => ({ type: String(item?.type ?? ''), title: String(item?.title ?? ''), duration: Number(item?.duration ?? 0) })) : [],
    },
  });
  source.evidenceLevel = 'medium'; source.requiresSourceConfirmation = true;
  source.metadata.sourceCompleteness = source.metadata.childrenIds.length > 0 ? 'children-unexpanded' : 'single-note';
  return source;
}

export function sourceDocument(source) {
  return { schemaVersion: '1.1.0', kind: 'conversation-source', importedAt: new Date().toISOString(), presetHint: 'parent-talk', source };
}

function temporaryOutput() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'conversation-card-maker-'));
  chmodSync(directory, 0o700); writeFileSync(resolve(directory, RUN_MARKER), `${JSON.stringify({ generator: 'conversation-card-maker' })}\n`);
  return resolve(directory, 'source.json');
}

function cleanup(sourceFile) {
  const directory = dirname(resolve(sourceFile)); const marker = resolve(directory, RUN_MARKER);
  if (!existsSync(marker)) throw new Error('拒绝清理：目标不是 conversation-card-maker 临时目录');
  const payload = JSON.parse(readFileSync(marker, 'utf8'));
  if (payload.generator !== 'conversation-card-maker') throw new Error('拒绝清理：临时目录标记无效');
  rmSync(directory, { recursive: true }); return { removed: directory };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.cleanup === 'string') { process.stdout.write(`${JSON.stringify(cleanup(args.cleanup))}\n`); return; }
  if (args.preset !== undefined && args.preset !== 'parent-talk') throw new Error('当前仅支持 --preset parent-talk');
  const useStdin = args.stdin === true; const file = typeof args.file === 'string' ? args.file.trim() : ''; const noteId = typeof args['getnote-note-id'] === 'string' ? args['getnote-note-id'].trim() : '';
  if ((useStdin ? 1 : 0) + (file ? 1 : 0) + (noteId ? 1 : 0) !== 1) throw new Error('必须且只能提供 --stdin、--file 或 --getnote-note-id');
  const retain = args['retain-source'] === true;
  if (retain && (typeof args.output !== 'string' || !args.output.trim())) throw new Error('--retain-source 必须同时提供 --output');
  if (!retain && typeof args.output === 'string') throw new Error('长期保存原文必须显式添加 --retain-source；默认请省略 --output');
  const output = retain ? resolve(args.output) : temporaryOutput();
  const source = useStdin ? inlineSource(readFileSync(0, 'utf8'), args) : noteId ? getnoteSource(noteId) : fileSource(file, args);
  writeJson(output, sourceDocument(source));
  process.stdout.write(`${JSON.stringify({ output, retention: retain ? 'retained' : 'temporary', sourceId: source.sourceId, evidenceLevel: source.evidenceLevel, privacyStatus: source.privacyStatus }, null, 2)}\n`);
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 1; });
