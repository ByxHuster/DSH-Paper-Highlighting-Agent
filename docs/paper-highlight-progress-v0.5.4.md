# Paper Highlight Agent — v0.5.4 项目进度（格式化后「重新提出高亮」按钮）

> 版本：v0.5.4（格式化后给用户一个「重新提出高亮」按钮 —— 记录请求 + 复制指令，让 Agent 再次提出高亮）· 状态：**离线测试 PASS + 真实 bundle 探针 PASS + live client bundle 验证（归档 `v0.5.4`）** · 创建：2026-09-01
> **独立使用说明**：本文件含 v0.5.3 继承状态、v0.5.4 目标/已锁定决策/实施步骤（含验证方法）/风险/命令，可脱离旧文件单独续作；旧版记录见 `paper-highlight-progress-v0.5.1.md` / `paper-highlight-progress-v0.5.2.md` / `paper-highlight-progress-v0.5.3.md`（归档）。
> **v0.5.4 背景**：用户提出「在用户格式化后，需要给用户一个按钮，使 agent 再次提出高亮」。经架构调研确认：**GUI 按钮（浏览器插件）无法直接调用 LLM Agent** —— 提出高亮必须由 Agent 在会话对话里通过 `paper-hl-global-read` → `paper-hl-propose` 技能执行。已向用户解释最初高亮的提出机制并确认交互方式：**记录请求 + 复制指令（推荐）**。

---

## 1. 项目定位与 v0.5.4 目标

- **项目一句话**：在 DeepSeek Harness（DSH）之上构建单论文多色高亮 Agent —— 用户提供论文 PDF → MinerU 云 API 解析为结构化 Markdown → `dsh web`（paper profile, 3081）GUI 整体渲染 → Agent 依据「论文整体认识 + 领域发展线 + 用户画像」逐节提出语义高亮 → 用户审查修改 → 画像持续学习 → **导出**。
- **v0.1–v0.5.3（已完成，归档）**：管线打通 → 审查闭环 → 画像收敛 → 打磨导出 → 一键格式化（工厂重置）→ 图例彩色语义 → 章节目录一键审批 + 反选（批量恢复待审）→ 放弃数学渲染。
- **v0.5.4 目标（用户提出）**：
  > 在用户格式化后，需要给用户一个按钮，使 agent 再次提出高亮。
  - **交互确认（用户选定「记录请求 + 复制指令（推荐）」）**：点击「重新提出高亮」按钮后 —— ①host 落盘一条 `propose-request` 请求记录（`data/<paper_id>/propose-request.json`，`status:'pending'`）；②自动复制一段指令「请为《论文》重新提出高亮」到剪贴板并提示。用户把它粘贴到对话（或直接说「重新提出高亮」），Agent 即执行 global-read + 逐节 propose。
  - 拆解为三个交付物：
    1. **host 路由 `POST /paper-hl/propose-request`**（+ `GET` 回读）：解析 paper_id（query → body → 首篇回退，与 `/read` 一致），落盘 `data/<paper_id>/propose-request.json`（`paper_id`/`title`/`requested_at`/`status:'pending'`），返回 `{ok, paper_id, title, requested_at, status}`。
    2. **client 数据函数 `callProposeRequest(paperId)`**：POST `/paper-hl/propose-request?paperId=…` `{paper_id}`，ok 判定 + 无 transport 干净拒绝（与 `callWrite`/`callProfile`/`callFormat` 同构）。
    3. **client「重新提出高亮」按钮 + 空态 CTA**：工具栏新增 `重新提出高亮` 按钮（`phl-repropose-btn`）；当论文高亮数为 0（格式化后）时正文上方显示空态横幅 `phl-empty-cta`（提示 + 同款按钮）。点击 → `requestRepropose()`：POST 请求 → 成功则 `copyInstruction()` 复制「请为《title》重新提出高亮（paper_id: …）：先执行 global-read 重建逐节计划，再逐节 propose」+ flash「已记录请求（pending）并复制指令。请对 Agent 说/粘贴：『请为《title》重新提出高亮』」。

