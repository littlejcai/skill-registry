# 学习档案契约（profile-contract）

一个孩子的所有学习类 skill 共用一份档案。**档案只能由 `scripts/profile.py` 读写，任何 skill 不得手写/手改这个 JSON**——格式漂移会让所有 skill 一起坏。

## 文件位置

档案路径由调用方传入，默认当前工作目录下 `学习档案.json`。一个孩子一份，跨 skill 复用。

## Schema

```json
{
  "version": 1,
  "child": {"grade": 3},
  "points": {
    "两位数乘法": {
      "errors": [
        {"date": "2026-08-28", "source": "期末练习卷1 选择6", "type": "concept",
         "note": "14×12 漏算 10×2，位值拆分概念不清"}
      ],
      "practice": [
        {"date": "2026-09-01", "assigned": 3, "correct": 2}
      ],
      "status": "weak"
    }
  }
}
```

- `points` 以知识点为主键。知识点用教材常用名词，简短具体（"两位数乘法"、"分数的初步认识"、"植树问题"），不要造长句。
- `errors[].type` 错误类型，**四选一**（见下）；`note` 一句话说明具体表现。
- `practice` 一次强化练习记一条：`assigned` 出题数、`correct` 答对数。
- `status` 由 profile.py 每次写入时自动推导，任何 skill 只读不写：
  - `mastered`：最近一次练习全对，且之后无新增同类错误
  - `improving`：最近一次练习正确率 ≥ 2/3 但未全对
  - `weak`：其余情况（含从未练习过）

## 错误类型（四选一）与处置矩阵

| type | 含义 | 典型表现 | 处置 |
|---|---|---|---|
| `concept` | 概念不清 | 14×12 漏算 10×2；分数丢掉分母 | 转 visual-explain 重讲概念 + 出变式 |
| `reading` | 审题偏差 | 看到"少"就减；漏看"一共" | 出"陷阱辨认"变式（改问法/改方向） |
| `calc` | 计算粗心 | 进位错、抄错数、竖式对错位 | 出同类型口算/竖式短练，不重讲 |
| `method` | 方法缺失 | 应用题无从下手、不会画线段图 | 先示范建模（转 visual-explain）再出变式 |

拿不准时选 `concept` 并在 note 里说明疑点——宁重勿轻，讲一遍的代价小于漏掉概念漏洞。

## 判题

练习判题用 `scripts/quiz.py`，与档案联动（`--profile` 参数自动记 practice）。quiz 文件的每道题必须自带 `verification` 表达式（沙箱求值，只支持算术与比较），出题后先 `quiz.py verify` 自检，全过才允许交付——**题出出来就必须是可机器判的、且答案可证明正确**。
