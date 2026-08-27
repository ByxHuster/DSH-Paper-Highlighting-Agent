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
4. **画像摘要（v0.3 Phase 2）**：调用 `read_profile` 取 `summary`——L1 颜色语义表（`colors`）、密度/粒度基线（`rules` 中的 `density` / `granularity`，**只参考 enabled 规则**）、示例库 top-k（`exemplars`，仅参考信号）、一句统计（`stats_summary`）。无画像（`has_profile: false`）时回退内置默认五色。
5. **领域地图（v0.4 Phase 2）**：调用 `read_field_map`（root 与数据根一致）取领域发展线——用于领域定位与范式转移判断（设计 §7，**不常驻 system prompt**）。

## 步骤

1. **读节索引**：调用 `list_sections`，列出全部可审查节（跳过 paper_title 与 empty）。
2. **读全文**：`read_file` paper.md，按节定位正文；必要时用 `read_section` 补读重点节原文。
3. **构建论文地图**（先在心里/笔记里组织，最终只落盘到 plan 的 summary 与各节条目）：
   - 章节结构：编号 + 标题 + 层级（如 1.1 / 2.2 的父子关系）。
   - 核心主张清单：把论文内容映射到四类——**贡献**（本文提出/改进什么）、**方法**（模型/算法/实验设计）、**实验与证据**（数据集、指标、结论）、**局限/风险**（作者承认或可推知的边界）。
   - 领域定位（v0.4 Phase 2，走 `read_field_map`）：先调用 `read_field_map`（输入 5）——
     - **存在**：注入领域发展线，对照主线判断本论文「继承谁 / 挑战谁 / 可能引领什么」，尤其识别**范式转移节点**语句（首次提出/首次规模化某范式的句子分量更重）；
     - **不存在**（`ok:false`）：基于常识做简要定位，并在论文级反思收尾时**提议初建/增补 `field-map.md`**（Phase 3，Agent 用文件工具创建，用户可编辑）；
     - 记录该论文的「定位增量」（候选增补点，供论文级反思落盘）。领域地图不常驻 system prompt，这里按需注入。
   - 去重登记（Phase 4 硬规则）：记录明显重复出现的主张（如方法在多处复述）—— 若该主张已在「核心主张清单」中（即会被高亮），把重复出现的位置记入 `duplicates`（append-only，`{claim, highlighted_at?, repeats_at?}`，`repeats_at` 为重复锚点 id 数组）。propose 时对这些重复位置**默认跳过**（除非画像规则声明「重复也标」）。
4. **写出逐节计划 plan**：
   - 对每个可审查节写一条 `plan.sections[]`：
     - `id`：该节 id（与 `list_sections` 一致，如 `s3`）
     - `section`：节的显示名（`title`）
     - `expected_colors`：预期颜色分布，来自画像摘要 L1 颜色语义（`read_profile` 的 `summary.colors` 键；默认五色：`red`=核心洞见/贡献，`yellow`=关键定义/方法，`blue`=局限/风险，`green`=可借鉴/启发，`purple`=待深挖/存疑）；该节以哪类内容为主就放哪类颜色，2–3 个为宜
     - `density_hint`：该节建议高亮密度，写成可读字符串，如 `"3-5 处"`、`"稀疏 1-2 处"`、`"密集 6-8 处"`——先按节的信息量定，再参照画像摘要的 `summary.density` 基线（如用户基线 `每节 3-5 处`，则高信息量节 `"4-6 处"`、低信息量节 `"2-3 处"`）
     - `skip`：低价值/纯铺垫/致谢类节置 `true`（propose 时跳过）
     - 不要写 `status`/`reviewed_at`（那是审查闭环 host 写入的字段，Agent 不写）。
   - `plan.summary`：一段话概括全文高亮策略（论文地图的核心结论：这篇论文值得高亮什么、用哪类颜色主导、重点在哪几节）。
5. **落盘**：`read_highlights` 取当前完整文档 → 改 `plan`（保留 `spans`/`duplicates` 原样）→ `write_highlights` 写回完整文档（§4.2 契约：write 传全量文档）。

## 完成标志

- `list_sections` 每个可审查节在 `plan.sections` 中都有条目（expected_colors/density_hint/skip 齐全），`plan.summary` 非空。
- 未改动任何 spans。

## 输出

向用户简要汇报：节索引概览、plan 摘要、重点节、skip 节；然后等待用户校准计划，或直接进入 `paper-hl-propose`（逐节）。
