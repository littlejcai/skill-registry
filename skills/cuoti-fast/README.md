# cuoti-fast

快速错题集 skill：把批改过的试卷照片变成自包含 Markdown 错题集——题干转写、公式文字化、插图批量重绘、答案机器验证，全程几分钟。

设计取舍：**速度优先，接受部分识别误差**。不做逐题人审、错因分类、教材映射；低置信题标 `needs_review` 由用户一眼扫掉。

## 安装

把本目录放到 agent 的 skills 目录（如 `~/.kimi-code/skills/cuoti-fast/`），然后：

```bash
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt   # Windows
python -m venv .venv && .venv/bin/pip install -r requirements.txt       # Linux/macOS
```

## 使用

对 agent 说："整理这张试卷的错题集"并附试卷照片。流程与契约见 `SKILL.md` 和 `references/page-json-contract.md`。

## 隐私

默认**输出过滤**模式：原图上传云端识别，产物不写入姓名/班级/学号/学校。要求"身份信息不上云"时使用传输前遮盖：`prepare.py --mask-auto`（本地 OCR，坐标自动定位）或 `--redact-box`，详见 SKILL.md 隐私节。

## 结构

```
SKILL.md                        # 流程与纪律（agent 直接读这个）
references/page-json-contract.md  # 页面 JSON 契约
scripts/                        # prepare/extract/verify/assemble/figures/check/embed
requirements.txt
```
