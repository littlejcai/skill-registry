#!/usr/bin/env python3
"""试卷/文档图片分层识别工具：裁剪指定区域并放大、增强对比度，用于高精度读取手写内容。

用法:
  单区域:
    python3 crop_zoom.py <image> <x0,y0,x1,y1> [--zoom N] [--contrast F] [--gray] [--out OUT] [--coords pixel|permille|ratio] [--split]
  批量（推荐，一次裁完所有歧义区/列）:
    python3 crop_zoom.py <image> --batch regions.json --outdir /tmp [--split]
    regions.json 示例:
    [
      {"name": "b1", "box": [1200,985,1490,1105], "zoom": 6, "gray": true, "contrast": 2.0, "coords": "permille"},
      {"name": "col_fill", "box": [450,850,1520,1430], "zoom": 3, "split": true}
    ]

坐标与单位（--coords，默认 pixel）:
  - pixel:    原图像素坐标（左上角原点），默认。
  - permille: Read/OCR 返回的千分比坐标（0~1000），脚本自动换算为像素，免手工换算。
  - ratio:    归一化坐标（0~1），同样自动换算。

自动分块（--split）:
  当裁剪放大后单边 > 4000px（Read 会过滤）时，把大区域（如整栏答案列）自动切成多块，
  每块含 60px 重叠（源像素域）保证跨界文字完整，输出 name_p1.png / name_p2.png …。
  推荐用法：同一栏的多个候选合并成一个"列 box" + --split，一次裁剪 + 一次并行 Read 读完整列。

示例:
  # 千分比坐标直接裁剪（免换算）
  python3 crop_zoom.py paper.jpg 140,950,250,990 --zoom 8 --coords permille --gray --contrast 2.0
  # 整栏合并 + 自动分块：填空栏一列出 2 张，并行 Read
  python3 crop_zoom.py paper.jpg 450,850,1520,1430 --zoom 3 --split --outdir /tmp
"""
import argparse
import json
import math
import os
from PIL import Image, ImageEnhance

MAX_SIDE = 3600          # 输出单边安全上限（Read 过滤线 4000，留余量）
OVERLAP = 60             # 分块重叠（源像素域），保证跨界文字完整


def to_pixels(box, img_w, img_h, coords):
    if coords == "permille":
        return (int(box[0] * img_w / 1000), int(box[1] * img_h / 1000),
                int(box[2] * img_w / 1000), int(box[3] * img_h / 1000))
    if coords == "ratio":
        return (int(box[0] * img_w), int(box[1] * img_h),
                int(box[2] * img_w), int(box[3] * img_h))
    return tuple(int(v) for v in box)


def crop_zoom(img, box, zoom, contrast, gray):
    r = img.crop(box)
    r = r.resize((r.width * zoom, r.height * zoom), Image.LANCZOS)
    if contrast != 1.0:
        r = ImageEnhance.Contrast(r).enhance(contrast)
    if gray:
        r = r.convert("L")
    return r


def parse_box(s):
    box = tuple(float(v) for v in s.split(","))
    if len(box) != 4:
        raise SystemExit(f"box 必须为 x0,y0,x1,y1 四个值，收到: {s}")
    return box


def split_blocks(img, box, zoom):
    """把大区域按输出边长 ≤ MAX_SIDE 切成带重叠的块，返回 [(块 box, 序号)]。"""
    w, h = box[2] - box[0], box[3] - box[1]
    out_w, out_h = w * zoom, h * zoom
    if out_w <= MAX_SIDE and out_h <= MAX_SIDE:
        return [(box, 0)]
    # 计算最小块数，使每块输出（含重叠）不超 MAX_SIDE
    nx = max(1, math.ceil(out_w / MAX_SIDE))
    ny = max(1, math.ceil(out_h / MAX_SIDE))
    while (w / nx + 2 * OVERLAP) * zoom > MAX_SIDE:
        nx += 1
    while (h / ny + 2 * OVERLAP) * zoom > MAX_SIDE:
        ny += 1
    blocks = []
    idx = 0
    for j in range(ny):
        y0 = box[1] + j * h / ny
        y1 = box[1] + (j + 1) * h / ny
        y0 = max(box[0] - 0, int(y0 - OVERLAP))          # 垂直重叠
        y1 = int(y1 + OVERLAP)
        for i in range(nx):
            x0 = box[0] + i * w / nx
            x1 = box[0] + (i + 1) * w / nx
            x0 = max(0, int(x0 - OVERLAP))
            x1 = int(x1 + OVERLAP)
            blocks.append(((x0, y0, x1, y1), idx))
            idx += 1
    return blocks


