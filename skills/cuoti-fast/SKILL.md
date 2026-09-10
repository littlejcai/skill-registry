---
name: cuoti-fast
version: 1.1.0
display_name: 快速错题集
display_name_en: Fast Mistake Notebook
description: "快速版错题集生成：从批改过的试卷照片一次读页识别错题，转写题干与公式、批量重绘插图，几分钟内产出自包含 Markdown 错题集。用户要求快速整理错题、生成错题集、接受部分自动化与少量识别误差时使用；默认自动收录高置信错题，不做逐题人审、不做错因分类和教材映射。"
description_zh: "从批改过的试卷照片一次读页识别错题，转写题干与公式、批量重绘插图，几分钟内产出自包含 Markdown 错题集。适用于快速整理错题、接受部分自动化与少量识别误差的场景；默认自动收录高置信错题，不做逐题人审、错因分类和教材映射。"
description_en: "Turn photos of graded exam papers into a self-contained Markdown mistake notebook in minutes: one-pass page reading, faithful question/formula transcription, batch figure redrawing, and machine-verified answers. Use when the user wants fast mistake collection and accepts partial automation with minor recognition errors; auto-collects high-confidence mistakes, with no per-question review, no error-cause tagging, and no textbook mapping."
---

# 快速错题集

目标：试卷照片 → 自包含 Markdown 错题集（题干文字 + 重绘插图 + 答案对照 + 一两句讲解）。
取舍：**速度优先，接受部分识别误差**。误收、错字由用户在使用时随手纠正；本 skill 只在两处保留硬闸门——隐私和答案的机器验证。

## 原则

1. **每页一次读图**：不预扫描、不单独切题。读一页，直接输出该页全部候选错题的结构化 JSON（契约见 `references/page-json-contract.md`）。**主 agent 亲自读，禁止为读页派生子 agent**（≥4 页才可开可选模式 A）。
2. **宁可误收，不可漏收**：有批改痕迹或明显作答错误的都收录；低置信的照常收录并标 `needs_review`，在交付摘要里列出由用户一眼扫掉。
3. **不编造**：题干、学生答案看不清就写 `null` + `needs_review: true`，禁止猜。涂改处写"（涂改）"。
4. **不做的事**：错因分类标签、教材知识点映射、逐题确认、整页 OCR 存档——全部取消。
5. **讲解不是归因**：每题给 1~2 句"怎么算对"的讲解；它是求解的副产品，不额外做题因归因。

## 隐私（默认输出过滤，遮盖为可选项）

**默认模式——输出过滤（快）**：照片只做 EXIF 归一化（`prepare.py OUT IMG... --mask-header 0`），直接读图识别。纪律只有一条：**任何产物（JSON、Markdown、摘要）一律不得写入姓名、班级、学号、学校等身份文字**，页面 JSON 里 `identity_text_found` 恒置 `false`；交付摘要注明"隐私：输出过滤模式（原图已上传云端，产物不含身份文字）"。

**可选模式——传输前遮盖（用户明确要求"不要上传身份信息"时启用）**：身份信息像素不上云，遮盖发生在首次读图之前。

- 首选 `--mask-auto`：本地 OCR 定位"姓名/班级/学号"等关键词行并整行遮盖（需 rapidocr-onnxruntime，坐标由 OCR 给出，不要目测估计）。跑完查看 prepared.png 验证：身份文字已盖死、卷标题和得分完好。
- OCR 找不到或没盖死：`--grid-preview` 瞄准后 `--redact-box X,Y,W,H` 重跑（幂等，直接覆盖，禁止 `rm -rf`）。定位+验证按页计 ≤ 4 次调用；仍盖不好按"失败处理"STOP。
- 遮盖模式下读 prepared.png，不读原图；读页发现残留身份文字：置 `identity_text_found: true`，补 `--redact-box` 重跑该页再读。
- 更强保障只能拍照时物理遮盖（贴纸/折起页眉）。

