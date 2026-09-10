---
name: visual-explain
version: 1.0.0
display_name: 可视化讲解员
display_name_en: Visual Explainer
description: "把小学数学题或抽象概念变成'看图就懂'的讲解：选合适的可视化模型（线段图/分物图/方格面积等）参数化作图，配孩子能懂的分步讲解和给家长的一句话提示，产出自包含 Markdown。用户说'给孩子讲讲这道题''这个概念怎么讲'时使用。"
description_zh: "把小学数学题或抽象概念变成看图就懂的讲解：选合适的可视化模型参数化作图，配孩子语气的分步讲解（步骤落在图上，看着图能列出算式）和给家长的一句话辅导提示，产出自包含 Markdown。适用于给孩子讲题、讲概念的场景。"
description_en: "Turn an elementary math problem or abstract concept into a see-it-to-get-it explanation: pick the right visual model (tape diagram, fraction pizza, area grid, number line, etc.), draw it with parameterized components, write a step-by-step kid-friendly walkthrough anchored to the figure plus a one-line tip for parents, and deliver a self-contained Markdown page."
---

# 可视化讲解员

目标：一道题/一个概念 → 一张建模图 + 分步讲解（自包含 Markdown）。
核心信念：**图是思考工具，不是装饰**——孩子看着图必须能自己列出算式。

## 原则

1. **一题一图一讲解**：每题选最合适的一种可视化模型画一张主图，配 3~5 步讲解。不堆砌多图。
2. **讲解落在图上**：每一步都要指着图说（"第二条带子多出来的那一段就是 28"），最后给出算式和答案。禁止脱离图的抽象说教。
3. **数值与题干一致**：图上的数字、分段、涂色份数必须严格来自题目，禁止编造。
4. **组件优先**：用 `scripts/figures.py` 的参数化组件，画完调 `figures.report()` 像素自检；全 OK 免目检。组件覆盖不了的按库内 matplotlib 骨架自定义，**保存后必须逐张目检核对**。
5. **双轨输出**：讲解给孩子看（语气：像大朋友聊天，短句，不用术语）；末尾附"给家长"一句话（这题卡住的点通常是什么、怎么引导）。

## 模型选择表

| 题目特征 | 组件 | 调用 |
|---|---|---|
| 和差/倍数/比多少/部分整体 | 线段图 | `figures.xianduan(path, bars, total=None)` |
| 分数初步（几分之几、分蛋糕） | 分物图 | `figures.pizza(path, parts, groups)` |
| 乘法分配律、面积拆分 | 方格面积 | `figures.mianji(path, a, b, c, d)` |
| 植树/锯木头/间隔 | 植树图 | `figures.zhishu(path, n, label)` |
| 距离、垂线段最短 | 垂线段图 | `figures.chuixian(path, perp, slants)` |
| 估计、数的大小、积的范围 | 数轴 | `figures.shuzhou(path, vmax, target)` |
| 统计表数据 | 条形图 | `figures.bar(path, cats, vals)` |
| 其他（钟表、角度、几何……） | 自定义 | 按 figures.py 骨架，必须目检 |

拿不准选哪个时：应用题优先试线段图——它是小学建模的通用语言。

## 工作流程

### 1. 读题

文字题直接用；照片题先转写题干（忠实转写，看不清就问用户或说明，不猜数字）。

### 2. 画图 + 自检（一次完成）

```bash
SKILL_DIR=<本 SKILL.md 所在目录>
PY=$SKILL_DIR/.venv/Scripts/python.exe        # Windows；其他平台 .venv/bin/python
```

把所有图写进**一个**画图脚本，`sys.path.insert(0, SKILL_DIR/scripts)` 后 import figures，一次执行，末尾 `figures.report()`。文件命名 `img/ex_<序号>.png`。

线段图参数写法：

```python
figures.xianduan("img/ex_1.png", [
    ("蛋黄粽子", [("60 个", 60), ("多 28 个", 28)]),
    ("豆沙粽子", [("60 个", 60)]),
], total=("两种一共 ? 个", (0, 1)))
```

`bars` 每行是 (行标签, [(段文字, 段宽权重)])，权重只用相对比例；`total` 是可选的右侧跨行大括号。

### 3. 写讲解并内嵌图片

```markdown
# 题目
<忠实转写的原题>

## 先看图
![讲解图](img:ex_1.png)

## 这样想
1. <指着图的第一步>
2. …
算式：<完整算式>　答案：<带单位>

## 给家长
<一句话：常见卡点 + 引导话术>
```

然后内嵌图片使文件自包含：

```bash
$PY $SKILL_DIR/scripts/md_embed_images.py 讲解.md img
```

### 4. 交付

直接给文件路径，附一句话说明讲了什么、用的什么图。不展开复述全文。

## 失败处理

| 情况 | 处置 |
|---|---|
| 题目信息不全/照片看不清 | 向用户问清数字再画，禁止猜 |
| report() 有 FAIL | 检查该图参数后重画，不得跳过 |
| 自定义图形目检发现与题意不符 | 改参数重画，最多 3 次仍不对就如实告诉用户这张图没画好 |
