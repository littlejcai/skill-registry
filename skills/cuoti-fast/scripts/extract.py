#!/usr/bin/env python3
"""extract.py — 校验页面 JSON 契约，生成每题裁片和 enriched.json。

校验必填字段、类型、bbox 边界、qid 唯一；任何错误都拒绝并退出非零。
Pillow 可用时生成裁片并做 bbox 越界校验；Pillow 缺失时自动降级为纯校验
（跳过裁片与越界校验，enriched.json 照常产出，verify/assemble 不受影响）。

用法：
    python3 extract.py --image prepared.png --json p001.json --out OUT_DIR
"""

import argparse
import json
import sys
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    Image = None

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

REQUIRED_STR = ("qid", "number")
BBOX_KEYS = ("x", "y", "width", "height")
FIGURE_TYPES = ("none", "redraw", "table", "codeblock", "crop")
CONFIDENCE = ("high", "medium", "low")


def fail(msg):
    raise ValueError(msg)


def checked_box(raw, width, height, qid):
    if not isinstance(raw, dict) or any(key not in raw for key in BBOX_KEYS):
        fail(f"{qid}: bbox must contain x, y, width, height")
    x, y, w, h = (round(float(raw[key])) for key in BBOX_KEYS)
    if x < 0 or y < 0 or w <= 0 or h <= 0:
        fail(f"{qid}: bbox has negative origin or non-positive size: {raw}")
    if width is not None and (x + w > width or y + h > height):
        fail(f"{qid}: bbox outside image: {raw} vs {width}x{height}")
    return x, y, x + w, y + h


def validate_question(raw, index, width, height):
    qid = raw.get("qid") or f"q{index:02d}"
    for key in REQUIRED_STR:
        if not isinstance(raw.get(key), str) or not raw[key].strip():
            fail(f"{qid}: missing required string field: {key}")
    for key in ("question_text", "student_answer", "correct_answer"):
        if raw.get(key) is not None and not isinstance(raw[key], str):
            fail(f"{qid}: {key} must be string or null")
    if raw.get("question_text") is None and not raw.get("needs_review"):
        fail(f"{qid}: question_text is null but needs_review is not true")
    confidence = raw.get("confidence", "medium")
    if confidence not in CONFIDENCE:
        fail(f"{qid}: bad confidence: {confidence}")
    if confidence == "low" and not raw.get("needs_review"):
        fail(f"{qid}: confidence=low requires needs_review: true")
    figure = raw.get("figure") or {}
    ftype = figure.get("type", "none")
    if ftype not in FIGURE_TYPES:
        fail(f"{qid}: bad figure.type: {ftype}")
    if figure.get("has_marks") and ftype not in ("redraw",):
        fail(f"{qid}: figure has student marks, type must be redraw (got {ftype})")
    verification = raw.get("verification") or []
    if not isinstance(verification, list) or any(not isinstance(e, str) for e in verification):
        fail(f"{qid}: verification must be a list of expression strings")
    box = checked_box(raw.get("bbox"), width, height, qid)

    q = dict(raw)
    q["qid"] = qid
    q["confidence"] = confidence
    q["needs_review"] = bool(raw.get("needs_review"))
    q["figure"] = {"type": ftype, "has_marks": bool(figure.get("has_marks")),
                   "spec": figure.get("spec"), "caption": figure.get("caption"),
                   "content": figure.get("content")}
    q["verification"] = verification
    q["answer_verified"] = None
    return q, box


def main():
    parser = argparse.ArgumentParser(description="校验页面 JSON 并生成题块裁片")
    parser.add_argument("--image", required=True, type=Path, help="prepared.png（与 JSON 中 bbox 同一坐标系）")
    parser.add_argument("--json", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()

    if Image is None:
        image = None
        print("WARNING: Pillow 不可用——跳过裁片与 bbox 越界校验（仅做结构校验）", file=sys.stderr)
    else:
        with Image.open(args.image) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
    try:
        data = json.loads(args.json.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"ERROR: invalid JSON: {exc}", file=sys.stderr)
        sys.exit(1)

    raw_questions = data.get("questions")
    if not isinstance(raw_questions, list):
        print("ERROR: page JSON must contain a questions list", file=sys.stderr)
        sys.exit(1)

    args.out.mkdir(parents=True, exist_ok=True)
    crops_dir = args.out / "crops"
    crops_dir.mkdir(exist_ok=True)

    questions = []
    seen = set()
    try:
        for index, raw in enumerate(raw_questions, 1):
            q, box = validate_question(raw, index,
                                       image.width if image else None,
                                       image.height if image else None)
            if q["qid"] in seen:
                fail(f"duplicate qid: {q['qid']}")
            seen.add(q["qid"])
            x0, y0, x1, y1 = box
            q["source_bbox"] = {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0}
            if image is not None:
                crop_path = crops_dir / f"{q['qid']}.png"
                image.crop(box).save(crop_path)
                q["crop_image"] = str(crop_path)
            else:
                q["crop_image"] = None
            questions.append(q)
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

    enriched = {
        "page_id": data.get("page_id") or args.json.stem,
        "paper": data.get("paper"),
        "score": data.get("score"),
        "identity_text_found": bool(data.get("identity_text_found")),
        "prepared_image": str(args.image.resolve()),
        "questions": questions,
    }
    out_path = args.out / "enriched.json"
    out_path.write_text(json.dumps(enriched, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    flagged = [q["qid"] for q in questions if q["needs_review"]]
    print(f"{enriched['page_id']}: {len(questions)} question(s), needs_review={len(flagged)}"
          + (f" ({', '.join(flagged)})" if flagged else ""))
    if enriched["identity_text_found"]:
        print("WARNING: identity_text_found=true — 补遮盖后重跑该页再读", file=sys.stderr)
    print(f"enriched: {out_path}")


if __name__ == "__main__":
    main()
