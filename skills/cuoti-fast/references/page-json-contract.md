# 页面 JSON 契约

每页一个文件 `pXXX.json`，由读图后直接写出。只输出 JSON，不要散文。

```json
{
  "page_id": "p001",
  "paper": "练习卷一",
  "score": 86,
  "identity_text_found": false,
  "questions": [
    {
      "qid": "p001-q01",
      "number": "填空第 1 题",
      "source_tag": null,
      "question_text": "13 元 5 角写成小数是（　　）元；5 厘米写成分数是 (　　)/(　　) 分米。",
      "student_answer": "20.5 元",
      "correct_answer": "13.5 元",
      "partial_credit": "第二空 5/10 做对了",
      "explanation": "1 角＝0.1 元，5 角＝0.5 元，所以 13 元 5 角＝13.5 元。整数部分是 13，不要写成 20。",
      "verification": ["13 + 5*0.1 == 13.5"],
      "bbox": {"x": 60, "y": 400, "width": 900, "height": 220},
      "figure": {"type": "none", "has_marks": false, "spec": null},
      "confidence": "high",
      "needs_review": false,
      "review_reason": null
    }
  ]
}
```

## 字段规则

- `paper`：卷次名，从卷面标题识别；识别不出用 `null`。
- `score`：卷面可见得分（数字）；不可见用 `null`。
- `identity_text_found`：读到姓名/学校/班级/学号等身份文字时为 `true`（触发补遮盖流程）。
- `qid`：`pXXX-qNN`，页内递增，稳定不重复。
- `number`：题号原文，如"填空第 4 题""选择第 3 题"。
- `source_tag`：题旁印刷的来源标注（如"2025·南通如皋市期末"），没有用 `null`。
- `question_text`：忠实转写印刷题干，含选项（`A. …　B. …`）。公式用文字：`×`、`÷`、`5/10`、`（　　）`。看不清的片段写 `null` 并 `needs_review: true`。
- `student_answer`：学生作答原文；涂改写"（涂改）"；完全看不清写 `null`。
- `correct_answer`：你求解得出的答案；多空的题给全。无法确定写 `null` + `needs_review: true`。部分做对时只写错空的答案（做对空交给 `partial_credit` 说明），避免"东、东南（第二空做对了）"这种冗余。
- `partial_credit`：多空/多问中部分做对的说明（如"第二空做对了"）；没有用 `null`。
- `explanation`：1~2 句"怎么算对"，聚焦方法步骤；不写错因标签、不评价孩子。
- `verification`：可机械验证的题必填，算术表达式列表，只含数字和 `+ - * / // % ** ( ) == < <= > >=`，如 `"15-1 == 14"`、`"14*12 == 168"`。单位换算、植树、日期推算都要给出关键算式。无法机械验证（几何辨认、开放题）给 `[]`。**correct_answer 中的数值必须出现在至少一条表达式中**（`verify_answers.py` 强制，防止"列式与答案两张皮"）。
- 列式纪律：`explanation` 里关键数字必须写明出处（如"20＝五月二十五－五月初五"），让每个数都能被回溯到题干——机器只能验算式，列式的合理性靠写出处暴露。
- `bbox`：该题在 **prepared.png** 上的包围盒（像素，含题干、选项、图、作答区）。
- `figure.type`：`none` 无图；`redraw` 需要重绘（`spec` 写清图形类型与关键数值，如"数轴 0~2000 步长100，箭头指约1421"；可选 `caption` 写图注）；`table` 月历等用 Markdown 表格；`codeblock` 竖式用等宽代码块；`crop` 纯情境图直接用裁片。
- `figure.content`：仅 `table` / `codeblock` 必填——完整的 Markdown 表格文本或带 ``` 围栏的代码块文本，组装脚本原样嵌入。
- `figure.has_marks`：图上带有学生答案/批改痕迹时为 `true`——此时 `type` 必须是 `redraw`（重绘洗掉答案）。
- `confidence`：`high`（红叉明确、字迹清晰）/ `medium` / `low`（痕迹含义模糊、字迹难辨）。`low` 必须 `needs_review: true` 并写 `review_reason`。

## 收录范围

- 收录：红叉、红圈、扣分处、作答与批改订正不一致、明显计算错误（即使无红痕但教师有标注）。
- 不收录：全对题、只有对勾的题。
- 拿不准的：收录 + `needs_review: true`，宁多勿漏。