## 2. 关联文档

| 文档 | 路径 | 用途 |
|---|---|---|
| 设计文档 | `D:\aa\docs\paper-highlight-agent-design.md` | §4 数据模型、§6 画像防污染、§9 目录结构 |
| v0.5.1 进度归档 | `D:\aa\docs\paper-highlight-progress-v0.5.1.md` | 图例/公式 + 空白页热修复（**公式渲染已于 v0.5.3 移除**） |
| v0.5.2 进度归档 | `D:\aa\docs\paper-highlight-progress-v0.5.2.md` | 章节目录一键审批（v0.5.2 已归档） |
| v0.5.3 进度归档 | `D:\aa\docs\paper-highlight-progress-v0.5.3.md` | 放弃数学渲染 + 反选（批量恢复待审）+ 画像面板修复（v0.5.3 已归档） |
| 一页纸快照 | `D:\aa\docs\paper-highlight-one-pager.md` | 项目状态速览（v0.5.4 已同步） |
| 用户指南 | `D:\aa\docs\paper-highlight-user-guide.md` | 面向使用者的「重新提出高亮」说明与 FAQ |
| 本文件 | `D:\aa\docs\paper-highlight-progress-v0.5.4.md` | v0.5.4 进度（当前） |

## 3. v0.5.3 继承状态（独立使用必需）

### 3.1 运行环境
- Windows；harness `dsh web`（port 3080，profile `web`）；**paper profile 独立跑 3081**
- paper profile 启动：`dsh --profile paper --port 3081 --no-open`（后台 job；`prepareProfile` 会重写 profile/cordis.yml，启动需 danger-full-access）
- 沙箱：`D:\aa` 内写入免授权；工作区外需 danger-full-access 一次性升级 + 用户批准

### 3.2 关键路径与交付物（v0.5.3 已就绪，勿重复造）
- git：**tag `v0.5.3`**（放弃数学渲染 + 反选 = 批量恢复待审 + 画像面板修复）
- 插件包 `D:\aa\packages\paper-highlight/`：
  - `host/`：`schema.js` / `store.js` / `mineru.js` / `normalize.js` / `pipeline.js` / `plugin.js`（`/paper-hl` 路由矩阵，含 `POST /write` / `POST /format` / **`POST+GET /propose-request`（v0.5.4）**）/ `sections.js` / **`actions.js`（v0.5.2 `approve_section`；v0.5.3 `revert_section`）** / `diff.js` / `profile.js` / `export.js` / `reflection.js` / `format.js` / `tools.js` + `tools-plugin.mjs`
  - `client/`：`render-body.js`（渲染逻辑单一来源）、`client.js`（durable bundle）、`dynamic/client-half.js`
  - `scripts/`：`gen-client.js` / `simulate-render.js` / `verify-http.js` / `check-host.js` / `check-utf8.js` 等
  - `test/`：`run-mock.js` / `run-tools.js` / `run-actions.js` / `run-plugin.js` / `run-render.js` / `run-profile.js` / `run-export.js` / `run-reflect-paper.js` / `run-format.js`
  - `test/.tmp/`（gitignored 探针）：`profile-blank-probe.js` / `revert-flow-probe.js` / **`propose-request-probe.js`（v0.5.4）**
- 数据根：`D:\aa\data/<paper_id>/`；画像根：`D:\aa\highlight-profile/`

