#!/usr/bin/env python3
"""prepare.py — 批次预处理：EXIF 归一化 + 页眉/精确框隐私遮盖。

每页输出 normalized.png（仅归一化，本地留存）、prepared.png（已遮盖，供读图）、manifest.json。
只使用 Pillow。

用法：
    python3 prepare.py OUT_DIR IMG1 [IMG2 ...] [--mask-header 0.12] [--redact-box X,Y,WIDTH,HEIGHT] [--mask-auto]
"""

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

import sys
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

VERSION = "cuoti-fast-v1"

IDENTITY_KEYWORDS = ("姓名", "班级", "学号", "学校", "考号", "座号", "准考证")


def auto_identity_boxes(image, scan_top=0.40):
    """本地 OCR 找身份关键词，沿该行整行遮盖。返回 (rects, status)。

    只扫描页面上部 scan_top 比例区域。横向以关键词簇为锚、两端各延 1.5 行高；
    纵向 pad 会避开与本行横向重叠的其他文字行（保护卷标题和相邻栏目）。
    """
    try:
        from rapidocr_onnxruntime import RapidOCR
    except ImportError:
        raise RuntimeError("--mask-auto 需要 rapidocr-onnxruntime：pip install rapidocr-onnxruntime")
    import numpy as np

    engine = RapidOCR()
    result, _ = engine(np.array(image))
    if not result:
        return [], "ocr_empty"
    boxes = []
    for pts, text, _score in result:
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        boxes.append({"x0": min(xs), "y0": min(ys), "x1": max(xs), "y1": max(ys), "text": text})
    limit = image.height * scan_top
    hits = [b for b in boxes
            if any(k in b["text"] for k in IDENTITY_KEYWORDS) and b["y1"] < limit]
    if not hits:
        return [], "not_found"
    # 命中按行分组（y 中心接近的归一行）
    bands = []
    for h in sorted(hits, key=lambda b: (b["y0"] + b["y1"]) / 2):
        cy = (h["y0"] + h["y1"]) / 2
        for band in bands:
            if abs(band["cy"] - cy) < band["lh"]:
                band["hits"].append(h)
                band["cy"] = sum((x["y0"] + x["y1"]) / 2 for x in band["hits"]) / len(band["hits"])
                break
        else:
            bands.append({"cy": cy, "lh": h["y1"] - h["y0"], "hits": [h]})
    rects = []
    for band in bands:
        y0 = min(h["y0"] for h in band["hits"])
        y1 = max(h["y1"] for h in band["hits"])
        lh = y1 - y0
        kx0 = min(h["x0"] for h in band["hits"])
        kx1 = max(h["x1"] for h in band["hits"])
        # 横向：关键词簇两端各延 1.5 行高（盖住手写值）；同行紧邻的 OCR 框
        # （手写名/学号常被单独识别出来）一次性并入，不做链式扩张——
        # 多栏版面里相邻栏的文字行与本行同高，链式扩张会把题目内容吃掉。
        x0 = max(0, round(kx0 - lh * 1.5))
        x1 = round(kx1 + lh * 1.5)
        for b in boxes:
            cy_b = (b["y0"] + b["y1"]) / 2
            if y0 <= cy_b <= y1 and kx1 < b["x0"] <= x1:
                x1 = min(image.width, max(x1, round(b["x1"])))
        # 纵向：上下各 pad 0.35 行高，但不得吃进与本行横向重叠的其他文字行
        # （卷标题常与身份行仅隔十几像素，pad 必须让路）。
        top = max(0, round(y0 - lh * 0.35))
        bot = min(image.height, round(y1 + lh * 0.35))
        for b in boxes:
            if b["x1"] < x0 or b["x0"] > x1:
                continue
            if b["y1"] <= y0:
                top = max(top, round(b["y1"]) + 2)
            elif b["y0"] >= y1:
                bot = min(bot, round(b["y0"]) - 2)
        rects.append((x0, top, x1 - x0, bot - top))
    return rects, "ok"


def safe_stem(path):
    return Path(path).stem.replace("/", "_").replace("\\", "_")


def parse_redact_box(value):
    try:
        x, y, width, height = (int(part) for part in value.split(","))
    except (ValueError, TypeError):
        raise argparse.ArgumentTypeError("redact box must be X,Y,WIDTH,HEIGHT")
    if min(x, y) < 0 or width <= 0 or height <= 0:
        raise argparse.ArgumentTypeError("redact box must have non-negative origin and positive size")
    return x, y, width, height


