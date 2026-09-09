# Paper Highlight Agent —— 用户指南

本地论文**多色高亮 Agent**：解析 PDF → 通读全文 → 逐节提出高亮候选 → 你在浏览器里审查 → Agent 从你的修改中学习画像，越用越贴合你的偏好。

- GUI：DeepSeek Harness Web（`http://127.0.0.1:3081`）
- 工作区：`D:\aa`（`data/` = 论文数据，`highlight-profile/` = 你的画像）

---

## 1. 快速开始

1. 启动 DSH Web，打开 GUI 中的 Paper Highlight 面板。
2. 三篇已解析论文：**bahdanau**（注意力机制，进行中）、**mikolov**（word2vec）、**sutskever**（seq2seq，功能展示最全）。
3. 选中论文 → 阅读正文 → 点击「重新提出高亮」或直接告诉 Agent「为《xxx》提出高亮」。

## 2. 核心流程（三轮协作）

```
解析 PDF ─→ 全局通读（计划） ─→ 逐节提出候选 ─→ GUI 审查 ─→ 章节反思 ─→ 画像更新
   parse_pdf     global-read         propose          你           reflect      确认合并
```

- **global-read**：Agent 通读全文，产出**逐节高亮计划**（每节预期颜色、密度、是否跳过），你先在 GUI 校准计划再动手。
- **propose**：一次只提一节，候选高亮写入 `status: proposed`，等你审查后才进入下一节。
- **审查**（GUI）：见下节。
- **reflect**：一节审查完毕后，Agent 重读 JSON、分析你 proposed→final 的改动，产出**画像更新提案**；你在提案面板确认后由系统合并——**Agent 从不直接改写你的画像**（防污染）。

## 3. GUI 操作

| 操作 | 方式 |
|---|---|
| 接受 / 否决 | 点击高亮 → 操作条 accept / reject |
| 改颜色 | 操作条 recolor（颜色来自你的画像） |
| 改范围 | 操作条 rescope → 在正文划新范围 |
| 加备注 | 操作条 note |
| 整节通过 | 点击节芯片（✓）；Shift+点击 = 整节反选 |
| 重新提出 | 「重新提出高亮」→ 指令复制到剪贴板，粘贴给 Agent |
| 导出 | 面板导出 HTML / Markdown（含图例，自包含） |
| 一键格式化 | 危险操作：清空全部高亮记录 + 画像（正文保留），回冷启动 |

## 4. 论文里能看到什么（v0.6.x 渲染能力）

- **行内公式**：`s_{i-1}`、`h_j` 等 LaTeX 片段 → 本地 KaTeX 排版（无网络、无方框豆腐块）。
- **行间公式**：独立公式块（含 `\begin{array}` 矩阵、`\prod`、`\tag` 编号）居中显示。
- **表格**：MinerU 识别出的 HTML 表格真实渲染（带边框、可横滚）。
- **图 / 图表**：架构图、曲线图通过 host 路由显示（`.phl-figure`）。
- 图/表/公式均**不参与高亮**（by design，仅展示）。

> ⚠️ 图片路由是 host 改动：**重启 DSH Web 后**图片才能显示；重启后解析新论文也会自动保留公式/表格/图片。

## 5. 数据与画像

- `data/<paper_id>/`：`paper.md` + `anchors.json`（正文与锚点，解析产物）+ `paper.highlights.json`（自包含：锚点 + 高亮 + 计划 + 决策日志）。
- `highlight-profile/`：**四层画像** —— `colors.yml`（颜色语义）、`rules.json`（规则，可停用）、`exemplars.json`（示例）、`stats.json`（统计）；`reflection-notes.md` 记录反思。
- 决策日志 append-only：每次 接受/否决/改色/改范围 都留痕，供反思学习。

## 6. 注意事项

- **数据零改动原则**：渲染/学习流程从不修改你的数据；高亮变更只在 GUI 审查时写入。
- 三篇论文中 sutskever 因功能验收重解析过（锚点已更新，0 高亮无损失）；bahdanau 保留你的进行中状态。
- 代码仓库在 `D:\aa`，提交后请手动 `git push`（本 Agent 不自动推送）。

## 7. 更多资料

- `docs/paper-highlight-report-01-dsh.md` —— DSH 生态与本项目的嵌入方式
- `docs/paper-highlight-report-02-agent.md` —— Agent 工作流程与结构
- `docs/paper-highlight-progress-v0.6.md` —— v0.6.x 数学/表格/图片渲染历程
- `packages/paper-highlight/README.md` —— 技术 README（各版本实现与验证）
