# 可选适配器

只有用户明确涉及批量、Get笔记或 Talkcard 草稿时才使用本页。

## 批量

批量清单使用 `batch-manifest@1.0.0`：

```json
{
  "schemaVersion": "1.0.0",
  "kind": "batch-manifest",
  "items": [
    { "id": "family-a", "input": { "inline": "家长：……\n孩子：……" } },
    { "id": "family-b", "input": { "file": "/absolute/path/dialogue.md" } },
    { "id": "family-c", "input": { "getnote": "note-id-as-string" } }
  ]
}
```

```bash
node <skill-dir>/scripts/batch.mjs --action prepare --manifest <batch.json> --output <state.json>
node <skill-dir>/scripts/batch.mjs --action render --state <state.json> --output <report.json>
```

状态限定为 `prepared / review / ready / rendered / material-thin / failed`。每个来源使用隔离目录，单项失败不得阻断其他项；报告不包含完整 inline 原文。

## Get笔记

```bash
node <skill-dir>/scripts/source.mjs --getnote-note-id <id>
node <skill-dir>/scripts/getnote.mjs --action export --kb-id <id> --output <inventory.json>
node <skill-dir>/scripts/getnote.mjs --action search --input <candidate-set.json> --kb-id <id> --output <duplicates.json>
node <skill-dir>/scripts/getnote.mjs --action prepare --input <candidate-set.json> --output <notes.json>
node <skill-dir>/scripts/getnote.mjs --action write --input <notes.json> --target-kb-id <id> --output <report.json>
```

每张非拒绝候选准备 3–6 条去重查询，组合情境、感受和机制。无命中只表示“未发现”，不能证明全库唯一。

`write` 默认 dry-run。真实写入必须额外提供 `--apply --authorized`，同时具有目标知识库和用户针对本次写入的明确授权。逐张保存、加入知识库并回读验证后，才能记录 `cardNoteId`。摘要、子笔记 ID 和附件元数据不能冒充 `direct_quote`。

## Talkcard 草稿

```bash
node <skill-dir>/scripts/talkcard.mjs \
  --input <candidate-set.json> \
  --asset-root <asset-root> \
  --output-dir <draft-dir> \
  --content-version <version> \
  --start-no <1..99>
```

适配器要求已验证的 `cardNoteId`、合法牌堆、内容版本和可用卡号；输出待合并 `cards.json`、`870×660 JPEG` 与校验报告，只生成 staging bundle，不修改正式数据。

实际同步 Talkcard 仍需单独仓库授权，并分别运行内容校验、测试、类型检查、Web/小程序资源同步和视觉验收。
