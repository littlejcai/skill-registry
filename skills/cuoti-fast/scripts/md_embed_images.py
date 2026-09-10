#!/usr/bin/env python3
"""md_embed_images.py — 把 Markdown 中的图片占位符替换为 base64 内嵌 data URI。

在 Markdown 里用占位符引用插图:
    ![跳绳成绩统计图](img:f_tiaosheng.png)

执行后占位符被替换为压缩后的 JPEG data URI，Markdown 可脱离图片目录独立打开。

用法:
    python3 md_embed_images.py INPUT.md IMG_DIR [-o OUTPUT.md] [--max-width 760] [--quality 82]

- 默认原地写回 INPUT.md；用 -o 另存。
- 已是 http(s) 或 data: 开头的图片链接不受影响。
- 找不到的图片或越出图片目录的路径保留原占位符并警告，退出码 1。
"""
import argparse
import base64
import io
import re
import sys
from pathlib import Path

from PIL import Image

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

PATTERN = re.compile(r"!\[([^\]]*)\]\(img:([^)]+)\)")


def to_data_uri(path, max_width, quality):
    im = Image.open(path).convert("RGB")
    if im.width > max_width:
        im = im.resize((max_width, int(im.height * max_width / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=quality)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("markdown")
    ap.add_argument("img_dir")
    ap.add_argument("-o", "--output")
    ap.add_argument("--max-width", type=int, default=760)
    ap.add_argument("--quality", type=int, default=82)
    args = ap.parse_args()

    text = open(args.markdown, encoding="utf-8").read()
    missing = []
    rejected = []
    image_root = Path(args.img_dir).resolve()

    def repl(m):
        alt, name = m.group(1), m.group(2).strip()
        path = (image_root / name).resolve()
        try:
            path.relative_to(image_root)
        except ValueError:
            rejected.append(name)
            return m.group(0)
        if not path.is_file():
            missing.append(name)
            return m.group(0)
        return f"![{alt}]({to_data_uri(path, args.max_width, args.quality)})"

    result = PATTERN.sub(repl, text)
    out = args.output or args.markdown
    with open(out, "w", encoding="utf-8") as f:
        f.write(result)

    embedded = len(PATTERN.findall(text)) - len(missing) - len(rejected)
    print(f"embedded: {embedded} image(s) -> {out}")
    for name in missing:
        print(f"WARNING: image not found: {name}", file=sys.stderr)
    for name in rejected:
        print(f"WARNING: image path outside image directory rejected: {name}", file=sys.stderr)
    if missing or rejected:
        sys.exit(1)


if __name__ == "__main__":
    main()
