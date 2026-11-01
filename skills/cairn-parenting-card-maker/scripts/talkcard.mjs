#!/usr/bin/env node
import { existsSync, rmSync } from 'node:fs';
import path, { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { imageSize, PACKAGE_GENERATOR, parseArgs, readJson, requireArg, sha256File, validateCandidateSet, writeJson } from './core.mjs';
import { normalizeIllustration } from './image.mjs';
import { atomicReplaceDirectory, createStagingDirectory } from './render.mjs';

const DECKS = new Set(['study-drive', 'study-method', 'rules-fairness', 'school-relations', 'self-awareness', 'family-life']);

export function exportTalkcardDraft({ input, assetRoot, outputDir, contentVersion, startNo }) {
  const number = Number(startNo);
  if (!Number.isInteger(number) || number < 1 || number > 99) throw new Error('--start-no 必须是 1..99 的整数');
  const validation = validateCandidateSet(readJson(resolve(input)));
  if (!validation.valid || validation.nextAction !== 'complete') throw new Error('只有校验完成且 nextAction=complete 的候选集可导出 Talkcard 草稿');
  const selected = validation.normalized.candidates.filter((candidate) => candidate.decision === 'selected');
  if (number + selected.length - 1 > 99) throw new Error('卡号超出 1..99');
  const destination = resolve(outputDir); const staging = createStagingDirectory(destination);
  try {
    const cards = [];
    for (let index = 0; index < selected.length; index += 1) {
      const candidate = selected[index]; const no = number + index; const source = resolve(assetRoot, candidate.card.illustration.file); const image = resolve(staging, `card-${String(no).padStart(2, '0')}.jpg`);
      if (!candidate.cardNoteId || !String(candidate.cardNoteId).trim()) throw new Error(`${candidate.candidateId} 缺少已验证 cardNoteId`);
      if (!DECKS.has(candidate.card.categoryId)) throw new Error(`${candidate.candidateId} 的牌堆不合法：${candidate.card.categoryId}`);
      if (!existsSync(source)) throw new Error(`${candidate.candidateId} 插画不存在`);
      normalizeIllustration({ input: source, output: image });
      const sections = new Map(candidate.card.back.sections.map((section) => [section.id, section]));
      for (const id of ['followup', 'deeper', 'observer']) if (!sections.has(id)) throw new Error(`${candidate.candidateId} 缺少 ${id}`);
      cards.push({
        id: `card-${String(no).padStart(2, '0')}`, no, title: candidate.card.title, deck: candidate.card.categoryId,
        illustration: `/cards/card-${String(no).padStart(2, '0')}.jpg`, age: candidate.card.audience, front: candidate.card.front.text,
        followup: sections.get('followup').body, dig: sections.get('deeper').body, parentNote: sections.get('observer').body,
        noteId: String(candidate.cardNoteId), status: 'draft', contentVersion,
      });
    }
    writeJson(resolve(staging, 'cards.json'), cards);
    writeJson(resolve(staging, 'validation-report.json'), { valid: true, contract: 'Talkcard Card', cards: cards.length, contentVersion, images: cards.map((card) => { const file = resolve(staging, path.basename(card.illustration)); return { file: path.basename(file), ...imageSize(file), sha256: sha256File(file) }; }) });
    writeJson(resolve(staging, 'manifest.json'), { generator: PACKAGE_GENERATOR, kind: 'talkcard-draft-bundle', schemaVersion: '1.0.0', files: ['cards.json', 'validation-report.json', ...cards.map((card) => path.basename(card.illustration))] });
    atomicReplaceDirectory(staging, destination); return { output: destination, cards: cards.length, officialDataChanged: false };
  } catch (error) { rmSync(staging, { recursive: true, force: true }); throw error; }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = exportTalkcardDraft({ input: requireArg(args, 'input'), assetRoot: requireArg(args, 'asset-root'), outputDir: requireArg(args, 'output-dir'), contentVersion: requireArg(args, 'content-version'), startNo: requireArg(args, 'start-no') });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
