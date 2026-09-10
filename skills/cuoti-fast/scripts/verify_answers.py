#!/usr/bin/env python3
"""verify_answers.py — 沙箱求值页面 JSON 中的 verification 表达式，机器验证答案。

每题的 verification 是算术/比较表达式列表，如 ["15-1 == 14", "14*12 == 168"]。
只允许数字、算术运算符、比较运算符和括号；浮点比较用 1e-9 容差。
任一表达式失败 → 该题 needs_review=true, answer_verified=false。

用法：
    python3 verify_answers.py enriched.json        # 原地更新 enriched.json
"""

import ast
import json
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
            return left < right or close
        if isinstance(op, ast.Gt):
            return left > right and not close
        if isinstance(op, ast.GtE):
            return left > right or close
        raise ValueError("unsupported comparison")
    raise ValueError(f"disallowed syntax: {type(node).__name__}")


def check(expr):
    """返回 (ok, error)。ok=True 表示表达式成立。"""
    try:
        result = eval_node(ast.parse(expr, mode="eval"))
    except (ValueError, SyntaxError, ZeroDivisionError, OverflowError) as exc:
        return False, str(exc)
    if isinstance(result, bool):
        return result, None if result else "expression is false"
    return True, None  # 纯算式（无比较）只要求能算出值


def numbers_in(text):
    """提取文本中的数值（整数/小数），按 float 归一。全角数字不识别，无数字返回空集。"""
    import re
    return {float(m) for m in re.findall(r"\d+(?:\.\d+)?", text or "")}


def answer_in_exprs(q):
    """交叉门禁：correct_answer 含数值时，至少一个数值要出现在 verification 表达式里。
    防"表达式和答案两张皮"（列式与答案无关仍全过的漏洞）。无数值答案或无表达式则放行。"""
    answer_nums = numbers_in(q.get("correct_answer"))
    exprs = q.get("verification") or []
    if not answer_nums or not exprs:
        return True, None
    expr_nums = set()
    for e in exprs:
        expr_nums |= numbers_in(e)
    if answer_nums & expr_nums:
        return True, None
    return False, f"correct_answer 数值 {sorted(answer_nums)} 未出现在任何 verification 表达式中"


def main():
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if not path or not path.is_file():
        print("usage: verify_answers.py enriched.json", file=sys.stderr)
        sys.exit(1)
    data = json.loads(path.read_text(encoding="utf-8"))

    checked = failed = skipped = 0
    for q in data.get("questions", []):
        exprs = q.get("verification") or []
        if not exprs:
            skipped += 1
            continue
        results = []
        ok_all = True
        for expr in exprs:
            ok, error = check(expr)
            results.append({"expr": expr, "ok": ok, "error": error})
            ok_all = ok_all and ok
        cross_ok, cross_error = answer_in_exprs(q)
        ok_all = ok_all and cross_ok
        checked += 1
        q["answer_verified"] = ok_all
        q["verification_results"] = results
        if not ok_all:
            failed += 1
            q["needs_review"] = True
            reasons = [f"{r['expr']} ({r['error']})" for r in results if not r["ok"]]
            if not cross_ok:
                reasons.append(cross_error)
            reason = "verification failed: " + "; ".join(reasons)
            q["review_reason"] = (q.get("review_reason") + "; " + reason) if q.get("review_reason") else reason

    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{data.get('page_id', path.stem)}: verified={checked - failed}/{checked}"
          f", no-expr={skipped}, FAILED={failed}")
    if failed:
        for q in data["questions"]:
            if q.get("answer_verified") is False:
                print(f"  FAIL {q['qid']}: {q['review_reason']}")
        sys.exit(1)


if __name__ == "__main__":
    main()