### 3.3 环境纪律（每次续作必读）
1. **3081 = 会话 Web，Agent 不得自行 kill/restart**；host 代码变更后由**用户手动重启**；live 验证前先 `GET /paper-hl/read` 确认新代码已加载。
2. **client 变更**：bundle 按请求从磁盘读，刷新页面即生效（无需重启）。
3. **host 变更**：`propose-request` 路由需重启 3081 后生效；重启前客户端会提示「请求重新提出高亮失败（已回读校准）」并回读，不损坏数据。
4. 数据状态（v0.5.0 格式化后）：3 篇论文 0 spans / 0 plan / 0 duplicates；`highlight-profile/` 冷启动默认（2 条规则 + 0 示例）。**不重新灌演示数据。**（simulate-render 全量 E2E 仍受 `expectedSpans > 0` 阻塞，静态 bundle 守卫全部通过，重提后恢复。）

## 4. 已锁定决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | **新增 host 路由 `POST/GET /paper-hl/propose-request`**：落盘 `data/<paper_id>/propose-request.json`（`status:'pending'` 审计标记），返回请求体 | 格式化清空了所有高亮记录；按钮需要一个持久的「重新提出高亮」请求标记，供 Agent 处理时追溯 |
| D2 | **「重新提出高亮」按钮 = 记录请求 + 复制指令**（不做全自动一键触发） | 架构边界：浏览器按钮无法直接调用 LLM；DSH 无公开的「注入会话消息/自动调度 Agent 轮次」接口（已调研 `dsh-client-runtime`/`dsh-web-frontend`/`dsh-session`）。复制指令 + 粘贴/说一句是最可靠、零侵入的触发方式 |
| D3 | **按钮出现在两处**：工具栏恒有 + 高亮数为 0 时正文上方空态横幅（`phl-empty-cta`） | 格式化后 0 高亮的场景最需要引导；空态横幅把「重新提出高亮」放在显眼位置 |
| D4 | **`callProposeRequest` 与 `callWrite`/`callProfile`/`callFormat` 同构**（transport 注入、ok 判定、无 transport 干净拒绝） | 保持 client 数据函数单一模式，gen-client 可测试性一致 |
| D5 | **不改写用户数据**：按钮只写 `propose-request.json`（新文件），不动 spans/plan/画像 | 请求记录是独立审计文件，与既有高亮状态解耦 |

## 5. 实施

### 5.1 交付物 ①：host 路由（`host/plugin.js`）

1. **`resolvePaperId(root, requested)`**：解析目标论文（query → body → 首篇回退，与 `/read` 一致）。
2. **`paperTitle(root, paperId)`**：从 `paper.md` 首个非标题行取标题（尽力而为，失败回退 paper_id）。
3. **`handleProposeRequest(root, url, req, res, send)`**：POST 落盘 `data/<paper_id>/propose-request.json` = `{paper_id, title, requested_at: ISO, status:'pending'}`，返回 `{ok:true, ...}`。
4. **`handleProposeRequestGet(root, url, res, send)`**：GET 回读（200）或 404。
5. **路由矩阵**新增两条（POST / GET），`module.exports` 导出两个 handler。

### 5.2 交付物 ②：client 数据函数 + 按钮 + 空态（`client/render-body.js`）

1. **`callProposeRequest(paperId, transport)`**：POST `/paper-hl/propose-request?paperId=…`（body `{paper_id}`），ok 判定 + 无 transport 干净拒绝。
2. **`copyInstruction(text)`**：优先 `navigator.clipboard.writeText`，回退临时 textarea + `execCommand('copy')`，再失败则指令仍在 flash 中可见（不崩溃）。
3. **`requestRepropose()`**（组件闭包）：调 `callProposeRequest(paperId)` → 成功复制指令「请为《title》重新提出高亮（paper_id: …）：先执行 global-read 重建逐节计划，再逐节 propose」+ flash「已记录请求（pending）并复制指令。请对 Agent 说/粘贴：『请为《title》重新提出高亮』」；失败 flash「请求重新提出高亮失败：…」。
4. **工具栏按钮**（`phl-repropose-btn`，位于「格式化」之后）+ **空态 CTA**（`phl-empty-cta`，当 `spans.length === 0` 时渲染，含提示 + 同款按钮）。
5. **`dispatchRef.current`** 暴露 `requestRepropose`；`module.exports` 导出 `callProposeRequest`；BODY 嵌入 `${callProposeRequest.toString()}`。
6. **CSS**：`.phl-repropose-btn` / `.phl-empty-cta` / `.phl-empty-text` / `.phl-empty-hint`。