def grid_preview(image, out_path, step, max_width=1600):
    """带坐标网格的瞄准预览：网格线标注原图像素坐标，用于精确确定 --redact-box。"""
    if image.width > max_width:
        scale = max_width / image.width
        preview = image.resize((max_width, max(1, round(image.height * scale))), Image.Resampling.LANCZOS)
    else:
        scale = 1.0
        preview = image.copy()
    draw = ImageDraw.Draw(preview)
    x = 0
    while x <= image.width:
        sx = round(x * scale)
        draw.line((sx, 0, sx, preview.height), fill="#2563EB", width=1)
        draw.text((sx + 2, 2), str(x), fill="#2563EB")
        x += step
    y = 0
    while y <= image.height:
        sy = round(y * scale)
        draw.line((0, sy, preview.width, sy), fill="#2563EB", width=1)
        draw.text((2, sy + 2), str(y), fill="#2563EB")
        y += step
    preview.save(out_path, quality=88)


def process(path, out_dir, args, page_number):
    with Image.open(path) as source:
        normalized = ImageOps.exif_transpose(source).convert("RGB")

    prepared = normalized.copy()
    draw = ImageDraw.Draw(prepared)
    regions = []
    if args.mask_header > 0:
        height = max(1, round(prepared.height * args.mask_header))
        draw.rectangle((0, 0, prepared.width, height), fill="white")
        regions.append({"type": "header_strip", "box": [0, 0, prepared.width, height]})
    mask_auto_status = None
    if args.mask_auto:
        rects, mask_auto_status = auto_identity_boxes(normalized, args.mask_auto_scan_top)
        for x, y, width, height in rects:
            draw.rectangle((x, y, x + width, y + height), fill="white")
            regions.append({"type": "auto", "box": [x, y, width, height]})
        print(f"  mask-auto: {mask_auto_status} ({len(rects)} 行)")
        if mask_auto_status != "ok":
            print("  WARNING: 未定位到身份关键词，请改用 --mask-header/--redact-box 人工遮盖")
    for x, y, width, height in args.redact_box:
        if x + width > prepared.width or y + height > prepared.height:
            raise ValueError(f"redact box outside image: {(x, y, width, height)} vs {prepared.size}")
        draw.rectangle((x, y, x + width, y + height), fill="white")
        regions.append({"type": "exact", "box": [x, y, width, height]})

    base = safe_stem(path)
    page_id = f"p{page_number:03d}"
    page_dir = Path(out_dir) / page_id
    page_dir.mkdir(parents=True, exist_ok=True)
    normalized_path = page_dir / "normalized.png"
    prepared_path = page_dir / "prepared.png"
    normalized.save(normalized_path)
    prepared.save(prepared_path)
    if args.grid_preview:
        grid_path = page_dir / "grid_preview.jpg"
        grid_preview(normalized, grid_path, args.grid_step)
        print(f"  grid: {grid_path} (坐标=原图像素)")

    manifest = {
        "processing_version": VERSION,
        "page_id": page_id,
        "source_image": str(Path(path).resolve()),
        "normalized_image": str(normalized_path),
        "prepared_image": str(prepared_path),
        "size": {"width": prepared.width, "height": prepared.height},
        "privacy_regions": regions,
        "mask_auto": mask_auto_status,
    }
    manifest_path = page_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{Path(path).name}: {page_id} {prepared.width}x{prepared.height} redactions={len(regions)}")
    print(f"  prepared: {prepared_path}")


def main():
    parser = argparse.ArgumentParser(description="EXIF 归一化 + 隐私遮盖；输出供读图的 prepared.png")
    parser.add_argument("out_dir")
    parser.add_argument("images", nargs="+")
    parser.add_argument("--mask-header", type=float, default=0.12,
                        help="white-out top fraction of page, 0 to disable, max 0.35")
    parser.add_argument("--redact-box", action="append", type=parse_redact_box, default=[],
                        help="exact privacy box X,Y,WIDTH,HEIGHT; repeatable")
    parser.add_argument("--mask-auto", action="store_true",
                        help="本地 OCR 自动定位姓名/班级/学号行并整行遮盖（需 rapidocr-onnxruntime）")
    parser.add_argument("--mask-auto-scan-top", type=float, default=0.40,
                        help="--mask-auto 只扫描页面上部该比例区域")
    parser.add_argument("--grid-preview", action="store_true",
                        help="save coordinate-grid preview (based on normalized image) for aiming --redact-box")
    parser.add_argument("--grid-step", type=int, default=200, help="grid spacing in original-image pixels")
    args = parser.parse_args()
    if not 0 <= args.mask_header <= 0.35:
        parser.error("--mask-header must be between 0 and 0.35")
    Path(args.out_dir).mkdir(parents=True, exist_ok=True)
    for page_number, image in enumerate(args.images, 1):
        if not Path(image).is_file():
            print(f"WARNING: not found: {image}")
            continue
        process(image, args.out_dir, args, page_number)


if __name__ == "__main__":
    main()