原图与派生图只放任务临时目录，不进仓库。

## 工作流程

### 0. 环境自检（每次任务最先做，一次 Bash 调用内完成）

`SKILL_DIR` 一律取**本 SKILL.md 文件实际所在目录的绝对路径**（按安装位置解析，禁止照抄任何示例路径）。`PY` 按序探测，取第一个存在的：

```bash
SKILL_DIR=/path/to/cuoti-fast                # 本 SKILL.md 所在目录的真实绝对路径
PY=$SKILL_DIR/.venv/Scripts/python.exe       # Windows venv
[ -x "$PY" ] || PY=$SKILL_DIR/.venv/bin/python   # Linux/macOS venv
[ -x "$PY" ] || PY=python3                       # 无 venv 回退系统 python3
command -v "$PY" >/dev/null 2>&1 || PY=python    # 裸 Windows 沙箱常只有 python
$PY -c "import PIL" 2>/dev/null || $PY -m pip install -r $SKILL_DIR/requirements.txt   # pip 失败即走下面降级表，不重试
```

依赖装不上时的降级路径（按下表执行，不得直接报错卡死）：

| 缺什么 | 降级动作 |
|---|---|
| Pillow | 跳过 prepare.py 直接读原图写页面 JSON；extract.py 会自动降级为纯校验（跳过裁片与 bbox 越界校验），verify/assemble 照常跑；仅裁片与遮盖模式失效（只能走输出过滤模式并告知用户）；摘要注明"未做归一化与裁片" |
| rapidocr-onnxruntime | `--mask-auto` 不可用 → 转 `--redact-box` 手工遮盖；仍不行，征得用户同意后回退输出过滤模式 |
| matplotlib/numpy | 跳过第 6 步插图重绘，只交付文字版，摘要注明"插图缺失：绘图依赖不可用" |
| pip 本身不可用（无网络沙箱） | 依赖无法补装，按上表已有依赖逐项降级执行（无 Pillow 也照上表继续，不 STOP）；仅当连文字版都无法产出时才 STOP 并说明 |

### 1. 建批次 + 预处理

```bash
$PY $SKILL_DIR/scripts/prepare.py OUT_DIR IMG1 [IMG2 ...] --mask-header 0   # 默认仅归一化；要传输前遮盖加 --mask-auto 或 --redact-box X,Y,W,H
```

下文所有 `$SKILL_DIR`、`$PY` 均指第 0 步解析出的值。每页输出 `normalized.png`（仅 EXIF 归一化）、`prepared.png`（默认模式下等于归一化原图；遮盖模式下为已遮盖图，供阅读）、`manifest.json`。

### 2. 读页 → 页面 JSON

逐页查看 `prepared.png`（多页可在同一轮并行读取），按 `references/page-json-contract.md` 逐页写出 `OUT_DIR/pXXX.json`。

**读图调用纪律**（实测读页占全程约 80% 耗时，瓶颈是 LLM 往返次数，不是读图本身）：

- 每页的读图在**一条消息里并行**发出：1 张整页图 + 按栏切分的 region。三栏卷（设 prepared.png 宽 `W`）：左 `x=0, w=W/3`，中 `x=W/3-40, w=W/3+80`，右 `x=2*W/3-40, w=W/3`，均 `y=0` 到页底；栏间 40px 重叠防漏题。双栏卷对半切（同样留 40px 重叠），单栏卷用整页图 + 上下两半 region。
- 每页读图调用 ≤ 5 次：4 次首读 + 最多 1 次补读（只针对模糊处）。不得对同一区域换着坐标反复重读。补遮盖后重读该页不计入此上限。
- 看完该页全部图后**一次 Write 写出完整 `pXXX.json`**；禁止边读边写、禁止用多次 Edit 增量拼装。

要点：

