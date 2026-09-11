---
name: textbook-map
version: 1.0.0
display_name: 教材图谱师
display_name_en: Textbook Mapper
description: "把教材 PDF 拆解成知识点结构并与课程标准匹配：课标基准核验→课标条目转写成带稳定ID的标准层→从教材目录页提取单元结构→逐单元映射课标条目（covers/partial/note）→校验悬空ID→生成 Obsidian 双链知识图谱与 Canvas 主线图。用户说'梳理教材知识点''教材对应课标''做知识图谱''新版本教材也映射一下'时使用。"
description_zh: "把教材 PDF 拆解成知识点结构并与课程标准匹配：先核验现行课标版本并转写为带稳定ID的标准知识点层，再从教材 PDF 目录页提取单元结构，逐单元映射到课标条目（covers/partial/note + 悬空ID校验），最后生成 Obsidian 双链图谱（MOC + 前置关系 Canvas）。适用于新学科、新教材版本的知识图谱构建。"
description_en: "Turn textbook PDFs into a knowledge graph aligned to the national curriculum standard: verify the current standard edition, transcribe its content requirements into a canonical layer with stable IDs, extract unit structure from textbook table-of-contents pages, map each unit to standard entries (covers/partial/note) with dangling-ID validation, then generate an Obsidian vault (MOC + prerequisite Canvas). Use for building subject/textbook knowledge graphs."
---

# 教材图谱师

目标：教材 PDF → 知识点结构 → 与课标标准层匹配 → Obsidian 知识图谱。回答"这本书教什么、和课标什么关系、先学后学怎么排"。

数据与脚本统一放在图谱仓库（默认 `D:\Project\knowledge-graph`，远端 littlejcai/knowledge-graph-for-k12），结构约定：

```
subjects/<学科>/data/kebiao/      # 课标转写（一领域一文件）
subjects/<学科>/data/canonical.json      # 标准层（生成物）
subjects/<学科>/data/<版本>-structure.json  # 教材单元结构
subjects/<学科>/data/<版本>-graph.json      # 单元节点+前置边
subjects/<学科>/mappings/<版本>.json      # 单元→课标映射
sources/<学科>/                    # 课标官方 PDF 源文件
scripts/build_canonical.py / gen_obsidian.py   # 通用脚本，首参数为学科
```

## 原则

1. **课标是唯一基准层**：所有教材版本都只是实例层，映射到课标条目；禁止为迁就教材改动课标文本或 ID。
2. **先核版本再动手**：课标可能有最新修订（如 2022年版2025年修订），先查教育部官网公告交叉验证现行版本，确认内容框架是否变化，再决定基准文本。结论写入 `subjects/<学科>/docs/`。
3. **稳定 ID 不乱改**：ID 规则 `{领域代码}{学段序号}-{主题}-{条目序号}`（如 `SA2-数与运算-1`）。一旦入库，映射文件只增不删；课标修订时新增条目用新 ID，旧 ID 标记弃用而不是复用。
4. **映射必须可校验**：mapping 里每个课标 ID 都要在 canonical.json 里存在，交付前跑校验，0 悬空才准提交。
5. **转写保真**：课标 PDF 常为转曲文档（无文字层），用图像识读逐页转写，转写后抽查核对原页；拿不准的条目在 JSON 里标 note，不猜。

## 工作流程

### 1. 课标基准核验

确认现行课标版本（教育部官网公告 + 至少一个独立来源交叉验证），获取官方 PDF 存入 `sources/<学科>/`，核验结论（现行版本、文号、与所用基准文本的差异）写 `subjects/<学科>/docs/`。

### 2. 课标转写 → 标准层

按 `领域 → 学段 → 主题 → 内容要求` 四层结构，把课标"课程内容·内容要求"转写为 `data/kebiao/<领域>.json`（格式见 scripts/build_canonical.py 文档字符串），然后生成标准层：

```bash
python scripts/build_canonical.py <学科>    # 输出 data/canonical.json，打印条目数
```

### 3. 教材结构提取

从教材 PDF 的**目录页**（图像读取）提取单元清单到 `data/<版本>-structure.json`：册次、单元名、页码、所属领域（初步判断）。单元名必须与目录原文一致，不自己概括。

### 4. 单元 → 课标映射

逐单元写 `mappings/<版本>.json`：

```json
{"book": "三上", "unit": "分数的初步认识",
 "covers": [{"id": "SA2-数与运算-2", "partial": true}],
 "note": "只到同分母加减，不含通分"}
```

- `partial: true` 表示该单元只覆盖条目的一部分；`note` 写清边界。
- 一个单元可映射多条；映射不到任何条目的单元（如总复习）标 `"type": "实践"` 或写 note 说明。
- 前置关系写入 `data/<版本>-graph.json` 的 edges（`type: prerequisite`，单元到单元）。
- 交付前校验：mapping 中所有 ID 存在于 canonical.json，0 悬空。

### 5. 生成 Obsidian 图谱

```bash
python scripts/gen_obsidian.py <学科>           # 默认输出仓库内 vault/<学科>/
python scripts/gen_obsidian.py <学科> <目录>     # 也可输出到外部 vault
```

生成物：课标条目笔记（含前置学段链接）、单元笔记（含覆盖条目与前置单元）、MOC 索引、四领域配色、主线 Canvas。生成后用 Obsidian 打开抽查：双链是否互通、Canvas 边是否合理。

## 扩展入口

- **新教材版本**：只加 `data/<版本>-*.json` + `mappings/<版本>.json`，不动课标层，重跑 gen_obsidian.py。
- **新学科**：从第 1 步走起，学科目录独立，脚本首参数换学科名。
- **课题级细化**：单元再拆课题的方案见 `subjects/math/docs/课题级细化方案.md`（TODO）。
