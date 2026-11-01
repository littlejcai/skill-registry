#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  parseArgs,
  parseJsonPreservingLargeIntegers,
  readJson,
  requireArg,
  sha256,
  validateCandidateSet,
  writeJson,
} from './core.mjs';

function run(args) {
  const result = spawnSync(process.env.GETNOTE_BIN || 'getnote', args, { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `getnote 退出码 ${result.status}`);
  return parseJsonPreservingLargeIntegers(result.stdout);
}
function sanitizeContent(value) {
  return typeof value !== 'string' ? '' : value
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^)]*(?:Expires|OSSAccessKeyId|Signature)[^)]*)\)/giu, (_match, alt) => `[embedded image omitted${alt ? `: ${alt}` : ''}]`)
    .replace(/https?:\/\/[^\s<>)"']*(?:Expires|OSSAccessKeyId|Signature)=[^\s<>)"']*/giu, '[signed URL omitted]');
}
function normalizeNote(note, fallbackId) {
  const content = sanitizeContent(note?.content); const id = String(fallbackId ?? note?.note_id ?? '');
  return {
    sourceNoteId: id, sourceUrl: `https://biji.com/note/${id}`, title: String(note?.title ?? ''), noteType: String(note?.note_type ?? ''),
    createdAt: String(note?.created_at ?? ''), updatedAt: String(note?.updated_at ?? ''), tags: Array.isArray(note?.tags) ? note.tags.map(String) : [],
    content, contentSha256: sha256(content), childrenCount: Number(note?.children_count ?? 0), childrenIds: Array.isArray(note?.children_ids) ? note.children_ids.map(String) : [],
    attachments: Array.isArray(note?.attachments) ? note.attachments.map((item) => ({ type: String(item?.type ?? ''), title: String(item?.title ?? ''), duration: Number(item?.duration ?? 0) })) : [],
  };
}

function exportSource(args) {
  const output = resolve(requireArg(args, 'output')); const noteId = typeof args['note-id'] === 'string' ? args['note-id'].trim() : ''; const kbId = typeof args['kb-id'] === 'string' ? args['kb-id'].trim() : '';
  if ((noteId ? 1 : 0) + (kbId ? 1 : 0) !== 1) throw new Error('必须且只能提供 --note-id 或 --kb-id');
  if (noteId) {
    const raw = run(['note', noteId, '-o', 'json']); const note = raw?.data?.note; if (!raw?.success || !note) throw new Error('Get笔记未返回有效 note');
    writeJson(output, { schemaVersion: '1.0.0', kind: 'getnote-note', exportedAt: new Date().toISOString(), note: normalizeNote(note, noteId) });
  } else {
    const raw = run(['kb', kbId, '--all', '-o', 'json']); const notes = raw?.data?.notes; if (!raw?.success || !Array.isArray(notes)) throw new Error('Get笔记未返回有效 notes 数组');
    writeJson(output, { schemaVersion: '1.0.0', kind: 'getnote-kb', knowledgeBaseId: kbId, exportedAt: new Date().toISOString(), total: Number(raw?.data?.total ?? notes.length), notes: notes.map((note) => normalizeNote(note, note?.note_id)) });
  }
  return { output };
}
function searchDuplicates(args) {
  const input = readJson(resolve(requireArg(args, 'input'))); const kbId = requireArg(args, 'kb-id'); const output = resolve(requireArg(args, 'output')); const results = [];
  for (const candidate of (Array.isArray(input.candidates) ? input.candidates : []).filter((item) => item.decision !== 'rejected')) {
    const queries = candidate.duplicateCheck?.queries;
    if (!Array.isArray(queries) || queries.length < 3 || queries.length > 6 || queries.some((query) => typeof query !== 'string' || !query.trim())) throw new Error(`${candidate.candidateId} 必须提供 3–6 条去重查询`);
    results.push({ candidateId: candidate.candidateId, scope: 'target-collection', status: 'not-checked', note: '无命中只表示未发现，不证明全库唯一；命中需人工判断', searches: queries.map((query) => ({ query, response: run(['search', query, '--kb', kbId, '--limit', '10', '-o', 'json']) })) });
  }
  writeJson(output, { schemaVersion: '1.0.0', knowledgeBaseId: kbId, searchedAt: new Date().toISOString(), results }); return { output, candidates: results.length };
}
function preparePackage(args) {
  const input = readJson(resolve(requireArg(args, 'input'))); const output = resolve(requireArg(args, 'output')); const validation = validateCandidateSet(input);
  if (!validation.valid || validation.nextAction !== 'complete') throw new Error('只有 nextAction=complete 的亲子候选集可生成 Get笔记写入草稿');
  const set = validation.normalized; const cards = set.candidates.filter((candidate) => candidate.decision === 'selected').map((candidate) => {
    const lines = [`# ${candidate.card.title}`, '', `> ${candidate.card.front.text}`, '', ...candidate.card.back.sections.flatMap((section) => [`## ${section.label}`, section.body, '']), '---', `来源：${set.source.sourceTitle}`, `来源 ID：${set.source.sourceId}`, `证据级别：${set.source.evidenceLevel}`];
    if (set.source.sourceUrl) lines.push(`来源链接：${set.source.sourceUrl}`); const content = lines.join('\n').trim();
    return { candidateId: candidate.candidateId, title: candidate.card.title, content, contentSha256: sha256(content) };
  });
  writeJson(output, { schemaVersion: '1.0.0', kind: 'getnote-dry-run-package', sourceId: set.source.sourceId, cards }); return { output, cards: cards.length };
}
function noteId(response) { return String(response?.data?.note_id ?? response?.data?.note?.note_id ?? response?.note_id ?? ''); }
function writePackage(args) {
  const input = readJson(resolve(requireArg(args, 'input'))); const output = resolve(requireArg(args, 'output')); const targetKb = requireArg(args, 'target-kb-id'); const apply = args.apply === true;
  if (apply && args.authorized !== true) throw new Error('--apply 还必须显式提供 --authorized，以确认本次用户授权');
  const cards = Array.isArray(input.cards) ? input.cards : [];
  if (cards.length === 0 || cards.some((card) => typeof card.title !== 'string' || typeof card.content !== 'string')) throw new Error('输入必须包含非空 cards[{title,content}]');
  const results = [];
  for (const card of cards) {
    if (!apply) { results.push({ candidateId: card.candidateId, action: 'dry-run', targetKb, title: card.title, contentSha256: card.contentSha256 }); continue; }
    const saved = run(['save', card.content, '--title', card.title, '-o', 'json']); const id = noteId(saved); if (!id) throw new Error(`${card.candidateId} 保存后未返回 note id`);
    run(['kb', 'add', targetKb, id]); const readBack = run(['note', id, '-o', 'json']);
    if (!readBack?.success || String(readBack?.data?.note?.title ?? '') !== card.title) throw new Error(`${card.candidateId} 回读验证失败`);
    results.push({ candidateId: card.candidateId, action: 'applied-and-verified', cardNoteId: id, targetKb });
  }
  const report = { schemaVersion: '1.0.0', mode: apply ? 'apply' : 'dry-run', targetKb, results }; writeJson(output, report); return { output, mode: report.mode, cards: results.length };
}

async function main() {
  const args = parseArgs(process.argv.slice(2)); const action = requireArg(args, 'action');
  const handlers = { export: exportSource, search: searchDuplicates, prepare: preparePackage, write: writePackage };
  if (!handlers[action]) throw new Error('--action 仅支持 export、search、prepare、write');
  process.stdout.write(`${JSON.stringify(handlers[action](args), null, 2)}\n`);
}
const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
