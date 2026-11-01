#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path, { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const themeCssFile = resolve(skillRoot, 'assets/theme.css');
export const CANDIDATE_SCHEMA_VERSION = '2.1.0';
export const LEGACY_CANDIDATE_SCHEMA_VERSION = '2.0.0';
export const PACKAGE_GENERATOR = 'conversation-card-maker';

const PRESET = {
  name: 'parent-talk',
  scoreFields: ['childVoice', 'tension', 'generalizability', 'conversationPotential', 'parentInsight', 'distinctiveness'],
  requiredSections: ['followup', 'deeper', 'observer'],
  maxBodyLength: 120,
  defaultDeckTitle: '亲子话题卡',
  defaultTheme: 'talkcard-paper-v1',
  placeholderWords: ['TODO', 'TBD', 'PLACEHOLDER', 'LOREM', '占位', '待审校', '草稿', '示例', '测试'],
};

const HARD_GATES = ['evidence', 'independent', 'generalizable', 'openEnded', 'expandable', 'distinct', 'privacySafe'];
const EVIDENCE_KINDS = new Set(['direct_quote', 'source_summary', 'ai_inference']);
const DECISIONS = new Set(['selected', 'review', 'rejected']);
const DUPLICATE_SCOPES = new Set(['source-only', 'target-collection']);
const DUPLICATE_STATUSES = new Set(['clear', 'possible', 'duplicate', 'not-checked']);
const SOURCE_LEVELS = new Set(['high', 'medium', 'material_thin']);
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,95}$/u;
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const present = (value) => typeof value === 'string' && value.trim().length > 0;
const add = (list, code, message, candidateId) => list.push(candidateId ? { code, message, candidateId } : { code, message });

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`无法识别的参数：${token}`);
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else { args[key] = next; index += 1; }
  }
  return args;
}

export function requireArg(args, key) {
  const value = args[key];
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`缺少必填参数 --${key}`);
  return value;
}

