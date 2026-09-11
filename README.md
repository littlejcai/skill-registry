# skill-registry

Skill 注册管理仓库，统一收纳自用的 Agent skills。

## 结构

```
skills/
  <skill-name>/
    SKILL.md
    references/   # 可选，技能引用的模板、资料
    scripts/      # 可选，技能用到的脚本
```

## 技能列表

| 技能 | 说明 | 来源 |
| --- | --- | --- |
| [preview-lesson](skills/preview-lesson/SKILL.md) | 按教材版本、年级学期、课次生成一页 A4 提问式预习单 | 本仓库 |
| [visual-explain](skills/visual-explain/SKILL.md) | 把小学数学题或抽象概念变成"看图就懂"的可视化讲解（线段图/分物图/方格面积等），产出自包含 Markdown | 本仓库 |
| [diagnose-quiz](skills/diagnose-quiz/SKILL.md) | 错题四类归因记入学习档案，针对弱点生成带机器验证的变式练习卷并自动判题 | 本仓库 |
| [cuoti-fast](skills/cuoti-fast/SKILL.md) | 从批改过的试卷照片一次读页识别错题，批量重绘插图，几分钟内产出自包含 Markdown 错题集 | 本仓库 |

## 收录的外部技能（仅链接，不复制源码）

| 技能 | 说明 | 链接 | 许可证 |
| --- | --- | --- | --- |
| 文章透视镜 article-lens | 批判性阅读教练：判断文章值不值得读，拆解事实/主张/证据/推理/情绪/意图，A–D 分级 | [vickysy/article-lens](https://github.com/vickysy/article-lens) | MIT |
| 仓颉 cangjie-skill | 把书、长视频、播客等高价值内容蒸馏成可执行的 Agent Skills | [kangarooking/cangjie-skill](https://github.com/kangarooking/cangjie-skill) | MIT |
| 达尔文 darwin-skill | Skill 自动优化器：9 维评分 + 爬山迭代 + 盲评验证 | [alchaincyf/darwin-skill](https://github.com/alchaincyf/darwin-skill) | MIT |
| 花叔设计 huashu-design | HTML 原生设计 Skill：高保真原型 / 幻灯片 / 动画 + 20 设计哲学 + 5 维评审 + MP4 导出 | [alchaincyf/huashu-design](https://github.com/alchaincyf/huashu-design) | MIT |
| 思维棱镜 thought-prism | 把一个想法折射成多学科认知光谱，提供多角度写作建议 | [vickysy/thought-prism-skill](https://github.com/vickysy/thought-prism-skill) | Proprietary |