- 题干忠实转写为文字；公式用文字形式（`×`、`÷`、`5/10`、`（　）`）；竖式保留为等宽文本。
- 每题给 `correct_answer`；算术、单位换算、植树、日期推算等可机械验证的题必须同时给 `verification` 表达式列表（如 `"14*12 == 168"`）。
- 插图需求填 `figure.type`：`none` / `redraw`（需重绘）/ `table`（月历等）/ `codeblock`（竖式）。图上有学生答案或批改痕迹时必须 `redraw`（洗掉答案），纯情境图可用原图裁片（`type: crop`）。
- 得分写在卷面上的，填入 `score`。
- ≥4 页可选用 AgentSwarm 每页派工人并行读页，见文末"可选模式 A"（实测质量有损，默认自己顺序读）。

### 3. 校验 + 裁片

```bash
$PY $SKILL_DIR/scripts/extract.py --image OUT_DIR/pXXX/prepared.png --json OUT_DIR/pXXX.json --out OUT_DIR/pXXX
```

校验 JSON 结构、bbox 越界、qid 重复，生成每题裁片 `crops/qid.png` 和 `enriched.json`。校验报错时**一次性修完全部报错**再重跑，不得跳过；每页重跑 ≤ 2 次，仍不过则该页相关题标 `needs_review` 并在摘要说明。

**脚本链**：第 3~5 步的 extract → verify → assemble 用一条 `&&` 链在**一次** Bash 调用里顺序跑完（任一失败即停，按上面规则修）；耗时统计用命令内嵌的 `date +%s` 差值，禁止单独发起只做打点的 Bash 调用。

### 4. 答案机器验证

```bash
$PY $SKILL_DIR/scripts/verify_answers.py OUT_DIR/pXXX/enriched.json
```

逐条执行 `verification` 表达式（沙箱求值，只支持算术与比较），并检查答案数值出现在表达式中。任一失败 → 该题 `needs_review: true`；你要重看该题裁片修正答案或表达式后重跑。🔴 所有页跑完后，仍存在验证失败且无法修正的题，必须在交付摘要中明示，不得悄悄带过。

### 5. 组装文字版并立即交付（流式第一段）

**组装是机械操作，禁止手写 Markdown**——所有内容已在 enriched.json 里：

```bash
$PY $SKILL_DIR/scripts/assemble.py --title "X年级数学错题集" --out OUT_DIR/错题集.md OUT_DIR/p*/enriched.json \
  && $PY $SKILL_DIR/scripts/check_output.py OUT_DIR/错题集.md --skip-images
```

文字版（插图位置是占位符）生成后先过 `--skip-images` 门禁（结构+身份文字，图片占位符此阶段不查），**报红必须修复后才可交付**——隐私闸门对文字版同样生效。通过后**立即把文件路径交付给用户**——这是首个字输出点（TTFT），不要等插图。

### 6. 批量重绘插图，更新同一文件（流式第二段）

- 把所有 `figure.type == "redraw"` 的图写进**一个** Python 脚本，import `$SKILL_DIR/scripts/figures.py` 的参数化组件（数轴 `shuzhou`、方格面积 `mianji`、条形图 `bar`、植树 `zhishu`、垂线段 `chuixian`），一次执行，最后调 `figures.report()` 像素自检。**文件命名约定：`img/f_<qid>.png`**（组装脚本按此引用）。
- 库组件覆盖不了的图形：按 `figures.py` 骨架自定义绘制，画完后逐张查看核对数值与题意。
- 数值、比例、涂色块数必须与题干一致，**以题干数字为准重画，不照抄图上可能错误的作答**。
- `table` / `codeblock` 类型不画图，内容由 JSON 的 `figure.content` 提供，组装时已嵌入。

然后过门禁并内嵌，**原地更新同一个文件**。画图脚本一次 Write，随后 draw → check → embed 串成一条 `&&` 链一次跑完：

