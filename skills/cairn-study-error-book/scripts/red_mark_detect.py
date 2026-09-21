#!/usr/bin/env python3
"""批改痕迹（红笔/深色笔）定位工具：检测图片中的彩色笔迹并输出区域报告。

用法:
  # 全图红笔定位：输出可视化图 + 按行聚类的笔迹区域报告
  python3 red_mark_detect.py paper.jpg --out marks.png

  # 对某个区域采样颜色统计（判断该处笔迹是红/黑/灰）
  python3 red_mark_detect.py paper.jpg --sample 540,900,660,990

输出:
  - <out> 可视化图：检测到的笔迹高亮为红色，其余压暗
  - stdout 区域报告：每个笔迹带的 y 范围、x 范围、像素数

注意事项（重要）:
  - 翻拍/复印/扫描后，红笔可能呈现深灰或黑色（红通道不再显著），
    此时"颜色检测"会漏报。因此：
      1) 颜色检测只用于【定位】可能被批改的区域；
      2) 判定对错必须以【内容】为准——划掉=原答案错、旁侧更正=正确答案、✓=对。
  - 建议结合 crop_zoom.py 对报告命中的区域高倍放大，人工/视觉确认内容。
"""
import argparse
import numpy as np
from PIL import Image


def main():
    ap = argparse.ArgumentParser(description="定位批改痕迹（红笔等）区域")
    ap.add_argument("image", help="输入图片路径")
    ap.add_argument("--out", default="red_marks.png", help="可视化输出路径")
    ap.add_argument("--row-gap", type=int, default=20, help="行聚类间隔像素，默认20")
    ap.add_argument("--min-cnt", type=int, default=3, help="每行最少像素数，默认3")
    ap.add_argument("--sample", default=None, help="x0,y0,x1,y1 采样区域颜色统计")
    a = ap.parse_args()

    arr = np.array(Image.open(a.image).convert("RGB")).astype(int)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    redish = (r > 120) & (r - g > 50) & (r - b > 50)

    vis = np.zeros_like(arr)
    vis[redish] = [255, 50, 50]
    vis[~redish] = (arr[~redish] * 0.2).astype(int)
    Image.fromarray(vis.astype("uint8")).save(a.out)
    print(f"red pixel count: {int(redish.sum())}")
    print(f"visualization saved: {a.out}")

    rows = np.where(redish.sum(axis=1) > a.min_cnt)[0]
    if len(rows):
        groups = []
        start = prev = rows[0]
        for y in rows[1:]:
            if y - prev > a.row_gap:
                groups.append((start, prev))
                start = y
            prev = y
        groups.append((start, prev))
        for g0, g1 in groups:
            seg = redish[g0 : g1 + 1, :]
            cs = np.where(seg.sum(axis=0) > 0)[0]
            if len(cs):
                print(f"band y {g0}-{g1}: x {cs.min()}-{cs.max()}, px {int(seg.sum())}")

    if a.sample:
        x0, y0, x1, y1 = (int(v) for v in a.sample.split(","))
        reg = arr[y0:y1, x0:x1]
        rr, gg, bb = reg[:, :, 0].flatten(), reg[:, :, 1].flatten(), reg[:, :, 2].flatten()
        dark = (rr < 200) & (gg < 200) & (bb < 200)
        n = int(dark.sum())
        if n == 0:
            print(f"sample {a.sample}: no dark pixels")
        else:
            re = int((((rr[dark] - gg[dark]) > 25) & ((rr[dark] - bb[dark]) > 25)).sum())
            bl = int(((bb[dark] - rr[dark]) > 25).sum())
            print(
                f"sample {a.sample}: dark={n} redish={re} blueish={bl} blackish={n - re - bl}"
            )


if __name__ == "__main__":
    main()
