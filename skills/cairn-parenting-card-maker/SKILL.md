---
name: cairn-parenting-card-maker
slug: cairn-parenting-card-maker
displayName: Cairn · 亲子话题卡
display_name: 亲子话题卡
version: 1.1.1
summary: "把用户粘贴的亲子对话、家庭访谈或可选 Get笔记记录提炼成零到多张证据可定位的话题卡，使用大模型生成插画，并交付可点击离线 HTML 与可下载正反面 PNG。用户说‘从这段亲子对话做卡片/提取多个话题/生成亲子话题卡’时使用；材料不足返回零张，不编造原话。"
license: MIT
description: 将用户粘贴的亲子对话、家庭访谈、文本文件或可选 Get笔记记录，提炼为零到多张有证据定位的亲子话题卡；使用大模型生成风格一致的栅格插画，并输出可点击的离线 HTML 与可下载的正反面 PNG。适用于亲子话题卡提取、候选评审、批量制卡，以及经明确授权的 Get笔记或 Talkcard 草稿适配。
---

# 亲子对话卡牌生成器

把当前消息中的亲子对话转成 `0..N` 张卡。默认不需要知识库 ID、仓库路径或长期保存原文；材料不足时返回零张，不强行凑卡。

## 标准流程

1. 优先读取当前消息中的对话。需要落盘处理时，通过 `source.mjs --stdin` 导入；只有用户给出文件或 Get笔记 ID 时，才使用对应来源参数。
2. 阅读 [卡牌规则](references/card-rules.md)，按独立话题提取候选并保留证据定位。同一对话可以产生多张卡，但每张必须有不同的核心张力和追问方向。
3. 生成 `candidate-set@2.1.0`，运行校验并严格遵循 `nextAction`：
   - `complete`：用户要求最终成品时，继续生图和渲染。
   - `review`：先给用户确认，不提前生图。
   - `stop`：返回零张及原因。
4. 先为整批卡牌规划 `subjectMode / scene / action / setting / shot / composition / palette`，避免连续使用同一男孩、同一机位和同一场景。内容不限定身份时，主动在女孩、男孩、多人、亲子、物件和环境隐喻之间分配。
5. 用 `image.mjs --action prompt` 生成确定性提示词，并把返回的 `referenceImage` 作为图像参考随提示词一起传给生图模型。风格板只用于线条、平涂、留白和简化程度，禁止照抄人物、场景或四宫格布局。
6. 多卡时先生成一张“风格校准图”，按返回的 `acceptance` 验收；不通过就重生，不能带着错误画风继续批量生成。通过后，其他卡复用完全相同的风格段、参考图和验收标准。
7. 插画只画一个横向情境，不画卡片文字、标签、Logo、校徽或 UI；禁止用 SVG、程序化图形或占位图替代。
8. 将通过验收的图片规范化为 `870×660 JPEG`，写回 `card.illustration.file`，再生成离线 HTML 和 `1080×1620` 正反面 PNG。
9. 打开最终 HTML 验收点击、键盘翻面、单卡/多卡导航、下载文件名、移动端、桌面端、离线运行和文本溢出。

```bash
printf '%s' "$CONVERSATION" | node <skill-dir>/scripts/source.mjs --stdin
node <skill-dir>/scripts/core.mjs --input <candidate-set.json>
node <skill-dir>/scripts/image.mjs --action prompt --input <candidate-set.json> --candidate-id <candidate-id>
node <skill-dir>/scripts/image.mjs --action normalize --input <model-image> --output <asset-root>/<candidate-id>.jpg
node <skill-dir>/scripts/render.mjs --input <candidate-set.json> --asset-root <asset-root> --output-dir <package-dir>
```

## 运行依赖

- Node.js 18 或更高版本；在 Skill 目录运行 `npm install` 只安装轻量的 `playwright-core`，不会自动下载 Chromium。
- 渲染时优先复用本机已有的 Google Chrome、Microsoft Edge、Chromium 或 Brave。非标准安装位置可通过 `CHROME_PATH`、`EDGE_PATH` 或 `CHROMIUM_PATH` 指定。
- 只有机器上完全没有 Chromium 内核浏览器，且 Playwright 缓存中也没有可用浏览器时，才需要运行 `npx playwright install chromium`。
- 图片规范化无需额外安装图片工具：默认复用渲染所用的同一个 Chromium 完成 870×660 封面裁切与 JPEG 导出；若本机已装 ImageMagick 或 macOS 自带 `sips`，会优先使用它们。Get笔记命令仅在使用可选适配器时需要。

## 证据与隐私

- 一条带定位的直接引语，或两条来自不同定位的来源摘要，才通过证据门槛；AI 推断不能单独支撑卡牌。
- 当前消息中的直接引语使用 `turn:N` 或 `line:N-M`。不确定是不是原话时，必须标为摘要。
- 候选集、HTML、报告和最终包不得包含完整私人原文。
- 电话、邮箱、账号和签名链接由导入器确定性脱敏；姓名、学校等语义身份信息在提取时泛化，未处理完则进入 `review`。
- `material_thin`、中等证据、待确认重复或隐私风险都不得进入生图。

## 输出约束

默认卡组名为“亲子话题卡”，主题固定为 `talkcard-paper-v1`。最终包包含 `cards.html`、`card-set.json`、`render-report.json`、`manifest.json` 及每张卡的正反面 PNG。

单卡隐藏“上一张、下一张、位置”；多卡才显示。卡组名必须同时出现在正反面和下载图片中。渲染器先写相邻 staging 目录，只覆盖带本 Skill manifest 的旧包；文本无法通过紧凑级别适配时，以 `layout-overflow` 失败，不得静默截断。

## 可选适配器

只有涉及批量、Get笔记或 Talkcard 草稿时，才阅读 [适配器说明](references/adapters.md)。Get笔记写入默认 dry-run；真实写入必须同时具备 `--apply`、目标知识库、`--authorized` 和用户明确授权。Talkcard 适配器只输出草稿 bundle，不修改正式 `cards.json`。

本地生成卡牌不等于授权写入外部服务、修改正式仓库、提交推送、部署、上传小程序或发布。