def process_region(img, name, reg, outdir):
    zoom = int(reg.get("zoom", 4))
    contrast = float(reg.get("contrast", 1.5))
    gray = bool(reg.get("gray", False))
    coords = reg.get("coords", "pixel")
    do_split = bool(reg.get("split", False))
    box = to_pixels(reg["box"], img.width, img.height, coords)
    if box[0] >= box[2] or box[1] >= box[3]:
        raise SystemExit(f"region {name} 的 box 非法（需正序）: {reg['box']}")

    blocks = split_blocks(img, box, zoom) if do_split else [(box, 0)]
    for b, i in blocks:
        r = crop_zoom(img, b, zoom, contrast, gray)
        suffix = f"_p{i + 1}" if len(blocks) > 1 else ""
        out = os.path.join(outdir, f"{name}{suffix}.png")
        r.save(out)
        w, h = r.size
        flag = "  <-- 超限警告: 单边>4000, Read 会过滤!" if (w > 4000 or h > 4000) else ""
        print(f"saved: {out}  size={w}x{h}{flag}")


def run_batch(img, regions, outdir):
    for i, reg in enumerate(regions):
        name = reg.get("name", f"b{i}")
        if "box" not in reg:
            raise SystemExit(f"region {name} 缺少 box")
        process_region(img, name, reg, outdir)


def main():
    ap = argparse.ArgumentParser(description="裁剪放大图片区域以高精度读取")
    ap.add_argument("image", help="输入图片路径")
    ap.add_argument("box", nargs="?", default=None, help="x0,y0,x1,y1（单位由 --coords 决定）")
    ap.add_argument("--batch", default=None, help="批量模式：JSON 文件路径，定义多个区域")
    ap.add_argument("--outdir", default=".", help="输出目录，默认当前目录")
    ap.add_argument("--zoom", type=int, default=4, help="放大倍数，默认4")
    ap.add_argument("--contrast", type=float, default=1.5, help="对比度增强系数，默认1.5")
    ap.add_argument("--gray", action="store_true", help="转灰度后再增强")
    ap.add_argument("--coords", choices=["pixel", "permille", "ratio"], default="pixel",
                    help="坐标单位：pixel(默认)/permille(千分比,Read返回)/ratio(0~1)")
    ap.add_argument("--split", action="store_true", help="自动分块：输出单边>3600px 时切成带重叠的小块")
    ap.add_argument("--out", default=None, help="单区域模式输出路径，默认自动命名")
    a = ap.parse_args()

    img = Image.open(a.image)

    if a.batch:
        with open(a.batch, encoding="utf-8") as f:
            regions = json.load(f)
        os.makedirs(a.outdir, exist_ok=True)
        for reg in regions:
            reg.setdefault("coords", a.coords)
            if a.split:
                reg.setdefault("split", True)
        run_batch(img, regions, a.outdir)
        return

    if not a.box:
        raise SystemExit("需要提供 box，或使用 --batch 批量模式")

    box = to_pixels(parse_box(a.box), img.width, img.height, a.coords)
    if box[0] >= box[2] or box[1] >= box[3]:
        raise SystemExit(f"box 坐标非法（需正序）: {a.box}")
    name = a.out or f"crop_{a.box.replace(',', '_')}_z{a.zoom}"
    process_region(img, os.path.splitext(name)[0], {"box": box, "zoom": a.zoom,
                                                    "contrast": a.contrast, "gray": a.gray,
                                                    "split": a.split}, a.outdir or ".")


if __name__ == "__main__":
    main()