```bash
$PY OUT_DIR/draw_figures.py \
  && $PY $SKILL_DIR/scripts/check_output.py 错题集.md --img-dir IMG_DIR \
  && $PY $SKILL_DIR/scripts/md_embed_images.py 错题集.md IMG_DIR
```

`check_output.py` 报红必须修复后再 embed（它同时是身份文字硬闸门：产物出现"姓名：张三"这类真实身份值即 FAIL，空栏放行）。embed 完成后告知用户"插图版已更新同一文件"。

### 7. 交付摘要

按此模板直接输出（作为最终回复，不再额外发起 Read/ls/TodoList 复核调用——`check_output.py` 已是结构与隐私门禁）：

```
✅ 错题集已生成：<文件路径>
- 页数 N，收录错题 M 道；各卷得分：…
- 待你扫一眼的题（needs_review）：p001-q03（字迹不清）…；没有则写"无"
- 答案验证未修项：…；没有则写"无"
- 隐私：输出过滤模式 / 已遮盖（方式）；降级说明：…；无降级则写"无"
```

低置信题请用户扫一眼确认去留，**不要逐题展开**。

## 失败处理

| 情况 | 处置 |
|---|---|
| 照片模糊/旋转/缺页 | 照常处理可读部分，该页标 `needs_review` 并在摘要说明 |
| 整页无批改痕迹 | 输出空 questions 列表，摘要注明"未检出错题"，不得当作全对结论 |
| 验证表达式反复失败 | 保留模型答案，`needs_review: true`，摘要列出 |
| 遮盖模式下身份文字无法定位遮盖 | 🔴 STOP：停止处理该页，请用户提供脱敏图，不得继续 |

## 可选模式（默认都关闭）

### A. 多页并行读页（≥4 页才考虑）

实测：工人冷启动约 3 倍于亲自读的单页耗时，且召回率明显下降；2~3 页直接自己顺序读更快更准。prepare 集中跑完后，用 AgentSwarm 每页派一个工人，每个工人的 prompt 模板（`{SKILL_DIR}` 在派发时替换为本 skill 的实际绝对路径，工人需要可读的全路径）：

```
你是错题集读页工人。阅读图片 {PREPARED_PNG 路径}（大图必须用 region 参数分栏查看全分辨率细节）。
严格按 {SKILL_DIR}/references/page-json-contract.md 的契约，
把该页全部候选错题写成 {OUT_DIR}/pXXX.json。
必须逐题扫描：从第一题到最后一题逐题判断收录/排除，不得只挑红痕显眼处；
折痕、栏交界、被长红勾扫过的区域要额外放大核对——漏收比误收更不可接受。
不运行任何脚本，不输出散文，不写过程报告。
完成后只汇报一行：收录题数、needs_review 题号及原因、identity_text_found 值。
```

调度员（你）的职责边界：

- 工人只写 JSON；extract/verify/assemble 等全部脚本由你集中运行，闸门入口唯一。
- 工人超时、未写文件、JSON 校验失败或 assemble 拒装（契约违反）：重派一次；仍失败由你亲自读该页（退化为单页流程）。
- 工人报告 `identity_text_found: true`：补遮盖重跑 prepare 后重派该页。
- 🔴 **抽样复核**：每批随机抽 1 个工人，你亲自快速核对其页面，漏收严重则整批降级为亲自处理。

### B. 逐题流式（用户明确说"边识别边看"时）

默认不开——整页 JSON 一次写完再组装已足够快，逐题刷新会增加多次脚本往返。开启后的做法：

1. 第 2 步读页时，每读完一题就把**包含目前全部题目的完整合法 JSON** 重写一次 `pXXX.json`（不是追加片段，脚本只认完整 JSON）。
2. 每次重写后依次跑 `extract.py`、`verify_answers.py`、`assemble.py`，文字版随之逐题增长，用户可实时打开看。
3. 插图和 embed 仍然只在整页（或整批）读完后做一次，不逐题重复。
