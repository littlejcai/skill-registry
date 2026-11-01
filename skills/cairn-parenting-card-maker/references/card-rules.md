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
    "illustrationPlan": {
      "subjectMode": "child-adult",
      "scene": "餐桌旁，孩子在两项安排之间认真权衡",
      "action": "孩子指向两张便签，成人侧身倾听",
      "setting": "只保留桌面、椅背和一盆小植物",
      "shot": "medium",
      "composition": "人物位于中下部，右上保留大块安静留白",
      "palette": "浅砂色背景、深蓝灰线条、少量柔和橙色点缀"
    },
    "status": "ready",
    "cardNoteId": null
  }]
}
```

候选集不得出现完整 `content`、`rawContent` 或 `transcript`。`cardNoteId` 只有在 Get笔记写入并回读验证后才能填写。

## 5. 插画风格锁定

### 先规划整批，再逐张生成

每张候选填写：

- `subjectMode`：`girl / boy / mixed-group / child-adult / object-detail / environment-metaphor`；
- `scene`、`action`、`setting`；
- `shot`：`wide / medium / close / detail`；
- `composition`、`palette`。

内容没有限定身份时，不根据原对话推断真实孩子，而是为整批卡牌做视觉分配：三张卡至少包含一种非男孩单人模式，男孩单人最多两张；不连续使用相同主体、场景和机位。内容适合用物件或环境表达时，优先避免再画一个站在中央的孩子。

### 固定风格锚点

必须先运行：

```bash
node scripts/image.mjs --action prompt --input <candidate-set.json> --candidate-id <candidate-id>
```

将输出的 `prompt` 原样交给图像生成模型，并把输出的 `referenceImage` 作为视觉参考图片一并传入。参考图是一张四宫格风格板：只学习以下共同属性，不复制人物、动作、背景或四宫格构图：

- 大面积平涂、安静、低饱和的粉彩背景；
- 深蓝灰色、略带手绘抖动的铅笔或墨线；
- 填色稀疏，衣服和物件大量保留纸白；
- 生活化、克制的表情和动作；
- 背景只留少量必要线索，有明显呼吸感；
- 2–4 个主色，最多一个小面积暖色点缀。

不要再使用“完整水彩场景、细腻纸张质感、丰富环境细节”这类宽泛描述，它们容易让模型生成灰雾化绘本或高细节动漫插画。

### 明确排除

只生成一幅连续的横向情境插画。禁止：

- 拼贴、四宫格、分镜、卡片框、海报或平台 UI；
- 任何文字、字母、数字、标点、Logo、校徽、品牌和水印；
- 日系动漫、漫画、吉卜力模仿、Q 版大眼、精致人物海报；
- 照片、3D、电影光效、浓重阴影、整幅水彩雾化或全画面纸纹；
- 大面积纯黑或高饱和红色服装、红领巾等抢眼符号；
- 复杂写实背景、极小人物、正中央证件照式人物；
- 可识别真人、错误手指肢体或关键动作被裁掉。

### 校准与验收

多卡时先只生成第一张。逐项检查 `image.mjs` 返回的 `acceptance`：

1. 是否为单一横向场景；
2. 背景是否以平涂粉彩色块为主；
3. 线条粗细、留白、填色密度是否接近风格板；
4. 是否准确表达本卡情绪与动作；
5. 是否没有默认复用同一个男孩；
6. 是否无文字、标志、明显结构错误。

任一项不通过就拒绝该图，并在原提示词后只追加具体偏差，例如：“背景过于写实，请删除远景建筑，改为浅蓝平涂底色和两三根环境线”。不要改写固定风格段。第一张通过后，再用同一个参考图和完全相同的固定风格段生成其余卡；每张仍单独验收。

通过后规范化为 `870×660 JPEG`。最终 HTML 必须完全离线，文本通过 `textContent` 注入；支持点击、Enter、Space 翻面和正反面下载。桌面端与 `390×844` 移动端均无溢出、无控制台错误、无网络请求。每张 PNG 为 `1080×1620`，正反面都有“亲子话题卡”标识，重复截图哈希稳定。