export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
export function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
export function parseJsonPreservingLargeIntegers(raw) {
  return JSON.parse(raw.replace(/(:\s*)(-?\d{16,})(?=\s*[,}\]])/gu, (_match, prefix, digits) => `${prefix}"${digits}"`));
}
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const sha256File = (file) => sha256(readFileSync(file));
export const countUnicode = (value) => [...value].length;
export function imageSize(file) {
  const bytes = readFileSync(file);
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), format: 'png' };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1];
      if (marker === 0xd9 || marker === 0xda) return null;
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + length + 2 > bytes.length) return null;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5), format: 'jpeg' };
      }
      offset += length + 2;
    }
  }
  return null;
}
export function walkFiles(root) {
  const files = [];
  const visit = (current) => {
    for (const name of readdirSync(current).sort()) {
      if (name === '.DS_Store') continue;
      const full = path.join(current, name);
      const stat = statSync(full);
      if (stat.isDirectory()) visit(full); else if (stat.isFile()) files.push(full);
    }
  };
  if (existsSync(root)) visit(root);
  return files;
}
export const normalizeText = (value) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
export const unique = (values) => [...new Set(values)];
function characterBigrams(value) {
  const normalized = normalizeText(value);
  if (normalized.length < 2) return normalized ? [normalized] : [];
  return Array.from({ length: normalized.length - 1 }, (_unused, index) => normalized.slice(index, index + 2));
}
export function jaccardSimilarity(left, right) {
  const a = new Set(characterBigrams(left)); const b = new Set(characterBigrams(right));
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0; for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

export function getPreset(name) { return name === PRESET.name ? PRESET : null; }
export function defaultDeck() { return { title: PRESET.defaultDeckTitle, theme: PRESET.defaultTheme, locale: 'zh-CN' }; }
export function getTheme(name) {
  if (name !== PRESET.defaultTheme || !existsSync(themeCssFile)) return null;
  return { id: PRESET.defaultTheme, displayName: 'Talkcard 纸张', cssFile: themeCssFile };
}

function normalizeDuplicateCheck(candidate) {
  if (candidate?.duplicateCheck && typeof candidate.duplicateCheck === 'object') {
    return {
      scope: candidate.duplicateCheck.scope ?? 'source-only',
      status: candidate.duplicateCheck.status ?? 'not-checked',
      queries: Array.isArray(candidate.duplicateCheck.queries) ? candidate.duplicateCheck.queries : [],
      matches: Array.isArray(candidate.duplicateCheck.matches) ? candidate.duplicateCheck.matches : [],
    };
  }
  return { scope: 'source-only', status: candidate?.duplicateStatus ?? 'not-checked', queries: [], matches: [] };
}

export function normalizeCandidateSet(value) {
  if (!isObject(value)) return value;
  const normalized = structuredClone(value);
  normalized.schemaVersion = CANDIDATE_SCHEMA_VERSION;
  normalized.preset = normalized.preset ?? 'parent-talk';
  const defaults = defaultDeck();
  normalized.deck = {
    title: normalized.deck?.title ?? defaults.title,
    theme: normalized.deck?.theme ?? normalized.theme ?? defaults.theme,
    locale: normalized.deck?.locale ?? defaults.locale,
  };
  delete normalized.theme;
  normalized.source = {
    ...normalized.source,
    privacyStatus: normalized.source?.privacyStatus ?? 'clear',
    privacyFindings: Array.isArray(normalized.source?.privacyFindings) ? normalized.source.privacyFindings : [],
  };
  normalized.candidates = Array.isArray(normalized.candidates)
    ? normalized.candidates.map((candidate) => ({ ...candidate, duplicateCheck: normalizeDuplicateCheck(candidate) }))
    : normalized.candidates;
  return normalized;
}

function signature(candidate) {
  const card = candidate?.card ?? {};
  const sections = Array.isArray(card.back?.sections) ? card.back.sections : [];
  return {
    title: normalizeText(card.title),
    front: normalizeText(card.front?.text),
    tension: normalizeText(candidate?.theme),
    questions: normalizeText(sections.filter((section) => ['followup', 'deeper'].includes(section?.id)).map((section) => section.body).join('\n')),
  };
}
function compareCandidates(left, right) {
  const a = signature(left); const b = signature(right);
  const exact = Object.keys(a).filter((key) => a[key] && a[key] === b[key]);
  const similarities = Object.fromEntries(Object.keys(a).map((key) => [key, jaccardSimilarity(a[key], b[key])]));
  const high = Object.entries(similarities).filter(([, score]) => score >= 0.82).map(([key]) => key);
  return { duplicate: exact.length >= 1 || high.length >= 3 || (similarities.front >= 0.9 && similarities.questions >= 0.72), exact, similarities };
}
export function findSourceDuplicates(candidates) {
  const eligible = (Array.isArray(candidates) ? candidates : []).filter((candidate) => candidate && candidate.decision !== 'rejected' && candidate.card);
  const pairs = [];
  for (let left = 0; left < eligible.length; left += 1) {
    for (let right = left + 1; right < eligible.length; right += 1) {
      const result = compareCandidates(eligible[left], eligible[right]);
      if (result.duplicate) pairs.push({
        keep: eligible[left].candidateId,
        merge: eligible[right].candidateId,
        reasons: unique([
          ...result.exact.map((key) => `exact:${key}`),
          ...Object.entries(result.similarities).filter(([, score]) => score >= 0.82).map(([key, score]) => `similar:${key}:${score.toFixed(2)}`),
        ]),
      });
    }
  }
  return pairs;
}
export function mergeSourceDuplicates(candidates) {
  const cloned = structuredClone(Array.isArray(candidates) ? candidates : []); const pairs = findSourceDuplicates(cloned); const mergedIds = new Set();
  for (const pair of pairs) {
    if (mergedIds.has(pair.keep) || mergedIds.has(pair.merge)) continue;
    const kept = cloned.find((candidate) => candidate.candidateId === pair.keep); const merged = cloned.find((candidate) => candidate.candidateId === pair.merge);
    if (!kept || !merged) continue;
    kept.mergedSources = unique([...(kept.mergedSources ?? []), ...(merged.mergedSources ?? []), merged.candidateId, ...(merged.evidence ?? []).map((item) => item.locator).filter(Boolean)]);
    merged.decision = 'rejected';
    merged.rejectionReasons = unique([...(merged.rejectionReasons ?? []), `与 ${kept.candidateId} 为同一问题的近似表达`]);
    merged.duplicateCheck = { ...(merged.duplicateCheck ?? {}), scope: 'source-only', status: 'duplicate', matches: unique([...(merged.duplicateCheck?.matches ?? []), kept.candidateId]) };
    mergedIds.add(pair.merge);
  }
  return { candidates: cloned, pairs };
}

export function evidenceGate(evidence) {
  const directQuotes = []; const summaries = [];
  for (const item of Array.isArray(evidence) ? evidence : []) {
    if (!isObject(item) || !EVIDENCE_KINDS.has(item.kind) || !present(item.text)) continue;
    if (item.kind === 'direct_quote' && present(item.locator)) directQuotes.push(item.locator.trim());
    if (item.kind === 'source_summary' && present(item.locator)) summaries.push(item.locator.trim());
  }
  const summaryLocators = [...new Set(summaries)];
  return { passed: directQuotes.length >= 1 || summaryLocators.length >= 2, directQuoteLocators: unique(directQuotes), summaryLocators };
}
function sentenceCount(value) { return String(value).split(/[。！？!?]+/u).map((part) => part.trim()).filter(Boolean).length; }
function validateCategories(value, errors) {
  const categories = new Map();
  if (!Array.isArray(value) || value.length === 0) { add(errors, 'categories', 'categories 必须是非空数组'); return categories; }
  for (const category of value) {
    if (!isObject(category) || !present(category.id) || !SAFE_ID.test(category.id)) { add(errors, 'category-id', 'category.id 必须是安全的小写字母、数字和连字符'); continue; }
    if (categories.has(category.id)) add(errors, 'category-duplicate', `category.id 重复：${category.id}`);
    if (!present(category.label)) add(errors, 'category-label', `${category.id} 缺少 label`);
    if (!/^#[0-9a-f]{6}$/iu.test(category.color ?? '')) add(errors, 'category-color', `${category.id} 的 color 必须是六位十六进制颜色`);
    if (!Array.isArray(category.lines) || category.lines.length < 1 || category.lines.length > 3 || category.lines.some((line) => !present(line))) add(errors, 'category-lines', `${category.id} 的 lines 必须包含 1 至 3 个非空字符串`);
    categories.set(category.id, category);
  }
  return categories;
}
function validateCard(card, categories, errors, warnings, candidateId) {
  if (!isObject(card)) { add(errors, 'card-required', 'selected/review 候选必须包含 card 对象', candidateId); return; }
  if (!present(card.title)) add(errors, 'card-title', 'card.title 不能为空', candidateId);
  if (!present(card.audience)) add(errors, 'card-audience', 'card.audience 不能为空', candidateId);
  if (!present(card.categoryId) || !categories.has(card.categoryId)) add(errors, 'card-category', 'card.categoryId 必须引用 categories 中的分类', candidateId);
  if (!isObject(card.front) || !present(card.front.text)) add(errors, 'card-front', 'card.front.text 不能为空', candidateId);
  const sections = isObject(card.back) && Array.isArray(card.back.sections) ? card.back.sections : [];
  if (sections.length < 2) add(errors, 'card-sections', 'card.back.sections 至少需要两个区块', candidateId);
  const sectionIds = new Set();
  for (const section of sections) {
    if (!isObject(section) || !present(section.id) || !present(section.label) || !present(section.body)) { add(errors, 'card-section', '每个背面区块都必须包含 id、label 和 body', candidateId); continue; }
    if (!SAFE_ID.test(section.id)) add(errors, 'card-section-id', `区块 id 不安全：${section.id}`, candidateId);
    if (sectionIds.has(section.id)) add(errors, 'card-section-duplicate', `区块 id 重复：${section.id}`, candidateId);
    sectionIds.add(section.id);
  }
  for (const required of PRESET.requiredSections) if (!sectionIds.has(required)) add(errors, 'card-section-required', `缺少预设要求的背面区块：${required}`, candidateId);
  const front = String(card.front?.text ?? ''); const bodies = sections.map((section) => String(section?.body ?? ''));
  const bodyLength = countUnicode([front, ...bodies].join('').replace(/\s/gu, ''));
  if (bodyLength > PRESET.maxBodyLength) add(errors, 'card-length', `正反面正文共 ${bodyLength} 字，超过 ${PRESET.maxBodyLength} 字`, candidateId);
  if (/[？?][」”"']?$/u.test(front.trim())) add(errors, 'front-statement', '正面文案必须是陈述句', candidateId);
  for (const id of ['followup', 'deeper']) {
    const section = sections.find((item) => item?.id === id);
    if (section && !/[？?]$/u.test(section.body.trim())) add(errors, 'section-question', `${id} 必须以问号结尾`, candidateId);
  }
  const observer = sections.find((item) => item?.id === 'observer');
  if (observer?.audience !== 'adult-only') add(errors, 'observer-audience', 'observer 必须设置 audience=adult-only', candidateId);
  if (observer && sentenceCount(observer.body) > 2) add(errors, 'observer-sentences', 'observer 最多两句', candidateId);
  if (!isObject(card.illustration) || !present(card.illustration.file) || !present(card.illustration.alt)) add(warnings, 'illustration-missing', '卡牌尚未包含插画；生图后必须补齐', candidateId);
  else if (!/\.jpe?g$/iu.test(card.illustration.file)) add(errors, 'illustration-format', '插画必须是规范化后的 JPEG', candidateId);
  const blob = [card.title, front, ...bodies].join('\n').toUpperCase();
  const hits = PRESET.placeholderWords.filter((word) => blob.includes(word.toUpperCase()));
  if (hits.length > 0) add(errors, 'placeholder', `卡牌含占位标记：${hits.join('、')}`, candidateId);
}
function actionFor(errors, source, counts, candidates) {
  const reasons = [];
  if (errors.length > 0) reasons.push({ code: 'validation-errors', count: errors.length });
  if (source?.evidenceLevel === 'material_thin') reasons.push({ code: 'material-thin' });
  if (counts.selected + counts.review === 0) reasons.push({ code: 'no-qualified-candidates' });
  if (reasons.length > 0) return { nextAction: 'stop', reasons };
  if (source?.evidenceLevel === 'medium') reasons.push({ code: 'medium-source' });
  if (counts.review > 0) reasons.push({ code: 'review-candidates', count: counts.review });
  if (source?.privacyStatus !== 'clear') reasons.push({ code: 'privacy-review' });
  const unresolved = candidates.filter((candidate) => candidate.decision !== 'rejected' && ['possible', 'not-checked'].includes(candidate.duplicateStatus));
  if (unresolved.length > 0) reasons.push({ code: 'duplicate-review', candidates: unresolved.map((item) => item.candidateId) });
  return { nextAction: reasons.length > 0 ? 'review' : 'complete', reasons };
}

export function validateCandidateSet(input) {
  const errors = []; const warnings = []; const counts = { total: 0, selected: 0, review: 0, rejected: 0, duplicate: 0, materialThin: 0 };
  if (!isObject(input)) return { valid: false, nextAction: 'stop', reasons: [{ code: 'validation-errors', count: 1 }], errors: [{ code: 'root', message: 'candidate-set 根节点必须是对象' }], warnings, counts, candidates: [] };
  if (![CANDIDATE_SCHEMA_VERSION, LEGACY_CANDIDATE_SCHEMA_VERSION].includes(input.schemaVersion)) add(errors, 'schema-version', 'schemaVersion 必须是 2.0.0 或 2.1.0');
  const value = normalizeCandidateSet(input);
  if (!getPreset(value.preset)) add(errors, 'preset', '当前仅支持 parent-talk');
  if (!isObject(value.deck) || !present(value.deck.title) || !present(value.deck.theme) || !present(value.deck.locale)) add(errors, 'deck', 'deck 必须包含 title、theme、locale');
  else if (!getTheme(value.deck.theme)) add(errors, 'theme-unregistered', `主题未注册：${value.deck.theme}`);
  const source = value.source;
  if (!isObject(source)) add(errors, 'source', '缺少 source 对象');
  else {
    if (!present(source.sourceId)) add(errors, 'source-id', 'sourceId 必须是非空字符串');
    if (!present(source.sourceType)) add(errors, 'source-type', '缺少 sourceType');
    if (!present(source.sourceTitle)) add(errors, 'source-title', '缺少 sourceTitle');
    if (!SOURCE_LEVELS.has(source.evidenceLevel)) add(errors, 'evidence-level', 'evidenceLevel 必须是 high、medium 或 material_thin');
    if (source.evidenceLevel === 'medium' && source.requiresSourceConfirmation !== true) add(errors, 'source-confirmation', 'medium 证据必须设置 requiresSourceConfirmation=true');
    if (!['clear', 'needs-review'].includes(source.privacyStatus)) add(errors, 'privacy-status', 'privacyStatus 必须是 clear 或 needs-review');
    if (present(source.content) || present(source.rawContent) || present(source.transcript)) add(errors, 'raw-source-leak', 'candidate-set 不得包含完整原文');
    if (source.evidenceLevel === 'material_thin') counts.materialThin = 1;
  }
  const categories = validateCategories(value.categories, errors);
  if (!Array.isArray(value.candidates)) {
    add(errors, 'candidates', 'candidates 必须是数组');
    return { valid: false, nextAction: 'stop', reasons: [{ code: 'validation-errors', count: errors.length }], errors, warnings, counts, candidates: [], normalized: value };
  }
  counts.total = value.candidates.length;
  const duplicatePairs = findSourceDuplicates(value.candidates);
  for (const pair of duplicatePairs) add(errors, 'source-duplicate', `${pair.merge} 与 ${pair.keep} 表达同一问题，应先合并`, pair.merge);
  const seenIds = new Set(); const seenTitles = new Map(); const seenFronts = new Map(); const reports = [];
  for (const candidate of value.candidates) {
    if (!isObject(candidate)) { add(errors, 'candidate-object', '候选必须是对象'); continue; }
    const candidateId = present(candidate.candidateId) ? candidate.candidateId : undefined;
    if (!candidateId || !SAFE_ID.test(candidateId)) add(errors, 'candidate-id', 'candidateId 必须是安全的小写字母、数字和连字符');
    else if (seenIds.has(candidateId)) add(errors, 'candidate-id-duplicate', `candidateId 重复：${candidateId}`, candidateId); else seenIds.add(candidateId);
    if (!present(candidate.theme)) add(errors, 'candidate-theme', '候选缺少 theme', candidateId);
    if (!DECISIONS.has(candidate.decision)) add(errors, 'decision', 'decision 必须是 selected、review 或 rejected', candidateId);
    const duplicateCheck = candidate.duplicateCheck;
    if (!isObject(duplicateCheck) || !DUPLICATE_SCOPES.has(duplicateCheck.scope) || !DUPLICATE_STATUSES.has(duplicateCheck.status)) add(errors, 'duplicate-check', 'duplicateCheck 必须包含合法 scope 和 status', candidateId);
    if (!Array.isArray(duplicateCheck?.queries) || !Array.isArray(duplicateCheck?.matches)) add(errors, 'duplicate-check-arrays', 'duplicateCheck.queries 和 matches 必须是数组', candidateId);
    if (duplicateCheck?.status === 'duplicate') counts.duplicate += 1;
    const evidence = Array.isArray(candidate.evidence) ? candidate.evidence : [];
    if (evidence.length === 0) add(errors, 'evidence-empty', '候选至少需要一条证据', candidateId);
    for (const item of evidence) {
      if (!isObject(item) || !EVIDENCE_KINDS.has(item.kind) || !present(item.text)) add(errors, 'evidence-item', '证据必须包含合法 kind 和非空 text', candidateId);
      if (item?.kind === 'direct_quote' && !present(item.locator)) add(errors, 'direct-quote-locator', 'direct_quote 必须有 locator', candidateId);
      if (source?.sourceType === 'inline-dialogue' && item?.kind === 'direct_quote' && present(item.locator) && !/^(?:turn:\d+|line:\d+(?:-\d+)?)$/u.test(item.locator.trim())) add(errors, 'inline-quote-locator', 'inline direct_quote 的 locator 必须是 turn:N 或 line:N-M', candidateId);
    }
    const derivedEvidence = evidenceGate(evidence);
    if (candidate.decision !== 'rejected' && !derivedEvidence.passed) add(errors, 'evidence-grounding', '需要一条带 locator 的直接引语，或两条不同 locator 的来源摘要', candidateId);
    const gateValues = [];
    if (!isObject(candidate.hardGates)) add(errors, 'hard-gates', '缺少 hardGates 对象', candidateId);
    for (const field of HARD_GATES) {
      if (typeof candidate.hardGates?.[field] !== 'boolean') add(errors, 'hard-gate-field', `hardGates.${field} 必须是布尔值`, candidateId);
      gateValues.push(field === 'evidence' ? derivedEvidence.passed : candidate.hardGates?.[field] === true);
    }
    if (candidate.hardGates?.evidence !== derivedEvidence.passed) add(warnings, 'evidence-gate-derived', `hardGates.evidence 已由校验器计算为 ${derivedEvidence.passed}`, candidateId);
    let scoreTotal = 0; let scoreHasZero = false;
    if (!isObject(candidate.scores)) add(errors, 'scores', '缺少 scores 对象', candidateId);
    for (const field of PRESET.scoreFields) {
      const score = candidate.scores?.[field];
      if (!Number.isInteger(score) || score < 0 || score > 2) add(errors, 'score-field', `scores.${field} 必须是 0、1 或 2`, candidateId);
      else { scoreTotal += score; if (score === 0) scoreHasZero = true; }
    }
    if (candidate.scoreTotal !== scoreTotal) add(errors, 'score-total', `scoreTotal 应为 ${scoreTotal}，实际为 ${candidate.scoreTotal}`, candidateId);
    if (candidate.decision === 'selected') {
      counts.selected += 1;
      if (!gateValues.every(Boolean)) add(errors, 'selected-gates', 'selected 候选必须通过全部硬门槛', candidateId);
      if (scoreHasZero || scoreTotal < 9) add(errors, 'selected-score', 'selected 候选必须无 0 分且总分至少 9', candidateId);
      if (duplicateCheck?.status !== 'clear') add(errors, 'selected-duplicate', 'selected 候选的 duplicateCheck.status 必须是 clear', candidateId);
    } else if (candidate.decision === 'review') {
      counts.review += 1;
      if (!gateValues.every(Boolean)) add(errors, 'review-gates', 'review 候选必须通过全部硬门槛', candidateId);
      if (scoreHasZero || scoreTotal < 7) add(errors, 'review-score', 'review 候选必须无 0 分且总分至少 7', candidateId);
      if (duplicateCheck?.status === 'duplicate') add(errors, 'review-duplicate', 'duplicate 候选必须 rejected', candidateId);
    } else if (candidate.decision === 'rejected') {
      counts.rejected += 1;
      if (!Array.isArray(candidate.rejectionReasons) || candidate.rejectionReasons.length === 0) add(errors, 'rejection-reason', 'rejected 候选必须填写 rejectionReasons', candidateId);
    }
    if (candidate.decision !== 'rejected') {
      validateCard(candidate.card, categories, errors, warnings, candidateId);
      if (source?.evidenceLevel === 'medium' && candidate.status !== 'draft-needs-source-confirmation') add(errors, 'candidate-confirmation', 'medium 来源候选必须标记 draft-needs-source-confirmation', candidateId);
      const titleKey = normalizeText(candidate.card?.title); const frontKey = normalizeText(candidate.card?.front?.text);
      if (titleKey && seenTitles.has(titleKey)) add(errors, 'title-duplicate', `与 ${seenTitles.get(titleKey)} 标题重复`, candidateId); else if (titleKey) seenTitles.set(titleKey, candidateId);
      if (frontKey && seenFronts.has(frontKey)) add(errors, 'front-duplicate', `与 ${seenFronts.get(frontKey)} 正面重复`, candidateId); else if (frontKey) seenFronts.set(frontKey, candidateId);
    }
    reports.push({ candidateId, decision: candidate.decision, scoreTotal, evidence: derivedEvidence, duplicateStatus: duplicateCheck?.status });
  }
  if (source?.evidenceLevel === 'material_thin' && counts.selected + counts.review > 0) add(errors, 'material-thin-selection', 'material_thin 来源不能包含 selected 或 review 候选');
  return { valid: errors.length === 0, ...actionFor(errors, source, counts, reports), errors, warnings, counts, candidates: reports, duplicatePairs, normalized: value };
}

function commandCapability(name, args = ['--version']) {
  const result = spawnSync(name, args, { encoding: 'utf8' });
  return { available: !result.error && result.status === 0, detail: (result.stdout || result.stderr || result.error?.message || '').trim().split('\n')[0] };
}

function commandPath(name) {
  const command = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(command, [name], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return '';
  return (result.stdout || '').split(/\r?\n/u).map((value) => value.trim()).find(Boolean) ?? '';
}

export function browserExecutableCandidates() {
  const candidates = [process.env.CHROME_PATH, process.env.EDGE_PATH, process.env.CHROMIUM_PATH];
  if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      resolve(process.env.HOME || '/', 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      resolve(process.env.HOME || '/', 'Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
    );
  } else if (process.platform === 'win32') {
    const programFiles = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    for (const root of programFiles) {
      candidates.push(
        resolve(root, 'Google/Chrome/Application/chrome.exe'),
        resolve(root, 'Microsoft/Edge/Application/msedge.exe'),
        resolve(root, 'Chromium/Application/chrome.exe'),
        resolve(root, 'BraveSoftware/Brave-Browser/Application/brave.exe'),
      );
    }
  } else {
    for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable', 'brave-browser']) {
      candidates.push(commandPath(name));
    }
  }
  return [...new Set(candidates.filter((value) => typeof value === 'string' && value.trim() !== ''))];
}

export function findSystemBrowserExecutable() {
  return browserExecutableCandidates().find(existsSync) ?? '';
}

async function runtimeReport() {
  const playwrightCore = await import('playwright-core').then(() => ({ available: true, detail: 'module resolved; browser download is not included' })).catch((error) => ({ available: false, detail: error.message }));
  const browserExecutable = findSystemBrowserExecutable();
  return {
    node: { available: Number(process.versions.node.split('.')[0]) >= 18, detail: process.version },
    playwrightCore,
    chromium: {
      available: Boolean(browserExecutable),
      detail: browserExecutable || '未找到本机 Chrome、Edge 或 Chromium；如 Playwright 缓存中也没有浏览器，渲染时才需要另行下载',
    },
    imagemagick: commandCapability('magick'), sips: commandCapability('sips'), getnote: commandCapability(process.env.GETNOTE_BIN || 'getnote'),
  };
}
function buildManifest(args) {
  const directory = resolve(requireArg(args, 'dir')); const sourceId = requireArg(args, 'source-id'); const status = requireArg(args, 'status');
  if (!existsSync(directory) || !statSync(directory).isDirectory()) throw new Error(`目录不存在：${directory}`);
  const output = resolve(directory, 'manifest.json');
  const files = walkFiles(directory).filter((file) => resolve(file) !== output).map((file) => ({
    path: relative(directory, file).split(path.sep).join('/'), bytes: statSync(file).size, sha256: sha256File(file), ...(imageSize(file) ? { image: imageSize(file) } : {}),
  }));
  if (files.length === 0) throw new Error('目录中没有可写入清单的产物');
  writeJson(output, { generator: PACKAGE_GENERATOR, schemaVersion: CANDIDATE_SCHEMA_VERSION, sourceId, status, preset: 'parent-talk', generatedAt: new Date().toISOString(), files });
  return { output, files: files.length };
}

async function main() {
  const args = parseArgs(process.argv.slice(2)); const action = typeof args.action === 'string' ? args.action : 'validate';
  if (action === 'runtime') {
    const report = await runtimeReport(); process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.node.available || !report.playwrightCore.available) process.exitCode = 1;
    return;
  }
  if (action === 'manifest') { process.stdout.write(`${JSON.stringify(buildManifest(args), null, 2)}\n`); return; }
  if (action !== 'validate') throw new Error('--action 仅支持 validate、runtime、manifest');
  const report = validateCandidateSet(readJson(resolve(requireArg(args, 'input'))));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.valid) process.exitCode = 1;
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 1; });
