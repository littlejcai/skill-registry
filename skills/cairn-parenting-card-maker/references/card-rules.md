# 亲子话题卡规则

## 1. 话题拆分

一张卡只承载一个可独立讨论的需要、矛盾、判断或洞察。两个片段只有在“核心问题”和“有效追问方向”都不同的情况下，才拆成两张。单个来源可产生零张、一张或多张；通常不超过三张，超过时先检查是否过度拆分。

## 2. 硬门槛与评分

每个 `selected` 或 `review` 候选都必须通过：证据充分、可独立理解、可迁移、开放、可追问、与同源候选不同、隐私安全。

证据满足以下任一条件：

- 一条 `direct_quote`，并带 `turn:N` 或 `line:N-M` 等定位；
- 两条 `source_summary`，来自不同定位。

`ai_inference` 不能单独作为证据。评分字段为 `childVoice`、`tension`、`generalizability`、`conversationPotential`、`parentInsight`、`distinctiveness`，每项 0–2 分：

- `selected`：全部硬门槛通过、无 0 分、总分 9–12、同源去重为 `clear`。
- `review`：全部硬门槛通过、无 0 分、总分 7–8，或仍有待确认事项。
- `rejected`：硬门槛失败、出现 0 分、总分 0–6，或确定重复。保留拒绝原因。

证据级别：`high` 可进入成品；`medium` 必须先评审；`material_thin` 返回零张。

## 3. 文案规则

- 正面是一句孩子口吻的可迁移陈述，不以问号结尾。
- 背面必须包含 `followup`、`deeper`、`observer`。
- `followup` 与 `deeper` 各是一条开放问题，并以问号结尾。
- `observer` 标记 `audience: adult-only`，用一到两句描述性语言，不诊断、不说教、不评判。
- 正面和背面正文合计不超过 120 个非空白 Unicode 字符。
- 不推断真实孩子的年龄、性别、长相、学校或身份。

## 4. 最小数据结构

新数据统一使用 `2.1.0`；校验器兼容读取 `2.0.0`。核心字段如下：

```json
{
  "schemaVersion": "2.1.0",
  "preset": "parent-talk",
  "deck": { "title": "亲子话题卡", "theme": "talkcard-paper-v1", "locale": "zh-CN" },
  "source": {
    "sourceId": "inline-0123456789abcdef",
    "sourceType": "inline-dialogue",
    "sourceTitle": "用户提供的对话",
    "evidenceLevel": "high",
    "requiresSourceConfirmation": false,
    "privacyStatus": "clear",
    "privacyFindings": []
  },
  "categories": [{ "id": "self-awareness", "label": "自我认知", "color": "#DDD6F6", "lines": ["自我", "认知"] }],
  "candidates": [{
    "candidateId": "choice-cost",
    "theme": "选择的代价",
    "evidence": [{ "kind": "direct_quote", "text": "我只能先顾好一件事。", "locator": "turn:4" }],
    "hardGates": { "evidence": true, "independent": true, "generalizable": true, "openEnded": true, "expandable": true, "distinct": true, "privacySafe": true },
    "scores": { "childVoice": 2, "tension": 2, "generalizability": 2, "conversationPotential": 2, "parentInsight": 2, "distinctiveness": 1 },
    "scoreTotal": 11,
    "duplicateCheck": { "scope": "source-only", "status": "clear", "queries": [], "matches": [] },
    "decision": "selected",
    "rejectionReasons": [],
    "card": {
      "title": "只能先保住一个方向",
      "audience": "小学中高年级",
      "categoryId": "self-awareness",
      "front": { "text": "我只能先顾好一件最重要的事。" },
      "back": { "sections": [
        { "id": "followup", "label": "追问", "body": "你最想先保住哪一件事？" },
        { "id": "deeper", "label": "深挖", "body": "暂时放下另一件事时，你最担心什么？" },
        { "id": "observer", "label": "观察提示", "audience": "adult-only", "body": "孩子可能正在学习权衡，也需要被允许说出舍不得。" }
      ] },
      "illustration": { "file": "choice-cost.jpg", "alt": "孩子在两项安排之间认真思考" }
    },
    "illustrationPlan": {},
    "status": "ready",
    "cardNoteId": null
  }]
}
```

候选集不得出现完整 `content`、`rawContent` 或 `transcript`。`cardNoteId` 只有在 Get笔记写入并回读验证后才能填写。

## 5. 插画与成品验收

插画必须由图像生成模型生成，保持低饱和背景、深蓝灰铅笔或墨线、轻水彩或彩铅填色、自然生活表情和轻纸张质感。根据话题选择女孩、男孩、多人、亲子、物件或环境隐喻，不把真实孩子外貌投射到画面，也不要固定成同一个男孩模板。

只生成横向情境插画，不生成卡片、中文文字、标签、数字、Logo 或平台 UI。排除照片感、3D、夸张动漫眼、品牌、水印、可识别真人和明显肢体错误。规范化为 `870×660 JPEG` 后再交给渲染器。

最终 HTML 必须完全离线，文本通过 `textContent` 注入；支持点击、Enter、Space 翻面和正反面下载。桌面端与 `390×844` 移动端均无溢出、无控制台错误、无网络请求。每张 PNG 为 `1080×1620`，正反面都有“亲子话题卡”标识，重复截图哈希稳定。
