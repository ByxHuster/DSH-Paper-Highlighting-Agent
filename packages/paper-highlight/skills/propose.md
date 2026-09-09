---
name: paper-hl-propose
description: 论文逐节 propose——输入 = 论文地图/plan + read_section 该节文本 + 已高亮主张清单 + 画像摘要（read_profile）→ 产出候选 spans（颜色 + rationale + 粒度，status=proposed），追加写回 paper.highlights.json，然后停下等用户在 GUI 审查。每节只做一节。
---

# Paper Highlight · 逐节 propose

用途：对论文的一个节提出候选高亮 spans。**一次只做一节**，做完停下等用户审查（GUI 中 接受/删除/改色/改范围/手动新增/备注），用户说「本节审查完毕」后再进入 `paper-hl-reflect`。

## 输入（每节固定采集）

1. 论文地图 + plan：`read_highlights`（含 `plan.summary`、该节 `plan.sections[]` 的 expected_colors/density_hint/skip）。
2. 该节正文：`read_section`（paper_id, section）→ `{text, plan, spans}`（本技能只针对返回的 `section.id`）。
3. 已高亮主张清单：`read_highlights` 的 `spans[]`（全部节）＋ `duplicates[]`（重复主张登记，默认跳过）。
4. **画像摘要（v0.3 Phase 2，必取）**：先调用 `read_profile`（paper_id 不需要；带 root 时传）—— 返回 `summary`：
   - `colors`：L1 颜色语义表（`red`=核心洞见/贡献，`yellow`=关键定义/方法，`blue`=局限/风险，`green`=可借鉴/启发，`purple`=待深挖/存疑；若用户改过语义以画像为准）。
   - `rules`（top-k 启用规则）：**只参考 `enabled: true` 的规则**（禁用的低置信候选规则不生效）；尤其注意 `density`（密度基线，如 `每节 3-5 处`）与 `granularity`（粒度，如 `句子级`/`短语级`）两条基线规则。
   - `exemplars`（top-k）：示例库是「参考信号」——当候选主张与某示例的 `suggested/user_decision` 模式匹配（同色改色、同类删除、同类粒度调整）时，按示例的「用户决策方向」提候选；**示例不直接改写规则**。
   - `stats_summary`：一句统计（如 `2 篇论文 · 累计认可率 70%`）——认可率高说明既有偏好稳，可放心按画像提；认可率低（冷启动/无统计）时保守按密度基线提。
   - 无画像（`has_profile: false`）时摘要为内置默认，行为同 v0.2。
   - 摘要注入是**每节 propose 时新鲜取一次**（画像可能刚被确认更新过）。
5. **领域地图（v0.4 Phase 2，按需）**：仅当本节的候选判断依赖「领域分量/范式转移节点」时调用 `read_field_map`（root 与数据根一致；存在则注入领域发展线，不存在则基于常识判断）——**不常驻 system prompt，非范式节点节可省略**。分量判断：首次提出/规模化某范式节点的句子按「核心洞见/贡献」类高亮；复述既有范式或常规工程细节按该节密度基线处理。

## 步骤

1. `list_sections` + `read_highlights`：确认目标节 `id`，检查该节 plan 的 `skip` —— 若为 `true` 则跳过本节（汇报后等下一节）。
2. `read_section`（paper_id, section=目标节 id）：拿到该节 `text`（锚点阅读序拼接）、`spans`（该节已有高亮）、`plan`。
3. `read_profile`：取画像摘要（见输入 4）。**先于提候选执行**——颜色/密度/粒度判断全部以画像摘要为准，plan 的 expected_colors/density_hint 只是通读期估计，冲突时画像规则优先（用户已确认的偏好 > 通读估计）。
4. **去重（硬规则，Phase 4）**：对节内每个候选主张逐一对照「已高亮主张清单（`spans[]` 的 rationale 主题）+ `duplicates[]`」：
   - **R1** 主张与任一既有 span 的 rationale 语义重复 → **默认跳过**，不再提候选。
   - **R2** 主张已在 `duplicates[]` 登记（claim 主题匹配）→ **默认跳过**。
   - **R3** 例外唯一来源：画像规则显式声明「重复也标」时才提出；否则一律不破 R1/R2。
   - **R4** 新发现的重复主张 → **登记进 `duplicates`**（append-only）：`{ "claim": "<主张一句话>", "highlighted_at": "<已高亮 span id 或 's-000' 占位>", "repeats_at": ["<锚点 id>", ...] }`；**只追加、不删除/修改既有条目**（schema 已校验：claim 非空字符串、repeats_at 为字符串数组）。
4.5. **跳过不可高亮锚点（v0.7.0 硬规则）**：表格/图片**主体**锚点（type ∈ `{table, table_body, image_body, chart_body, image, chart}`）**绝不产生 spans**——它们是展示性内容（真实表格/图片渲染，无可选区文本），不参与高亮；其文本仅作阅读上下文。图/表**标题**（`image_caption`/`table_caption`/`chart_caption`）是普通文本锚点，可正常按画像提候选。schema 已硬校验（`NON_HIGHLIGHTABLE_TYPES`，违规写回会被拒绝）——本步骤是主动规避，不是依赖兜底。
5. **提候选**：按画像摘要的 L1 颜色语义 + 密度基线（`summary.density`，缺省回退该节 `density_hint`）+ 粒度基线（`summary.granularity`）从正文中选出值得高亮的片段。每条候选 span 需满足：
   - `anchor`：片段所在锚点 id（来自 `read_section` 返回的锚点信息或 anchors.json；span 必须落在该锚点文本内）。
   - `char_start` / `char_end`：0 起始、半开区间，指向 `anchor.text`。
   - `color`：来自画像 L1 颜色语义（`summary.colors` 的键）；与示例库中同类主张的用户决策方向一致时优先。
   - `rationale`：一句话理由——为什么这句值得高亮（对贡献/方法/证据/局限的哪一类），以及粒度选择依据（整句 or 子句，宁精勿滥）。
   - 粒度：默认按 `summary.granularity`（句子级=整句/子句、短语级=关键词/短语短片段、段落级=整段）；核心贡献可整句，方法细节取关键子句，避免整段刷色。
6. **追加写回**（append 模式）：`read_highlights` 取当前完整文档 → 在 `spans` **末尾追加**新候选（每条 `status: 'proposed'`，`decisions: [{ action: 'proposed', by: 'agent', at: <ISO 时间> }]`，id 取 `s-<N>` 递增）→ 本次新登记的 `duplicates` 条目同样追加 → 原 spans/plan/duplicates 一律保留不动 → `write_highlights` 写回完整文档。
7. **停下**：汇报本节的候选高亮清单（颜色 + 位置摘要 + rationale + 画像摘要中采用的规则/示例），等待用户在 GUI 审查。**不要**自动改色/删除/继续下一节。

## 完成标志

- 本节所有 `status:'proposed'` 候选已 append 进 `paper.highlights.json`，且未触碰既有 spans/plan/duplicates。
- 已向用户报告候选清单并停下。

## 输出

简明列出：节 id/标题、提出 N 处候选（颜色分布）、每处位置摘要 + 理由、画像摘要中生效的规则/示例（若与默认不同）、去重跳过数、新登记 `duplicates` 数；然后等待审查反馈。