### 5.3 交付物 ③：bundle 生成（`scripts/gen-client.js`）

1. **`proposeData` transport**：POST `/paper-hl/propose-request?paperId=…`（durable bundle 接线；dynamic half 只读 → `callProposeRequest` 干净拒绝）。
2. **`exports.callProposeRequest = callProposeRequest;`**。

### 5.4 验证方法

- **离线**：`node test/run-render.js`（`v054`：`callProposeRequest` ok/ok:false/no-transport + URL/body 断言；EMBED_HELPERS 加 `callProposeRequest`）· `node test/run-actions.js` · `node test/run-plugin.js`（propose-request 路由：POST 200+pending / 落盘文件字段 / GET 回读 / 无 paperId 回退首篇）。
- **bundle 守卫**：`node scripts/simulate-render.js`（新增 `p2h` 静态守卫：`callProposeRequest`/`proposeData`/`/paper-hl/propose-request`/`phl-repropose-btn`/`重新提出高亮`/`请为《`/`phl-empty-cta`/`requestRepropose`；E2E `P2-h` 在恢复数据后：工具栏按钮点击 → POST {paper_id} + flash「已记录请求」+「请为《…》重新提出高亮」）。当前 live 0 高亮仍受 `expectedSpans > 0` 阻塞，守卫通过即可。
- **真实探针**：`node test/.tmp/propose-request-probe.js`（真实 bundle + 真实 `/read` + `/profile`，`/propose-request` mock）—— 断言：h1 渲染、**工具栏 + 空态 CTA 两个按钮都在**（0 高亮数据）、点击 → 恰好一次 POST、body `{paper_id}`、flash 含「已记录请求」+「请为《」+「重新提出高亮」。**PASS**。
- **bundle 残留检查**（Node `readFileSync utf8`，勿用 PowerShell）：`phl-math/MathJax` 引用 = 0；`reject_section/rejectSection` 残留 = false；`revert_section/revertSection/已恢复为待审/localRevertSectionSpans` = true；`callProposeRequest/proposeData//paper-hl/propose-request/重新提出高亮/phl-empty-cta/requestRepropose` = true。

### 5.5 风险与边界

- **按钮不直接触发 Agent**：点击后需要用户粘贴指令（或说「重新提出高亮」）到会话，Agent 才执行 global-read → propose。这是 DSH 插件/Agent 边界的硬约束（已向用户解释并确认）。
- **`propose-request.json` 是审计标记**：Agent 处理时按需读取/更新（`status:'running'/'done'` 或删除），本版本只落 pending 标记。
- **不污染数据**：只新增 `propose-request.json` 文件，不改 spans/plan/画像。

## 6. 命令速查

```powershell
# 重新生成 bundle（render-body.js 改动后必须）
$env:NODE_PATH='C:\Users\eyx\.dsh\profiles\node_modules'; node packages/paper-highlight/scripts/gen-client.js
# 离线测试
node packages/paper-highlight/test/run-render.js; node packages/paper-highlight/test/run-actions.js; node packages/paper-highlight/test/run-plugin.js
# 真实探针（真实 bundle + 真实 /read，propose-request mock）
node packages/paper-highlight/test/.tmp/propose-request-probe.js
# bundle 守卫（静态全过；E2E 受 0 高亮阻塞属预期）
node packages/paper-highlight/scripts/simulate-render.js
# 归档
git add <15 个文件>; git commit -m "v0.5.4: …"; git tag -a v0.5.4 -m "…"
```

> 验证后提醒用户：①刷新 GUI 页面（client bundle 即时生效）②重启 3081（host `propose-request` 路由生效）。
