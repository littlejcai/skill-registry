#!/usr/bin/env python3
"""figures.py — 可视化讲解组件库：参数化绘制 + 像素自检基线（draw 即自检）。

覆盖高频小学数学讲解图：线段图（建模）、分物图（分数）、数轴、方格面积模型、
条形统计图、植树间隔、垂线段。
每个组件绘制后自动登记一条像素基线检查；全部画完后调 report() 统一自检，
库内组件全 OK 即可免目检；库外自定义图形必须保存后逐张查看核对。

用法（在一次性画图脚本中）：
    import sys; sys.path.insert(0, "scripts目录")
    import figures
    figures.shuzhou("out/f_shuzhou.png", vmax=2000, target=1421)
    figures.bar("out/f_tiaosheng.png", ["不及格","及格","良好","优秀"], [2,4,11,8])
    ok = figures.report()   # 打印逐张自检；任一 FAIL 返回 False

配色：主色 #37474F / 强调 #8D6E63 / 填充 #BCAAA4 / 警示 #B03A2E / 正确 #4A6741。
matplotlib 骨架（库外图形用）：
    import matplotlib; matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(6, 3), dpi=200); ax.axis("off")
    # ... 绘制 ...
    fig.savefig("out.png", bbox_inches="tight"); plt.close(fig)
"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mp
from matplotlib import font_manager
import numpy as np
from PIL import Image

import sys as _sys
for _s in (_sys.stdout, _sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# 自动配置中文字体：找一个可用的 CJK 字体，找不到则保持默认（中文标签会缺字形，自检时需注意）
for _font in ("Microsoft YaHei", "SimHei", "PingFang SC", "Noto Sans CJK SC", "WenQuanYi Micro Hei"):
    try:
        font_manager.findfont(_font, fallback_to_default=False)
        plt.rcParams["font.sans-serif"] = [_font, "DejaVu Sans"]
        plt.rcParams["axes.unicode_minus"] = False
        break
    except Exception:
        continue

C_MAIN, C_ACC, C_FILL, C_WARN, C_OK = "#37474F", "#8D6E63", "#BCAAA4", "#B03A2E", "#4A6741"
_CHECKS = []  # (path, rgb, min_pixels, 说明)


def _reg(path, rgb, min_pixels, what):
    _CHECKS.append((path, rgb, min_pixels, what))


def _save(fig, path):
    fig.savefig(path, bbox_inches="tight")
    plt.close(fig)


def shuzhou(path, vmax=2000, target=None, step=100):
    """数轴（积的估计）：主线+刻度，整千标数字，红色箭头指向 target 并标半角 ?。"""
    fig, ax = plt.subplots(figsize=(6, 1.6), dpi=200)
    ax.axis("off")
    ax.set_xlim(-vmax * 0.06, vmax * 1.06)
    ax.set_ylim(-1, 1.6)
    ax.annotate("", xy=(vmax * 1.025, 0), xytext=(-vmax * 0.03, 0),
                arrowprops=dict(arrowstyle="-|>", color=C_MAIN, lw=1.5))
    for v in range(0, vmax + 1, step):
        long = v % 1000 == 0
        ax.plot([v, v], [0, 0.16 if long else 0.08], color=C_MAIN, lw=1.2 if long else 0.7)
        if long:
            ax.text(v, -0.42, str(v), ha="center", color=C_MAIN, fontsize=10)
    if target is not None:
        ax.annotate("?", xy=(target, 0.06), xytext=(target, 1.1),
                    arrowprops=dict(arrowstyle="-|>", color=C_WARN, lw=1.8),
                    color=C_WARN, fontsize=13, ha="center", fontweight="bold")
        _reg(path, (176, 58, 46), 80, "红箭头+?")
    _save(fig, path)


def mianji(path, a=10, b=4, c=10, d=2):
    """方格面积模型 (a+b)×(c+d)：② b×c、③ a×d 涂色，区域标①②③④。"""
    w, h = a + b, c + d
    fig, ax = plt.subplots(figsize=(5, 4.2), dpi=200)
    ax.axis("off")
    ax.set_xlim(-2.2, w + 2.4)
    ax.set_ylim(-2.6, h + 1.8)
    ax.set_aspect("equal")
    for x in range(w + 1):
        ax.plot([x, x], [0, h], color="#B0BEC5", lw=0.5)
    for y in range(h + 1):
        ax.plot([0, w], [y, y], color="#B0BEC5", lw=0.5)
    ax.add_patch(mp.Rectangle((a, d), b, c, fc=C_FILL, ec="none", alpha=0.55))  # ②
    ax.add_patch(mp.Rectangle((0, 0), a, d, fc=C_FILL, ec="none", alpha=0.55))  # ③
    for x in (0, a, w):
        ax.plot([x, x], [0, h], color=C_MAIN, lw=1.6)
    for y in (0, d, h):
        ax.plot([0, w], [y, y], color=C_MAIN, lw=1.6)
    for (x, y, t) in [(a/2, d+c/2, f"①\n{a}×{c}={a*c}"), (a+b/2, d+c/2, f"②\n{b}×{c}={b*c}"),
                      (a/2, d/2, f"③\n{a}×{d}={a*d}"), (a+b/2, d/2, f"④\n{b}×{d}={b*d}")]:
        ax.text(x, y, t, ha="center", va="center", fontsize=9, color=C_MAIN)
    ax.annotate("", xy=(a, h + 0.8), xytext=(0, h + 0.8), arrowprops=dict(arrowstyle="<->", color=C_ACC))
    ax.annotate("", xy=(w, h + 0.8), xytext=(a, h + 0.8), arrowprops=dict(arrowstyle="<->", color=C_ACC))
    ax.text(a/2, h + 1.25, str(a), ha="center", color=C_ACC)
    ax.text(a + b/2, h + 1.25, str(b), ha="center", color=C_ACC)
    ax.annotate("", xy=(-0.8, h), xytext=(-0.8, d), arrowprops=dict(arrowstyle="<->", color=C_ACC))
    ax.annotate("", xy=(-0.8, d), xytext=(-0.8, 0), arrowprops=dict(arrowstyle="<->", color=C_ACC))
    ax.text(-1.35, d + c/2, str(c), ha="center", va="center", color=C_ACC)
    ax.text(-1.35, d/2, str(d), ha="center", va="center", color=C_ACC)
    _reg(path, (222, 212, 211), 400, "②③涂色块")
    _save(fig, path)


def bar(path, cats, vals, colors=None):
    """条形统计图：柱顶标数值，y 轴取偶数刻度。"""
    fig, ax = plt.subplots(figsize=(4.6, 2.8), dpi=200)
    colors = colors or [C_FILL] * (len(vals) - 2) + [C_ACC, C_OK]
    bars = ax.bar(cats, vals, color=colors, width=0.55)
    for bb, v in zip(bars, vals):
        ax.text(bb.get_x() + bb.get_width() / 2, v + max(vals) * 0.02, str(v),
                ha="center", color=C_MAIN, fontsize=10)
    top = max(vals) + 5
    ax.set_yticks(range(0, top + 1, 2))
    ax.set_ylim(0, top)
    ax.set_ylabel("人数", color=C_MAIN)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color(C_MAIN)
    ax.tick_params(colors=C_MAIN)
    _reg(path, (141, 110, 99), 500, "强调色柱")
    _save(fig, path)


def zhishu(path, n=15, label="12 米"):
    """植树/间隔：n 棵树，首间隔标注，题注 间隔数 = n - 1。"""
    fig, ax = plt.subplots(figsize=(6, 1.5), dpi=200)
    ax.axis("off")
    ax.set_xlim(-0.8, n - 0.2)
    ax.set_ylim(-1.2, 1.6)
    ax.plot([0, n - 1], [0, 0], color=C_MAIN, lw=1.5)
    for i in range(n):
        ax.plot([i, i], [0, 0.42], color=C_OK, lw=1.6)
        ax.plot(i, 0.52, "o", color=C_OK, ms=5)
    ax.annotate("", xy=(1, -0.35), xytext=(0, -0.35), arrowprops=dict(arrowstyle="<->", color=C_ACC))
    ax.text(0.5, -0.75, label, ha="center", color=C_ACC, fontsize=10)
    ax.text((n - 1) / 2, 1.15, f"{n} 棵树 → 间隔数 = {n} - 1 = {n - 1}",
            ha="center", color=C_MAIN, fontsize=10)
    _reg(path, (74, 103, 65), 400, "小树")
    _save(fig, path)


def chuixian(path, perp=158, slants=(220, 329), home="小明家", road="公路"):
    """垂线段最短：红色垂线段标 perp，两条灰色虚线斜路标 slants。"""
    fig, ax = plt.subplots(figsize=(5, 2.8), dpi=200)
    ax.axis("off")
    ax.set_xlim(-0.4, 10.8)
    ax.set_ylim(-1.2, 6.2)
    ax.set_aspect("equal")
    ax.plot([0, 10.4], [0, 0], color=C_MAIN, lw=2.2)
    ax.text(10.1, -0.75, road, color=C_MAIN, fontsize=11)
    hx, hy = 4.5, 5.2
    ax.plot(hx, hy, "o", color=C_MAIN, ms=6)
    ax.text(hx, hy + 0.55, home, ha="center", color=C_MAIN, fontsize=11)
    ax.plot([hx, hx], [hy, 0], color=C_WARN, lw=2)
    ax.text(hx + 0.18, 2.6, f"{perp} 米", color=C_WARN, fontsize=10)
    for (sx, dist, rot) in [(1.6, slants[0], 58), (8.2, slants[1], -48)]:
        ax.plot([hx, sx], [hy, 0], color=C_ACC, lw=1.4, ls="--")
        ax.text((hx + sx) / 2 + (-0.65 if sx < hx else 0.75), 3.1, f"{dist} 米",
                color=C_ACC, fontsize=10, rotation=rot)
    _reg(path, (176, 58, 46), 150, "红色垂线段")
    _save(fig, path)


def xianduan(path, bars, total=None):
    """线段图（建模图）：每行一条带子分段标注，各行同比例可比长短。

    bars: [(行标签, [(段文字, 段宽权重), ...]), ...]
    total: 可选 (文字, (起始行, 结束行))，在右侧画跨行大括号，如 ("一共 ?", (0, 1))
    例（和差问题）：xianduan("f.png", [
        ("蛋黄粽子", [("60 个", 60), ("多 28 个", 28)]),
        ("豆沙粽子", [("60 个", 60)]),
    ], total=("两种一共 ? 个", (0, 1)))
    """
    n = len(bars)
    unit = 10.0 / max(sum(w for _t, w in segs) for _l, segs in bars)
    fig, ax = plt.subplots(figsize=(6, 1.05 * n + 0.5), dpi=200)
    ax.axis("off")
    ax.set_xlim(-3.2, 13.2 if total else 11.2)
    ax.set_ylim(-0.7, n * 1.05)
    barh = 0.52
    for i, (label, segs) in enumerate(bars):
        y = (n - 1 - i) * 1.05
        x = 0.0
        for j, (text, w) in enumerate(segs):
            wu = w * unit
            ax.add_patch(mp.Rectangle((x, y), wu, barh,
                                      fc=C_FILL if j % 2 == 0 else "white",
                                      alpha=0.55 if j % 2 == 0 else 1.0, ec=C_MAIN, lw=1.5))
            if wu >= 1.6:
                ax.text(x + wu / 2, y + barh / 2, text, ha="center", va="center",
                        fontsize=9, color=C_MAIN)
            else:  # 窄段文字放上方
                ax.plot([x + wu / 2, x + wu / 2], [y + barh, y + barh + 0.12], color=C_MAIN, lw=0.8)
                ax.text(x + wu / 2, y + barh + 0.32, text, ha="center", va="center",
                        fontsize=8, color=C_WARN)
            x += wu
        ax.text(-0.25, y + barh / 2, label, ha="right", va="center", fontsize=10, color=C_MAIN)
    if total:
        text, (r0, r1) = total
        top = (n - 1 - r0) * 1.05 + barh
        bot = (n - 1 - r1) * 1.05
        bx = 10.45
        ax.plot([bx, bx + 0.22, bx + 0.22, bx], [top, top, bot, bot], color=C_ACC, lw=1.6)
        ax.text(bx + 0.45, (top + bot) / 2, text, ha="left", va="center",
                fontsize=10, color=C_WARN, fontweight="bold")
    _reg(path, (55, 71, 79), 300, "带子边框")
    _save(fig, path)


def pizza(path, parts=8, groups=(("冬冬", 5), ("莉莉", 3))):
    """分物图（分数初步）：圆均分 parts 份，各组不同涂色，图例标 名字+分数。"""
    palette = [C_FILL, "#A5B8C4", C_ACC, "#D7CCC8"]
    fig, ax = plt.subplots(figsize=(4.6, 3.2), dpi=200)
    ax.axis("off")
    ax.set_aspect("equal")
    ax.set_xlim(-1.5, 2.6)
    ax.set_ylim(-1.6, 1.6)
    start = 90.0
    step = 360.0 / parts
    gi = 0
    left = parts
    drawn = 0
    for gi, (name, cnt) in enumerate(groups):
        for k in range(cnt):
            ax.add_patch(mp.Wedge((0, 0), 1.18, start - (drawn + 1) * step, start - drawn * step,
                                  fc=palette[gi % len(palette)], alpha=0.7, ec=C_MAIN, lw=1.2))
            drawn += 1
        left -= cnt
    for k in range(left):  # 剩余不涂色
        ax.add_patch(mp.Wedge((0, 0), 1.18, start - (drawn + 1) * step, start - drawn * step,
                              fc="white", ec=C_MAIN, lw=1.2))
        drawn += 1
    ax.add_patch(plt.Circle((0, 0), 1.18, fc="none", ec=C_MAIN, lw=1.8))
    for gi, (name, cnt) in enumerate(groups):
        y = 1.25 - gi * 0.5
        ax.add_patch(mp.Rectangle((1.55, y - 0.09), 0.24, 0.24, fc=palette[gi % len(palette)],
                                  alpha=0.7, ec=C_MAIN, lw=1))
        ax.text(1.9, y + 0.03, f"{name}：{cnt}/{parts}", ha="left", va="center",
                fontsize=10, color=C_MAIN)
    _reg(path, (188, 170, 164), 300, "涂色扇形")
    _save(fig, path)


def _count(path, rgb, tol=40):
    a = np.array(Image.open(path).convert("RGB")).astype(int)
    return int((np.abs(a - np.array(rgb)).sum(axis=2) < tol).sum())


def report():
    """逐张像素自检；任一 FAIL 返回 False。库内组件全 OK 即可免目检。"""
    ok = True
    for path, rgb, thr, what in _CHECKS:
        c = _count(path, rgb)
        good = c >= thr
        ok = ok and good
        print(f"{path}: {what} 像素 {c} {'OK' if good else 'FAIL!'}")
    return ok
