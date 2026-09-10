#!/usr/bin/env python3
"""check_output.py — 错题集 Markdown 结构门禁。

检查：
- 每道 `### 错题 N` 都包含：题干行、❌/✅ 答案对照表、💡 讲解行；
- 所有 `img:` 占位符能在图片目录中找到文件，且不越出该目录；
- 身份文字门禁：出现"姓名：张三"这类带真实值的身份字段即 FAIL（空栏"姓名：____"放行）；
- 汇总 错题数 / 缺要素题号 / 缺失图片。

用法：
    python3 check_output.py 错题集.md --img-dir IMG_DIR   # 完整门禁（插图版）
    python3 check_output.py 错题集.md --skip-images       # 结构+身份门禁（文字版首次交付前）
退出码非零即存在必须修复的问题。
"""

import argparse
import re
import sys
from pathlib import Path

# Windows GBK 控制台打印中文/emoji 防崩
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HEADING = re.compile(r"^###\s+错题\s*(\d+)", re.M)
PLACEHOLDER = re.compile(r"!\[[^\]]*\]\(img:([^)]+)\)")
ANY_IMAGE = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")
# 身份字段值（关键词+冒号/表格单元格后跟实际内容）；空栏"姓名：____"放行；
# 关键词前不得紧跟汉字（"光明学校：共240人""起名字：…"叙述不误伤），
# 但"考生/学生/本人/孩子/家长/监护人/教师/幼儿/我的"等字段前缀豁免（"考生姓名：张三"仍拦截）
_ID_KEYS = r"姓名|名字|班级|学号|学籍号|考生号|学校|考号|座号|准考证号?"
_ID_PREFIX = r"(?:(?<![一-鿿])|(?<=考生)|(?<=学生)|(?<=本人)|(?<=孩子)|(?<=家长)|(?<=监护人)|(?<=教师)|(?<=幼儿)|(?<=我的))"
IDENTITY = re.compile(rf"{_ID_PREFIX}({_ID_KEYS})\s*[:：]\s*([^\s　|,，。；;]*)")
IDENTITY_TABLE = re.compile(rf"\|\s*({_ID_KEYS})\s*\|\s*([^|]*?)\s*\|")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("markdown", type=Path)
    parser.add_argument("--img-dir", type=Path, default=None)
    parser.add_argument("--skip-images", action="store_true",
                        help="只查结构+身份文字，不查图片占位符（文字版首次交付前用）")
    args = parser.parse_args()

    text = args.markdown.read_text(encoding="utf-8")
    problems = []

    headings = list(HEADING.finditer(text))
    if not headings:
        problems.append("没有找到任何 `### 错题 N` 小节")

    # 每道错题小节的四要素
    sections = []
    for i, m in enumerate(headings):
        end = headings[i + 1].start() if i + 1 < len(headings) else len(text)
        sections.append((m.group(1), text[m.start():end]))
    for num, body in sections:
        missing = []
        if "❌" not in body or "✅" not in body:
            missing.append("答案对照表")
        if "💡" not in body:
            missing.append("💡 讲解")
        body_lines = [ln for ln in body.splitlines()[1:] if ln.strip() and not ln.startswith(("|", ">", "!", "```", "*", "---"))]
        if not body_lines:
            missing.append("题干")
        if missing:
            problems.append(f"错题 {num} 缺少: {', '.join(missing)}")

    # 图片占位符
    placeholders = PLACEHOLDER.findall(text)
    if not args.skip_images:
        # 形似的错误引用（如 img/ 手误）不能漏网
        for target in ANY_IMAGE.findall(text):
            t = target.strip()
            if not (t.startswith("img:") or t.startswith("http:") or t.startswith("https:") or t.startswith("data:")):
                problems.append(f"无法识别的图片引用（应为 img: 占位符）: {target}")
        if placeholders and args.img_dir is None:
            problems.append(f"存在 {len(placeholders)} 个 img: 占位符但未给 --img-dir")
    if args.img_dir:
        root = args.img_dir.resolve()
        for name in placeholders:
            target = (root / name.strip()).resolve()
            try:
                target.relative_to(root)
            except ValueError:
                problems.append(f"图片路径越出目录: {name}")
                continue
            if not target.is_file():
                problems.append(f"图片不存在: {name}")

    total = len(headings)
    # 身份文字硬闸门：空栏放行，出现真实身份值即 FAIL
    for lineno, line in enumerate(text.splitlines(), 1):
        hits = [(k, v) for k, v in IDENTITY.findall(line) if v.strip("_＿-—– ")]
        hits += [(k, v) for k, v in IDENTITY_TABLE.findall(line) if v.strip("_＿-—– ")]
        for k, v in hits:
            problems.append(f"疑似身份文字（第 {lineno} 行）: {k}：{v} —— 删除后重跑，不得放过")

    if problems:
        print(f"FAIL: {total} 道错题，{len(problems)} 个问题")
        for p in problems:
            print(f"  - {p}")
        sys.exit(1)
    print(f"OK: {total} 道错题，四要素齐全，{len(placeholders)} 个插图占位符全部可解析")


if __name__ == "__main__":
    main()
