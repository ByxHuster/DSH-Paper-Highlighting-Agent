# 汇报文档 01 —— DSH 生态与本项目（Paper Highlight Agent）的嵌入方式

## 1. DeepSeek Harness（DSH）是什么

DSH 是一个 **Agent 运行平台**：模型在会话中调用**工具**、执行**技能**，并通过**浏览器 GUI** 与人协作。本项目的全部能力都以"DSH 插件"的形式挂载其上。

```
┌─────────────────────────── DSH 生态 ───────────────────────────┐
│  Agent 会话层   模型 + 工具调用 + 技能（skills）                 │
│  dsh web GUI    http://127.0.0.1:3081（浏览器人机界面）         │
│  插件体系       bundle / client-plugin / tools-plugin / skills │
│  workspace      data/（论文数据）+ highlight-profile/（画像）   │
└────────────────────────────────────────────────────────────────┘
```

## 2. 插件体系（本项目用到的四个挂载点）

| 通道 | 机制 | 本项目的落地 |
|---|---|---|
| **host bundle** | `package.json → dsh.bundle.patch`（`cordis.patch.yml`）把包挂进 DSH 运行时 | `host/plugin.js` 注册 `/paper-hl/*` Web 路由 |
| **client-plugin** | `dsh.client.inject` 声明浏览器侧模块，Web 应用挂载 | `client/client.js`（含内联 KaTeX），GUI 渲染高亮正文 |
| **tools-plugin** | `host/tools-plugin.mjs` 用 `defineTool` 向 Agent 注册工具 | **12 个工具**（见 §4） |
| **skills** | 包内 `skills/*.md` 技能目录，会话按名加载 | **3 个技能**（见 §5） |

## 3. 本项目如何使用 DSH

- **解析**：`parse_pdf` 工具调 MinerU 云 API（`host/mineru.js`），产物归一化落盘。
- **高亮**：Agent 通过 12 个工具读写 `data/<paper_id>/paper.highlights.json`；GUI 通过 `/paper-hl/read`（读）与 `/paper-hl/write`（写）与同一份数据交互——**Agent 与 GUI 共享同一数据源**。
- **画像**：`read_profile` / `confirm_proposal` 工具 + GUI 提案面板维护 `highlight-profile/` 四层画像。
- **回环**：GUI「重新提出高亮」→ `propose-request` 路由写标记 + 复制指令 → 你粘贴给 Agent → 新一轮 propose。

## 4. Agent 工具清单（12 个，host/tools.js）

`parse_pdf`、`read_highlights`、`write_highlights`、`list_sections`、`read_section`、`summarize_section_diff`、`read_profile`、`confirm_proposal`、`export_paper`、`read_field_map`、`reflect_paper`、`format_all`。

## 5. 技能（skills/）

- `paper-hl-global-read`：论文全局通读 → 逐节高亮计划（plan）。
- `paper-hl-propose`：逐节提出候选高亮（一次一节，等用户审查）。
- `paper-hl-reflect`：审查后反思 → 画像更新提案（只提案，用户确认才合并）。

## 6. 如何嵌入 DSH（三步）

1. **声明插件**：`package.json` 写 `dsh.bundle.patch`（cordis 补丁）+ `dsh.client.inject`；包名 `paper-highlight` 成为 DSH 可见的 bundle。
2. **注册运行时**：`cordis.patch.yml` 挂载 host（Web 路由）+ client（浏览器模块）；`host/tools-plugin.mjs` 把工具注册进 `ctx.tools`；`skills/` 提供技能。
3. **提供服务**：`host/plugin.js` 在 `/paper-hl` 前缀下分发全部 HTTP 接口（read / write / profile / export / format / propose-request / images 静态图）。

## 7. 一次协作的完整链路（示例）

```
你：为 sutskever 提出高亮
 → Agent 加载 paper-hl-global-read → 产出 plan（写 JSON）
 → 逐节加载 paper-hl-propose → read_section 读正文 → 写 proposed spans
 → 你在 GUI 审查（/paper-hl/read 读、/paper-hl/write 写决策）
 → 一节完毕：paper-hl-reflect → reflections.json 提案
 → 你在 GUI 提案面板确认 → confirm_proposal 合并进画像
```

## 8. 部署事实

- 工作区 `D:\aa` = DSH workspace；`data/` 3 篇论文、`highlight-profile/` 画像。
- GUI `127.0.0.1:3081`；代码在 `packages/paper-highlight/`（host/ client/ skills/ test/ scripts/）。
- 版本：v0.6.1~v0.6.4（数学/公式/表格/图片渲染）+ 本版 v0.7.0（文档）。
