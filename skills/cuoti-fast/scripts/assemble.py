#!/usr/bin/env python3
"""assemble.py — 由 enriched.json 机械组装错题集 Markdown（文字版，零模型生成）。

组装是确定性操作：题干、答案、讲解全部来自页面 JSON，本脚本不创作任何内容。
插图用 img:f_<qid>.png 占位符；table/codeblock 类型的内容取自 figure.content 原文。

用法：
    python3 assemble.py --title "三年级数学错题集" --img-dir img --out 错题集.md enriched1.json [enriched2.json ...]
"""

import argparse
import json
import sys
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def render_question(q, number):
    lines = []
    title = f"### 错题 {number}｜{q['number']}"
    if q.get("source_tag"):
        title += f"（{q['source_tag']}）"
    if q.get("needs_review"):
        title += " ⚠️待复核"
    lines.append(title)
    lines.append("")
    lines.append(q.get("question_text") or "（题干无法辨认，见原卷）")
    lines.append("")

    figure = q.get("figure") or {}
    ftype = figure.get("type", "none")
    caption = figure.get("caption") or None
    if ftype == "redraw":
        name = f"f_{q['qid']}.png"
        cap = caption or (figure.get("spec") or "示意图").split("：")[0]
        lines.append(f"![{cap}](img:{name})")
        lines.append("")
        lines.append(f"*{cap}*")
        lines.append("")
    elif ftype == "crop":
        cap = caption or "原题裁片"
        lines.append(f"![{cap}](img:crop_{q['qid']}.png)")
        lines.append("")
        lines.append(f"*{cap}*")
        lines.append("")
    elif ftype in ("table", "codeblock"):
        content = (figure.get("content") or "").strip()
        if not content:
            raise ValueError(f"{q['qid']}: figure.type={ftype} requires figure.content")
        lines.append(content)
        lines.append("")

    student = q.get("student_answer") or "（无法辨认）"
    correct = q.get("correct_answer") or "（待确认）"
    if q.get("correct_answer"):
        correct = f"**{correct}**"
    if q.get("partial_credit"):
        correct += f"（{q['partial_credit']}）"
    lines.append("| | |")
    lines.append("|---|---|")
    lines.append(f"| ❌ 你的答案 | {student} |")
    lines.append(f"| ✅ 正确答案 | {correct} |")
    lines.append("")
    if q.get("explanation"):
        lines.append(f"> 💡 {q['explanation']}")
        lines.append("")
    lines.append("---")
    lines.append("")
    return lines


def main():
    parser = argparse.ArgumentParser(description="由 enriched.json 机械组装错题集 Markdown")
    parser.add_argument("pages", nargs="+", type=Path)
    parser.add_argument("--title", default="错题集")
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()

    pages = []
    for path in args.pages:
        try:
            pages.append(json.loads(path.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError) as exc:
            print(f"ERROR: cannot load {path}: {exc}", file=sys.stderr)
            sys.exit(1)

    total = sum(len(p.get("questions", [])) for p in pages)
    lines = [f"# {args.title}", ""]
    lines.append("> 文字插图版（插图随后更新本文件）")
    lines.append("> 姓名：__________　班级：__________")
    lines.append("")
    lines.append("## 一、错题总览")
    lines.append("")
    lines.append(f"本次共整理错题 **{total} 道**。")
    lines.append("")
    lines.append("| 卷次 | 得分 | 错题数 |")
    lines.append("|---|---|---|")
    for p in pages:
        paper = p.get("paper") or p.get("page_id") or "未命名"
        score = f"{p['score']} 分" if p.get("score") is not None else "—"
        lines.append(f"| {paper} | {score} | {len(p.get('questions', []))} 道 |")
    lines.append("")
    lines.append("---")
    lines.append("")

    number = 0
    section = 0
    CN = "一二三四五六七八九十"
    for p in pages:
        questions = p.get("questions", [])
        if not questions:
            continue
        section += 1
        paper = p.get("paper") or p.get("page_id") or "未命名"
        score = f"（得分 {p['score']}）" if p.get("score") is not None else ""
        heading_cn = CN[section] if section < len(CN) else str(section + 1)  # 总览占“一”，正文从“二”起
        lines.append(f"## {heading_cn}、{paper} 错题{score}")
        lines.append("")
        for q in questions:
            number += 1
            try:
                lines.extend(render_question(q, number))
            except ValueError as exc:
                print(f"ERROR: {exc}", file=sys.stderr)
                sys.exit(1)

    args.out.write_text("\n".join(lines), encoding="utf-8")
    flagged = [q["qid"] for p in pages for q in p.get("questions", []) if q.get("needs_review")]
    print(f"assembled: {args.out} ({total} 道错题, needs_review={len(flagged)}"
          + (f": {', '.join(flagged)}" if flagged else "") + ")")


if __name__ == "__main__":
    main()
