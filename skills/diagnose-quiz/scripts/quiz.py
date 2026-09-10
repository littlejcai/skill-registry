#!/usr/bin/env python3
"""quiz.py — 变式练习卷的自检与判题。

quiz.json 格式：
{
  "title": "两位数乘法变式练习",
  "point": "两位数乘法",
  "questions": [
    {"id": "q1", "text": "…", "answer": "168",
     "verification": ["14*12 == 168"]}
  ]
}

每题必须带 verification 表达式（沙箱求值，只支持数字/算术/比较/括号）。
交付前必须先 verify：表达式全部成立、且 answer 数值出现在表达式中，题才算可交付。
孩子做完后 check 判题，可带 --profile 把结果记入学习档案。

用法：
    python3 quiz.py verify quiz.json
    python3 quiz.py check quiz.json --answers '{"q1": "168"}' [--profile 学习档案.json]
"""

import argparse
import ast
import json
import re
import sys
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

TOL = 1e-9

BINOPS = {
    ast.Add: lambda a, b: a + b,
    ast.Sub: lambda a, b: a - b,
    ast.Mult: lambda a, b: a * b,
    ast.Div: lambda a, b: a / b,
    ast.FloorDiv: lambda a, b: a // b,
    ast.Mod: lambda a, b: a % b,
    ast.Pow: lambda a, b: a ** b,
}


def eval_node(node):
    if isinstance(node, ast.Expression):
        return eval_node(node.body)
    if isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
            return node.value
        raise ValueError("only numeric constants allowed")
    if isinstance(node, ast.BinOp) and type(node.op) in BINOPS:
        return BINOPS[type(node.op)](eval_node(node.left), eval_node(node.right))
    if isinstance(node, ast.UnaryOp):
        value = eval_node(node.operand)
        if isinstance(node.op, ast.USub):
            return -value
        if isinstance(node.op, ast.UAdd):
            return value
        raise ValueError("unsupported unary operator")
    if isinstance(node, ast.Compare):
        left = eval_node(node.left)
        if len(node.ops) != 1:
            raise ValueError("chained comparisons not allowed")
        right = eval_node(node.comparators[0])
        op = node.ops[0]
        close = abs(left - right) <= TOL
        if isinstance(op, ast.Eq):
            return close
        if isinstance(op, ast.NotEq):
            return not close
        if isinstance(op, ast.Lt):
            return left < right and not close
        if isinstance(op, ast.LtE):
            return left <= right or close
        if isinstance(op, ast.Gt):
            return left > right and not close
        if isinstance(op, ast.GtE):
            return left >= right or close
        raise ValueError("unsupported comparison")
    raise ValueError(f"disallowed syntax: {type(node).__name__}")


def check_expr(expr):
    """返回 (ok, error)。"""
    try:
        result = eval_node(ast.parse(expr, mode="eval"))
    except (ValueError, SyntaxError, ZeroDivisionError, OverflowError) as exc:
        return False, str(exc)
    if isinstance(result, bool):
        return result, None if result else "expression is false"
    return True, None


def numbers_in(text):
    return {float(m) for m in re.findall(r"\d+(?:\.\d+)?", text or "")}


def load_quiz(path):
    p = Path(path)
    if not p.is_file():
        print(f"ERROR: 找不到 {p}", file=sys.stderr)
        sys.exit(1)
    return json.loads(p.read_text(encoding="utf-8"))


def cmd_verify(path):
    data = load_quiz(path)
    bad = 0
    for q in data.get("questions", []):
        exprs = q.get("verification") or []
        if not exprs:
            print(f"  FAIL {q.get('id')}: 缺少 verification")
            bad += 1
            continue
        for expr in exprs:
            ok, err = check_expr(expr)
            if not ok:
                print(f"  FAIL {q.get('id')}: {expr} ({err})")
                bad += 1
        ans_nums = numbers_in(q.get("answer"))
        expr_nums = set()
        for e in exprs:
            expr_nums |= numbers_in(e)
        if ans_nums and not (ans_nums & expr_nums):
            print(f"  FAIL {q.get('id')}: answer 数值未出现在 verification 中")
            bad += 1
    total = len(data.get("questions", []))
    print(f"{data.get('title', path)}: {total - bad}/{total} 题通过自检")
    if bad:
        sys.exit(1)


def cmd_check(path, answers_json, profile):
    data = load_quiz(path)
    answers = json.loads(answers_json)
    results = []
    for q in data.get("questions", []):
        qid = q.get("id")
        kid = answers.get(qid)
        if kid is None:
            results.append((qid, None, "未作答"))
            continue
        want = numbers_in(q.get("answer"))
        got = numbers_in(str(kid))
        if want:
            ok = got == want
        else:
            ok = str(kid).strip() == str(q.get("answer")).strip()
        results.append((qid, ok, f"孩子答 {kid} / 正确 {q.get('answer')}"))
    done = [r for r in results if r[1] is not None]
    correct = sum(1 for r in results if r[1] is True)
    for qid, ok, detail in results:
        mark = "✅" if ok else ("❌" if ok is False else "⬜")
        print(f"  {mark} {qid}: {detail}")
    print(f"{data.get('title', path)}: 答对 {correct}/{len(results)}"
          + (f"（{len(results) - len(done)} 题未作答）" if len(done) < len(results) else ""))
    if profile:
        import subprocess
        subprocess.run([sys.executable, str(Path(__file__).parent / "profile.py"),
                        "add-practice", profile,
                        "--point", data.get("point", data.get("title", "未标注")),
                        "--assigned", str(len(results)), "--correct", str(correct)],
                       check=True)


def main():
    ap = argparse.ArgumentParser(description="变式练习卷自检与判题")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("verify")
    p.add_argument("quiz")
    p = sub.add_parser("check")
    p.add_argument("quiz")
    p.add_argument("--answers", required=True, help='JSON，如 {"q1": "168"}')
    p.add_argument("--profile", help="学习档案路径，判题结果自动记入")
    args = ap.parse_args()
    if args.cmd == "verify":
        cmd_verify(args.quiz)
    else:
        cmd_check(args.quiz, args.answers, args.profile)


if __name__ == "__main__":
    main()
