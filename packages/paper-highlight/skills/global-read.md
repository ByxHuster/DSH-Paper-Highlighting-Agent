---
name: paper-hl-global-read
description: 论文全局通读（两遍阅读第一遍）——构建「论文地图」（章节结构、核心主张清单、领域定位）并写出逐节高亮计划 plan（expected_colors / density_hint / skip），落盘 paper.highlights.json.plan。在逐节 propose 之前必须先执行本技能。
---

# Paper Highlight · 全局通读（global read）

用途：在逐节 propose 之前，先建立对整篇论文的整体认识，并产出「章节级高亮策略计划」。计划先行让用户能在动手前校准预期，避免「Agent 高亮完一节用户全删」。

## 前置

- 已通过 `parse_pdf` 得到 `data/<paper_id>/`（paper.md / anchors.json / meta.json / paper.highlights.json）。
- 本技能产出 `paper.highlights.json.plan`；**只写 plan，不写 spans**（spans 属 `paper-hl-propose`）。

## 输入

1. `list_sections`（paper_id）→ 节索引（id/title/level/kind/empty/plan 状态）。可审查节 = `kind !== 'paper_title' && !empty`（空 References 等跳过）。
2. 全文：`read_file` `data/<paper_id>/paper.md`（一次读全文最省 token；也可对每个可审查节用 `read_section` 分节读）。
3. `read_highlights`（paper_id）→ 现有 plan/spans/duplicates（首跑为空）。

## 步骤

1. **读节索引**：调用 `list_sections`，列出全部可审查节（跳过 paper_title 与 empty）。
2. **读全文**：`read_file` paper.md，按节定位正文；必要时用 `read_section` 补读重点节原文。
3. **构建论文地图**（先在心里/笔记里组织，最终只落盘到 plan 的 summary 与各节条目）：
   - 章节结构：编号 + 标题 + 层级（如 1.1 / 2.2 的父子关系）。
   - 核心主张清单：把论文内容映射到四类——**贡献**（本文提出/改进什么）、**方法**（模型/算法/实验设计）、**实验与证据**（数据集、指标、结论）、**局限/风险**（作者承认或可推知的边界）。
   - 领域定位：对照 `field-map.md`（若 workspace 内有）；否则基于常识做简要定位（继承谁、挑战谁、可能引领什么）。领域地图不常驻 system prompt，这里按需注入。
   - 去重提示：记录明显重复出现的主张（如方法在多处复述），供 propose 时登记 `duplicates` 并默认跳过。
4. **写出逐节计划 plan**：
   - 对每个可审查节写一条 `plan.sections[]`：
     - `id`：该节 id（与 `list_sections` 一致，如 `s3`）
     - `section`：节的显示名（`title`）
     - `expected_colors`：预期颜色分布，来自画像 L1 颜色语义（默认：`red`=核心洞见/贡献，`yellow`=关键定义/方法，`blue`=局限/风险，`green`=可借鉴/启发，`purple`=待深挖/存疑）；该节以哪类内容为主就放哪类颜色，2–3 个为宜
     - `density_hint`：该节建议高亮密度，写成可读字符串，如 `"3-5 处"`、`"稀疏 1-2 处"`、`"密集 6-8 处"`——按节的信息量定
     - `skip`：低价值/纯铺垫/致谢类节置 `true`（propose 时跳过）
     - 不要写 `status`/`reviewed_at`（那是审查闭环 host 写入的字段，Agent 不写）。
   - `plan.summary`：一段话概括全文高亮策略（论文地图的核心结论：这篇论文值得高亮什么、用哪类颜色主导、重点在哪几节）。
5. **落盘**：`read_highlights` 取当前完整文档 → 改 `plan`（保留 `spans`/`duplicates` 原样）→ `write_highlights` 写回完整文档（§4.2 契约：write 传全量文档）。

## 完成标志

- `list_sections` 每个可审查节在 `plan.sections` 中都有条目（expected_colors/density_hint/skip 齐全），`plan.summary` 非空。
- 未改动任何 spans。

## 输出

向用户简要汇报：节索引概览、plan 摘要、重点节、skip 节；然后等待用户校准计划，或直接进入 `paper-hl-propose`（逐节）。
