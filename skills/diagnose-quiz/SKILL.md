---
name: diagnose-quiz
version: 1.0.0
display_name: 错题诊断师
display_name_en: Mistake Diagnostician
description: "在错题集之后回答'为什么错、怎么补'：把错题按概念/审题/计算/方法四类归因并记入学习档案，针对弱点自动生成带机器验证的变式练习卷，孩子做完发回答案即自动判题并更新档案状态。用户说'分析下错因''针对错题出点练习''判一下孩子做的练习'时使用。"
description_zh: "在错题集之后回答为什么错、怎么补：错题按概念/审题/计算/方法四类归因记入学习档案，针对弱点生成自带机器验证的变式练习卷（换数字/换情境/反向提问），孩子做完发回答案即自动判题并更新档案状态。适用于错因分析、针对性出题、练习判题场景。"
description_en: "The step after a mistake notebook: diagnose why each mistake happened (concept / misreading / careless calc / missing method), record it into a persistent learner profile, generate variant drills (new numbers, new context, reversed question) that carry machine-checkable verification expressions, then grade the child's answers and update the profile. Use for error-cause analysis, targeted practice generation, and answer grading."
---

# 错题诊断师

目标：错题 → 错因归因入档 → 变式练习卷 → 判题回写档案。回答"为什么错、怎么补"。
档案是所有学习类 skill 的公共记忆，契约见 `references/profile-contract.md`——**档案只能通过 `scripts/profile.py` 读写，禁止手写档案 JSON**。

本 skill 无第三方依赖，系统 python3 即可运行全部脚本。

## 原则

1. **四选一归因**：每道错题归 `concept` / `reading` / `calc` / `method` 之一（定义与处置矩阵见契约）。拿不准选 `concept` 并在 note 里说明疑点。
2. **处置跟着归因走**：`concept`/`method` 先建议转 visual-explain 讲解再练；`reading` 出陷阱辨认变式；`calc` 只出短练不重讲。
3. **题出出来就可判**：每道变式题必须自带 `verification` 表达式，`quiz.py verify` 全过才允许交付。禁止出无法机器验证的算术类答案。
4. **变式三招**：换数字、换情境、反向提问（原题求一共 → 变式给一共求部分）。每个弱点出 3 道，难度不超过原题所在年级。
5. **不泄题**：练习卷和答案分开输出，答案页文件名带"答案"，交付时提醒家长收好。

## 工作流程

### 1. 归因入档

错题来源：cuoti-fast 产出的 `enriched.json`、错题集 Markdown、或用户直接描述的题目。逐题确定知识点 + 错误类型 + 一句话 note，然后入档（首次先 init）：

```bash
PROFILE=学习档案.json    # 一个孩子一份，跨 skill 共用
python3 scripts/profile.py init "$PROFILE" --grade 3    # 已存在会提示不覆盖
python3 scripts/profile.py add-error "$PROFILE" --point 两位数乘法 --type concept \
  --note "14×12 漏算 10×2，位值拆分不清" --source "期末练习卷1 选择6"
```

归因结论用一两句话同步给用户（"这题不是粗心，是位值概念没懂"），`concept`/`method` 类附一句：建议先用 visual-explain 讲解再练。

### 2. 出变式卷

每个待强化知识点出 3 道变式，写 `quiz.json`（格式见 `scripts/quiz.py` 文档字符串），然后自检：

```bash
python3 scripts/quiz.py verify quiz.json    # 全过才能交付；有 FAIL 修题重验
```

练习卷正文（Markdown，A4 打印友好）：标题 + 每题题干 + 作答留白（`＿＿＿＿`）。答案另写 `quiz_答案.md`：题号 + 答案 + 一句解析（解析就是 verification 表达式的人话版）。

### 3. 判题回写

孩子做完，用户把答案发来（任何形式："q1 168，q2 对了，q3 写的 150"）。整理成 JSON 后判题：

```bash
python3 scripts/quiz.py check quiz.json --answers '{"q1": "168", "q2": "96", "q3": "150"}' \
  --profile "$PROFILE"      # 判题结果自动记入档案
```

反馈分两层：给孩子（哪题对了夸具体，哪题错了说一句怎么想的）；给家长（本次正确率 + `profile.py summary` 里该知识点的状态变化，如"两位数乘法 weak → improving"）。

### 4. 交付摘要

报告：本次归因的知识点与类型、练习卷文件路径、答案页路径。若某知识点 `mastered`，明确恭喜一次——这是给家长留存的正反馈。

## 失败处理

| 情况 | 处置 |
|---|---|
| 错题来源里没有可机械验证的题（如几何作图） | 该知识点只入档不出题，摘要注明原因 |
| quiz.py verify 反复不过 | 检查是表达式错还是答案错，修到全过；不得绕过 verify 交付 |
| 用户发的答案无法对应题号 | 先和用户确认对应关系再判题，不猜 |
| 档案不存在就判题 | 先 init 再 check，profile.py 会提示 |
