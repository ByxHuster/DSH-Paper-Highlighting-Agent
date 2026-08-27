---
name: paper-hl-propose
description: 论文逐节 propose——输入 = 论文地图/plan + read_section 该节文本 + 已高亮主张清单 + 画像摘要 → 产出候选 spans（颜色 + rationale + 粒度，status=proposed），追加写回 paper.highlights.json，然后停下等用户在 GUI 审查。每节只做一节。
---

# Paper Highlight · 逐节 propose

用途：对论文的一个节提出候选高亮 spans。**一次只做一节**，做完停下等用户审查（GUI 中 接受/删除/改色/改范围/手动新增/备注），用户说「本节审查完毕」后再进入 `paper-hl-reflect`。

## 输入（每节固定采集）

1. 论文地图 + plan：`read_highlights`（含 `plan.summary`、该节 `plan.sections[]` 的 expected_colors/density_hint/skip）。
2. 该节正文：`read_section`（paper_id, section）→ `{text, plan, spans}`（本技能只针对返回的 `section.id`）。
3. 已高亮主张清单：`read_highlights` 的 `spans[]`（全部节）＋ `duplicates[]`（重复主张登记，默认跳过）。
4. 画像摘要：默认使用 L1 颜色语义表（`red`=核心洞见/贡献，`yellow`=关键定义/方法，`blue`=局限/风险，`green`=可借鉴/启发，`purple`=待深挖/存疑）+ 密度建议（该节 density_hint）。若已建立画像（highlight-profile/ 或 reflections.json 的已确认规则），按其规则覆盖默认值。

## 步骤

1. `list_sections` + `read_highlights`：确认目标节 `id`，检查该节 plan 的 `skip` —— 若为 `true` 则跳过本节（汇报后等下一节）。
2. `read_section`（paper_id, section=目标节 id）：拿到该节 `text`（锚点阅读序拼接）、`spans`（该节已有高亮）、`plan`。
3. **去重（硬规则，Phase 4）**：对节内每个候选主张逐一对照「已高亮主张清单（`spans[]` 的 rationale 主题）+ `duplicates[]`」：
   - **R1** 主张与任一既有 span 的 rationale 语义重复 → **默认跳过**，不再提候选。
   - **R2** 主张已在 `duplicates[]` 登记（claim 主题匹配）→ **默认跳过**。
   - **R3** 例外唯一来源：画像规则显式声明「重复也标」时才提出；否则一律不破 R1/R2。
   - **R4** 新发现的重复主张 → **登记进 `duplicates`**（append-only）：`{ "claim": "<主张一句话>", "highlighted_at": "<已高亮 span id 或 's-000' 占位>", "repeats_at": ["<锚点 id>", ...] }`；**只追加、不删除/修改既有条目**（schema 已校验：claim 非空字符串、repeats_at 为字符串数组）。
4. **提候选**：按该节 `expected_colors` 主导色 + `density_hint` 密度，从正文中选出值得高亮的片段。每条候选 span 需满足：
   - `anchor`：片段所在锚点 id（来自 `read_section` 返回的锚点信息或 anchors.json；span 必须落在该锚点文本内）。
   - `char_start` / `char_end`：0 起始、半开区间，指向 `anchor.text`。
   - `color`：来自该节 expected_colors（默认色表）。
   - `rationale`：一句话理由——为什么这句值得高亮（对贡献/方法/证据/局限的哪一类），以及粒度选择依据（整句 or 子句，宁精勿滥）。
   - 粒度建议：默认以句子/子句为粒度；核心贡献可整句，方法细节取关键子句，避免整段刷色。
5. **追加写回**（append 模式）：`read_highlights` 取当前完整文档 → 在 `spans` **末尾追加**新候选（每条 `status: 'proposed'`，`decisions: [{ action: 'proposed', by: 'agent', at: <ISO 时间> }]`，id 取 `s-<N>` 递增）→ 本次新登记的 `duplicates` 条目同样追加 → 原 spans/plan/duplicates 一律保留不动 → `write_highlights` 写回完整文档。
6. **停下**：汇报本节的候选高亮清单（颜色 + 位置摘要 + rationale），等待用户在 GUI 审查。**不要**自动改色/删除/继续下一节。

## 完成标志

- 本节所有 `status:'proposed'` 候选已 append 进 `paper.highlights.json`，且未触碰既有 spans/plan/duplicates。
- 已向用户报告候选清单并停下。

## 输出

简明列出：节 id/标题、提出 N 处候选（颜色分布）、每处位置摘要 + 理由、去重跳过数、新登记 `duplicates` 数；然后等待审查反馈。
