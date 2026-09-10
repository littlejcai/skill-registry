#!/usr/bin/env python3
"""profile.py — 学习档案的唯一读写入口（契约见 references/profile-contract.md）。

skill 通过命令行操作档案，不手写 JSON。status 每次写入自动推导。

用法：
    python3 profile.py init PROFILE --grade 3
    python3 profile.py add-error PROFILE --point 两位数乘法 --type concept --note "..." [--source ...] [--date YYYY-MM-DD]
    python3 profile.py add-practice PROFILE --point 两位数乘法 --assigned 3 --correct 2 [--date ...]
    python3 profile.py summary PROFILE
"""

import argparse
import json
import sys
from datetime import date
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ERROR_TYPES = ("concept", "reading", "calc", "method")


def load(path):
    p = Path(path)
    if not p.is_file():
        print(f"ERROR: 档案不存在：{p}（先 profile.py init）", file=sys.stderr)
        sys.exit(1)
    return json.loads(p.read_text(encoding="utf-8"))


def save(path, data):
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def derive_status(point):
    """mastered: 最近一次练习全对且之后无新增错误；improving: 最近正确率≥2/3；否则 weak。"""
    if not point.get("errors"):
        return "weak"
    last_practice = point["practice"][-1] if point.get("practice") else None
    if not last_practice:
        return "weak"
    if last_practice["correct"] == last_practice["assigned"]:
        later_errors = [e for e in point["errors"] if e["date"] > last_practice["date"]]
        return "weak" if later_errors else "mastered"
    return "improving" if last_practice["correct"] * 3 >= last_practice["assigned"] * 2 else "weak"


def get_point(data, name):
    return data["points"].setdefault(name, {"errors": [], "practice": [], "status": "weak"})


def main():
    ap = argparse.ArgumentParser(description="学习档案读写入口")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("init")
    p.add_argument("profile")
    p.add_argument("--grade", type=int, required=True)

    p = sub.add_parser("add-error")
    p.add_argument("profile")
    p.add_argument("--point", required=True)
    p.add_argument("--type", required=True, choices=ERROR_TYPES)
    p.add_argument("--note", required=True)
    p.add_argument("--source", default="")
    p.add_argument("--date", default=str(date.today()))

    p = sub.add_parser("add-practice")
    p.add_argument("profile")
    p.add_argument("--point", required=True)
    p.add_argument("--assigned", type=int, required=True)
    p.add_argument("--correct", type=int, required=True)
    p.add_argument("--date", default=str(date.today()))

    p = sub.add_parser("summary")
    p.add_argument("profile")

    args = ap.parse_args()

    if args.cmd == "init":
        if Path(args.profile).is_file():
            print(f"档案已存在：{args.profile}（不覆盖）")
            return
        save(args.profile, {"version": 1, "child": {"grade": args.grade}, "points": {}})
        print(f"已建档案：{args.profile}（{args.grade} 年级）")
        return

    data = load(args.profile)

    if args.cmd == "add-error":
        pt = get_point(data, args.point)
        pt["errors"].append({"date": args.date, "source": args.source,
                             "type": args.type, "note": args.note})
        pt["status"] = derive_status(pt)
        save(args.profile, data)
        print(f"{args.point}: +error({args.type}) 共{len(pt['errors'])}次 → {pt['status']}")
    elif args.cmd == "add-practice":
        if not 0 <= args.correct <= args.assigned:
            print("ERROR: correct 必须在 0..assigned 之间", file=sys.stderr)
            sys.exit(1)
        pt = get_point(data, args.point)
        pt["practice"].append({"date": args.date, "assigned": args.assigned, "correct": args.correct})
        pt["status"] = derive_status(pt)
        save(args.profile, data)
        print(f"{args.point}: 练习 {args.correct}/{args.assigned} → {pt['status']}")
    elif args.cmd == "summary":
        if not data["points"]:
            print("档案为空：还没有任何知识点记录")
            return
        for name, pt in data["points"].items():
            types = {}
            for e in pt["errors"]:
                types[e["type"]] = types.get(e["type"], 0) + 1
            prac = ", ".join(f"{p['correct']}/{p['assigned']}" for p in pt["practice"]) or "未练习"
            print(f"[{pt['status']:>9}] {name}: 错误{len(pt['errors'])}次 {types} 练习[{prac}]")


if __name__ == "__main__":
    main()
