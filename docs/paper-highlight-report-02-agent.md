# 汇报文档 02 —— Paper Highlight Agent 的工作流程与结构

> 面向"这个 Agent 怎么干活、怎么长这样"的说明，不涉及前端渲染细节。

## 1. 一句话

一个**人机协作的论文多色高亮 Agent**：Agent 提出候选，人在 GUI 审查，Agent 从审查结果中学习画像；所有状态落盘为纯 JSON，Agent 与 GUI 共享同一数据源。

## 2. 分层结构

```
决策层   12 个工具（host/tools.js）+ 3 个技能（skills/）—— Agent 的能力面
服务层   host/plugin.js —— /paper-hl/* HTTP 路由（读/写/画像/导出/格式化/图片）
治理层   actions/sections/export/format/reflection/diff —— 业务规则与导出
存储层   host/store.js + schema.js —— 落盘与校验（append-only 决策日志）
解析层   host/mineru.js + normalize.js + pipeline.js —— PDF → 论文正文
数据层   data/<paper_id>/（paper.md + anchors.json + paper.highlights.json）
画像层   highlight-profile/（colors/rules/exemplars/stats 四层）
```

## 3. 主流程（三轮协作）

```
① 解析     parse_pdf → MinerU 云 API → normalize（保留正文/公式/表格/图片）
② 计划     paper-hl-global-read：通读全文 → 逐节高亮计划 plan（颜色/密度/跳过）
③ 提出     paper-hl-propose：逐节读正文 → 写 proposed spans → 停下等审查
④ 审查     你：GUI 接受/否决/改色/改范围/加备注（决策写入 append-only 日志）
⑤ 反思     paper-hl-reflect：重读 JSON、差异分析 → 画像更新提案 reflections.json
⑥ 合并     你在 GUI 提案面板确认 → confirm_proposal 由 host 合并进画像
⑦ 收尾     论文完毕 → reflect_paper（论文级反思 + 领域发展线 field-map 增强）
```

**一次只推进一节**：propose 一节 → 你审查 → 才进入下一节；计划可先在 GUI 校准。

## 4. 数据模型（核心设计）

- **anchor 契约**：`paper.md` 与 `anchors.json` 由解析器同源重建，每个 anchor 的 `text` 必在 `paper.md` 的 `md_offset` 处出现——**锚点不指向 DOM**，渲染层无论如何改版，数据都不动。
- **paper.highlights.json**（自包含）：锚点 + spans + 计划 + 去重 + 决策日志；spans 的 `decisions[]` **append-only**，每次操作留痕（供反思与审计）。
- **数据零改动（D1）**：解析/渲染/学习流程从不改数据；只有你在 GUI 审查时才写入。

## 5. 画像系统（越用越懂你）

- **四层画像**：`colors.yml`（颜色语义）→ `rules.json`（可停用的规则）→ `exemplars.json`（示例）→ `stats.json`（统计）。
- **防污染**：Agent 只产出**提案**（`reflections.json`），由你确认后 host 合并（`confirm_proposal`）；低置信规则以"禁用候选"入库，待未来证据启用。
- 冷启动：无画像时用内置默认（5 色）也能工作，随审查逐步个性化。

## 6. 治理与质量闸门

| 闸门 | 含义 |
|---|---|
| G1 | bundle 内嵌能力完备（渲染函数/内联 KaTeX 均随包发布） |
| G2 | 空/纯空白显示折叠回纯文本（杜绝空灰块） |
| G3 | 非数学正文逐字节不变（渲染零副作用） |
| G4 | 真实 bundle × 全量论文锚点渲染审计（0 崩溃 / 0 空显示 / 0 渲染错误标记） |

回归套件：`test/run-*.js`（mock / plugin / render / math-g4 / actions / export / format / profile / tools / simulate）——任何改动必须全绿。

## 7. 关键原则（为什么这么设计）

1. **人机分工**：Agent 提、人审、机器学——高亮对错只由人定义。
2. **纯数据 + 共享源**：Agent 工具与 GUI 读同一份 JSON，无第二事实源。
3. **内容链完整**：v0.6.x 打通行内/行间公式（KaTeX）、表格、图/表标题、图片——正文不再残缺。
4. **可审计**：append-only 决策日志 + 提案制画像，任何学习都可回溯、可拒绝。

## 8. 版本演进（简）

- v0.1~v0.5：解析 → 高亮存储 → 审查 → 画像 → 反思的完整骨架。
- v0.6.1~v0.6.4：数学公式（行内 KaTeX + 行间块）、表格、图片/图表渲染与保留。
- v0.7.0：本版（三份文档）。
