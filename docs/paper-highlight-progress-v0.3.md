# Paper Highlight Agent — v0.3 项目进度（个性化画像收敛）

> 版本：v0.3（画像收敛）· 状态：**Phase 0/1/3 已完成（归档 v0.2.1 / v0.2.2），Phase 2 待做** · 创建：2026-08-27 · 最近更新：2026-08-27 —— Phase 0 画像存储层（v0.2.1）+ Phase 1 冷启动/图例驱动（v0.2.1）+ Phase 3 画像编辑面板（v0.2.2）完成；Phase 2（propose 摘要注入 + 提案确认 GUI）待做（完成记录见 §6）
> **独立使用说明**：本文件含 v0.2 继承状态、v0.3 目标/已锁定决策/实施步骤（含验证方法）/风险/命令，可脱离旧文件单独续作；旧版记录见 `paper-highlight-progress-v0.2.md`（归档，v0.2.0）。

---

## 1. 项目定位与 v0.3 目标

- **项目一句话**：在 DeepSeek Harness（DSH）之上构建单论文多色高亮 Agent —— 用户提供论文 PDF → MinerU 云 API 解析为结构化 Markdown → `dsh web`（paper profile, 3081）GUI 整体渲染 → Agent 依据「论文整体认识 + 领域发展线 + 用户画像」逐节提出语义高亮 → 用户审查修改 → 画像持续学习 → 导出。
- **v0.1（已完成，归档）**：管线打通 —— PDF → MinerU → `data/<paper_id>/` 归一化产物 → Agent 工具读写高亮 JSON → GUI 渲染正文 + 显示 spans。
- **v0.2（已完成，归档 `v0.2.0`）**：审查闭环 —— 「全局通读 → 逐节 propose → GUI 审查 → 差异分析/章节反思（reflections.json 提案）→ 下一节」核心循环全链路跑通。
- **v0.3 目标**：个性化画像收敛 —— 把 v0.2 的「默认画像 + 只产出提案」升级为**完整四层画像 + 冷启动 + 摘要注入 + 确认生效机制**，使 propose 随使用持续收敛到用户偏好，并给出可度量的收敛验收（连续 3 篇同领域论文后修改率显著下降）。

## 2. 关联文档

| 文档 | 路径 | 用途 |
|---|---|---|
| 设计文档 | `D:\aa\docs\paper-highlight-agent-design.md` | §4.3 四层画像、§5.1 冷启动、§6 学习闭环与收敛度量、§8 v0.3 范围/验收、§10 风险 #5 |
| v0.2 进度归档 | `D:\aa\docs\paper-highlight-progress-v0.2.md` | v0.2 交付记录、校准结论、事故教训（§10 环境纪律） |
| v0.1 进度归档 | `D:\aa\docs\paper-highlight-progress-v0.1.md` | 管线交付记录（仅回溯用） |
| 本文件 | `D:\aa\docs\paper-highlight-progress-v0.3.md` | v0.3 进度（当前，规划中） |

## 3. v0.2 继承状态（独立使用必需）

### 3.1 运行环境
- Windows；harness `dsh web`（port 3080，profile `web`）；**paper profile 独立跑 3081**
- paper profile 启动：`dsh --profile paper --port 3081 --no-open`（后台 job；`prepareProfile` 会重写 profile/cordis.yml，启动需 danger-full-access）
- DSH 安装：`C:\Users\eyx\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh`；profiles：`C:\Users\eyx\.dsh\profiles\`
- 环境变量：`MINERU_API`（已 setx，len=51）；`MINERU_BASE_URL`（默认 `https://mineru.net`）、`MINERU_UPLOAD_MODE=file|url`、`MINERU_OCR=1`、`MINERU_FORMULA=1`、`MINERU_LANGUAGE`
- 沙箱：`D:\aa` 内写入免授权；工作区外（`.dsh\.agent-presets`、`profiles/node_modules`）需 danger-full-access 一次性升级 + 用户批准；npm 用 `npm --cache D:\aa\.npm-cache`

### 3.2 关键路径与交付物（v0.2 已就绪，勿重复造）
- git：**tag `v0.2.0`**（审查闭环交付），工作区 clean
- 插件包 `D:\aa\packages\paper-highlight\`：
  - `host/`：`schema.js`（模型校验 + `validateReflections`）、`store.js`（原子读写）、`mineru.js`（云 API 客户端）、`normalize.js`（zip 归一化）、`pipeline.js`（processPdf）、`plugin.js`（`/paper-hl`：GET `/read` + POST `/write` + GET `/profile` + POST `/profile/init` + POST `/profile/apply` + **POST `/profile/save`（v0.2.2）**）、`sections.js`（节树）、`actions.js`（7 审查动作纯逻辑）、`diff.js`（`classifySpanChange`/`summarizeDiff`）、**`profile.js`（v0.3：画像四层 + `ensureProfile`/`buildProfileSummary`/`applyProposal`/`applyProfileUpdate` 纯逻辑）**、`tools.js` + `tools-plugin.mjs`（**8 工具**：`parse_pdf` / `read_highlights` / `write_highlights` / `list_sections` / `read_section` / `summarize_section_diff` / `read_profile` / `confirm_proposal`）
  - `client/`：`render-body.js`（渲染逻辑单一来源，含 P2-a…P2-e 全部纯函数与交互 + v0.3 `colorLegend`/`callProfile`/冷启动引导/**画像编辑面板**）、`client.js`（durable bundle，ModuleLoader 格式）
  - `dynamic/`：`client-half.js` / `host-half.js`（动态双半体备用，不含 writeData/profileData）
  - `skills/`：三份技能 `global-read.md` / `propose.md` / `reflect.md`（运行时经 `<projectRoot>/.agents/skills` junction 发现，**无需重启即可被 skill 工具加载**）
  - `scripts/`：`gen-client.js`、`simulate-render.js`、`verify-http.js`、`check-host.js`、`check-utf8.js`、`seed-demo.js`、`step4-e2e.js`、`step5-acceptance.js`、`step6-e2e.js`
  - `test/`：`run-mock.js` / `run-tools.js` / `run-actions.js` / `run-plugin.js` / `run-render.js` / **`run-profile.js`（v0.3 Phase 0）** / `run-real.js` + `verify.js` + fixtures
- 画像存储：**`D:\aa\highlight-profile/`**（v0.3 Phase 0 已落盘默认四层，git 跟踪；根解析同 data：组合 config `root` → `HIGHLIGHT_PROFILE_ROOT` → 默认 workspace）
- agent preset：`C:\Users\eyx\.dsh\.agent-presets\paper\`（含工具行；trust: user）
- profile：`C:\Users\eyx\.dsh\profiles\paper\`（bundles = dsh-base + dsh-web-app + paper-highlight；`cordis.patch.yml` 钉 `root: 'D:\aa'` + 默认 preset=paper）
- junction：`profiles\node_modules\paper-highlight` → 包

### 3.3 数据现状
- `D:\aa\data\p-mikolov-2013-2013-1-word2vec\`：`paper.md`（28,880 字符）、`anchors.json`（80 锚点 / 11 页）、`meta.json`、`paper.highlights.json`（**12 spans**：s-001..s-004/s-007 accepted、s-005 proposed、s-006 rejected、s-008 user_added、s-009/s-010/s-011 为 §1 候选[改色 red/rejected/pending]、s-012 user_added、s-013+ 为后续走查新增；`plan` summary + 20 条 sections，**s3 reviewed**；`duplicates` 3 条）、**`reflections.json`**（含 `profile_proposal`：L2 规则 3 条 + L3 示例 3 个 + L4 统计雏形，**尚未确认** —— v0.3 Phase 2 确认机制的第一份待确认提案）
- **`D:\aa\highlight-profile/`**（v0.3 Phase 0 落盘）：`colors.yml`（五色语义）、`rules.json`（基线 rule-1 density_per_section: 每节 3-5 处 / rule-2 granularity: 句子级）、`exemplars.json`（空）、`stats.json`（空统计）、`reflection-notes.md`（模板）
- 锚点模型：`anchor_id = a-<page:04d>-<block:02d>-<par:02d>`；span `char_start/char_end` 0 起始半开区间指向 `anchor.text`
- 正文过滤（v0.1）：保留 text/title/content；跳过 image/table/formula/ref_text 等

### 3.4 关键校准（既有结论，必须遵守）
1. **MinerU 流程**：`POST /api/v4/file-urls/batch`（须 **Content-Length**）→ 预签名 PUT → 系统自动提交任务 → 轮询 `extract-results/batch/{batch_id}` → 下载 `full_zip_url`；pipeline 返回字段是 **`batchId`**（非 taskId）
2. **zip 中间结构**：`layout.json`；`pdf_info[i].para_blocks`（段落合并视图，首选）/ `preproc_blocks`（兜底）；**para_blocks 原始数组序即权威阅读序（禁 bbox y 排序）**
3. **dsh-tools 工具输出必须 lossless JSON**：`undefined/NaN/Infinity/BigInt/循环引用` 报 `INVALID_TOOL_OUTPUT`；不存在字段显式 `?? null`
4. **dsh web 浏览器传输 = HTTP JSON-RPC**：`POST /api/<method>`，信封 `{type:'client-request', rpcId, method, payload}`；事件流 WebSocket `/api/events.mux`；`session.prompt` 用 `mode:'queue'` 异步受理，轮询 `session.list` 的 `running` 判定回合结束
5. **host 网络**：不用 `ctx.web.fetch`（无 fetch provider），直接用 Node `https`
6. **数据根目录解析**：组合 config `root` → `PAPER_HL_ROOT` → `process.cwd()` 兜底（paper profile 已钉 `root: 'D:\aa'`）
7. **client 插件机制**：`conversation.view` 槽位 + `window.__ModuleLoader__.load({id, factory})` bundle；数据走同源 `fetch('/paper-hl/read')`；CSS 用 `document.querySelector("style[data-plugin-css=…]")` 注入
8. **环境纪律（v0.2 §10 事故教训，永久生效）**：**3081 = 会话 Web = Agent 不得自行 kill/restart**。host 代码变更后的重启一律由用户手动执行；Agent 只做只读验证；live 验证前先只读 GET `/paper-hl/read` 确认新代码已加载

### 3.5 测试命令（v0.2 回归基线，v0.3 改动后必须全绿）
```powershell
$env:NODE_PATH = 'C:\Users\eyx\.dsh\profiles\node_modules'
node D:\aa\packages\paper-highlight\test\run-mock.js
node D:\aa\packages\paper-highlight\test\run-tools.js
node D:\aa\packages\paper-highlight\test\run-actions.js
node D:\aa\packages\paper-highlight\test\run-plugin.js
node D:\aa\packages\paper-highlight\test\run-render.js
node D:\aa\packages\paper-highlight\scripts\simulate-render.js   # live 3081，POST 走 mock，真实数据零改动
node D:\aa\packages\paper-highlight\scripts\verify-http.js
node D:\aa\packages\paper-highlight\scripts\check-host.js
node D:\aa\packages\paper-highlight\scripts\step6-e2e.js          # 需要 3081 运行 + LLM 会话（按需）
```

## 4. v0.3 范围与验收（设计文档 §8）

**范围**
- 冷启动配置流程（`colors.yml` + 密度/粒度基线声明）
- 四层画像落地（设计 §4.3）：规则层 `rules.json` / 示例库 `exemplars.json` / 统计 `stats.json` / 反思笔记 `reflection-notes.md`（+ L1 `colors.yml`）
- 「画像摘要」注入 propose；画像更新提案的**用户确认机制**
- 画像编辑面板（GUI）

**验收标准（两条，均为硬指标）**
1. **收敛度量**：同一用户连续处理 **3 篇同领域论文**后，审查修改率显著下降 —— 示例口径：第 3 篇 propose **认可率 ≥ 70%**，且修改率较第 1 篇（画像前基线）**相对下降 ≥ 50%**（阈值按实际数据可调，见决策 D4）。
2. **画像可维护性**：画像文件结构稳定、可审计（决策日志只追加）、可手工修正（文件可编辑 + GUI 可编辑双通道）。

**风险/依赖（设计 §10 #5）**
- 差异分析推断质量（误推断需靠用户确认兜底 —— 机制已有雏形，v0.3 补确认动作闭环）
- 示例库规模过小时的 few-shot 效果（L3 注入 top-k + 置信度门槛兜底）

## 5. v0.3 关键设计决策（实现前已锁定）

| # | 决策 | 结论 | 理由/备注 |
|---|---|---|---|
| **D1** | 画像目录位置 | **`D:\aa\highlight-profile\`**（workspace 内，与 `data/` 同级；根解析同 data：组合 config `root` → `HIGHLIGHT_PROFILE_ROOT` env → 默认 workspace） | Agent 工具可直接读写（profile 目录在 workspace 外需 danger-full-access）；git 可跟踪可审计；与设计 §9 目录结构一致 |
| **D2** | 画像 schema 与确认契约 | 四层文件 schema 对齐设计 §4.3 + v0.2 `reflections.json.profile_proposal` 字段（rules/exemplars/stats）；确认动作 = **`applyProposal` 纯函数原子合并 + 幂等**（重复确认拒绝）；`reflections.json` 增 `confirmation` 字段（`null`=未确认；确认后写入一次，**append-only，不再改动**） | 延续「JSON 是唯一契约、只追加、可审计」；确认不覆盖原提案 |
| **D3** | 画像摘要注入 | `buildProfileSummary()` 纯函数输出：L1 颜色语义表 + L2 规则 top-k + L3 精选 3–5 例 + L4 一句统计；`propose` 每次只注入摘要不注入全量（控制 token、避免噪音） | 设计 §4.3「使用方式」原文落地 |
| **D4** | 收敛指标口径 | **认可率 = (accepted + 改色保留 + 改范围保留) / decided**（decided = 非 pending）；**修改率 = 1 − 认可率**；收敛判定 = 第 3 篇认可率 ≥ 70% **且** 修改率较第 1 篇基线相对下降 ≥ 50%（示例阈值）。v0.2 `summarize_section_diff` 的 `accept_rate=accepted/decided` 保留原义不动，v0.3 收敛指标另算 | 改色/改范围后保留 = 用户认可方向但细节修正，计入认可；v0.2 已见「改色保留」为主流操作 |
| **D5** | 确认机制双通道 | GUI「待确认提案」面板（主，POST `/paper-hl/profile/apply`）+ 聊天确认（等价信号，Agent 调 `confirm_proposal` 工具 → 同一 host 逻辑）。**Agent/GUI 只表达意图，合并动作一律由 host 纯逻辑执行**（防污染） | 延续 v0.2「审查完成信号双通道」模式 |
| **D6** | 冷启动 | 无画像 → GUI 引导初始化（五色语义编辑 + 密度/粒度基线声明 → 生成 `colors.yml` + 初始 `rules.json`）；**图例/色板由 `colors.yml` 驱动**（v0.2 遗留「colors.yml 驱动留 v0.3」落地）；文件手工编辑兜底 | 零学习成本（GUI 引导）+ 可手工修正（验收 2） |
| **D7** | 示例库策略 | L3 自动入库（确认后从提案 exemplars 并入，只作参考信号**不直接改写规则**）；L2 规则仅经用户确认写入；低置信（< 阈值）规则标注「候选」不自动启用 | 设计 §6 防污染：确认后才生效 |

**画像与既有机制的关系（一句话）**：v0.2 的 `reflect` 已能产出 `reflections.json` 提案（规则/示例/统计雏形）——v0.3 把「提案 → 用户确认 → host `applyProposal` 并入 `highlight-profile/` 四层 → `propose` 下次经 `buildProfileSummary` 消费」这条链路补完整并 GUI 化。

## 6. 实施步骤（Phase 0–5，含交付物与验证方法）

> **验证方法总则（贯穿所有 Phase）**：① 纯函数单测矩阵（run-render/run-tools/run-actions 扩展）→ ② 本地回归全绿（§3.5 清单）→ ③ `simulate-render.js` 交互注入（POST 走 mock 或备份后真实，**真实数据零改动**）→ ④ 真实 3081 只读冒烟（先 GET 确认新 host 代码已加载；host 改动后需**用户手动重启** 3081，Agent 不得 kill/restart）→ ⑤ 浏览器人工走查清单。每 Phase 完成记录沿用 v0.2 格式（✅ 完成记录，含交付/验证结果/未做清单）。

### Phase 0 — 画像存储层落地（~1.5–2 天）

**目标**：`highlight-profile/` 四层文件 + host 读写/校验/摘要/合并纯逻辑 + Agent 工具与 HTTP 路由，后续所有 Phase 的地基。

**交付**
- `D:\aa\highlight-profile/`（新，git 跟踪）：`colors.yml`（L1 五色语义默认）、`rules.json`（L2，含密度/粒度基线）、`exemplars.json`（L3，空数组起步）、`stats.json`（L4a，空统计起步）、`reflection-notes.md`（L4b，模板）
- `host/profile.js`（新，纯逻辑可单测）：
  - 四层读写 + schema 校验（颜色值/规则形状/示例形状对齐 4.3 与 `profile_proposal`；非法条目拒绝）
  - `ensureProfile(root)`（冷启动：不存在则生成默认四层，幂等）
  - `buildProfileSummary(profile, {max_exemplars})`（D3 摘要：L1 表 + L2 top-k + L3 精选 3–5 例 + L4 一句统计，lossless JSON）
  - `applyProposal(profile, reflectionsEntry, {accept, reject})`（D2/D5：全收/全否/部分；幂等；重复确认拒绝；并入 rules/exemplars/stats + 追加 `reflection-notes.md`；返回变更摘要）
- `host/tools.js`（扩展）：新工具 `read_profile({root?})`（摘要 + 四层 + 待确认提案数，只读）与 `confirm_proposal({paper_id, decisions:{accept,reject}, root?})`（聊天确认通道，调 `applyProposal`）
- `host/plugin.js`（扩展）：`GET /paper-hl/profile`（GUI 面板读：四层 + 各 paper 未确认提案聚合）与 `POST /paper-hl/profile/apply`（GUI 确认通道）
- `host/schema.js`（扩展）：`reflections.json` 增 `confirmation` 字段校验（null 或 `{accepted, at, decisions}`）

**验证**
- 新增 `test/run-profile.js`：冷启动默认生成（幂等，二次调用不覆盖）、四层往返读写、校验拒绝矩阵（非法颜色/坏规则形状）、`buildProfileSummary` 输出形状（L3 ≤ top-k、L4 一句）、`applyProposal` 矩阵（全收/全否/部分/重复确认拒绝/幂等/不可变性）、lossless JSON
- `test/run-tools.js`（扩展）：`read_profile` / `confirm_proposal` 行为断言（夹具 `p-sections` 附带 reflections 提案 → 确认后 rules/exemplars/stats 变化 + reflections.confirmation 写入 + 重复确认 ok:false）+ 全工具 lossless 回归
- `test/run-plugin.js`（扩展）：`/paper-hl/profile` GET/POST 路由矩阵（未知 paperId、非法 decisions、畸形 body 拒绝）
- 本地回归全绿 + `verify-http.js`；真实 3081 只读冒烟（host 重启后）：`GET /paper-hl/profile` 返回默认四层

#### ✅ Phase 0 完成记录（2026-08-27，验证通过）

**交付**（git 工作区已落盘）
- `highlight-profile/`（新，git 跟踪）：`colors.yml`（L1 五色语义默认）+ `rules.json`（L2 含默认基线 `density_per_section: 每节 3-5 处` / `granularity: 句子级`，id `rule-1/rule-2`）+ `exemplars.json`（空）+ `stats.json`（空统计）+ `reflection-notes.md`（模板）
- `host/profile.js`（新）：`parseColorsYaml`/`stringifyColorsYaml`（colors.yml 最小 YAML 子集，可手工编辑）+ `ensureProfile`（幂等冷启动）+ `readProfile`/`writeProfile`（原子写 + `validateProfile` 校验矩阵）+ `buildProfileSummary`（D3 摘要：L1 + L2 top-k + L3 top-k + L4 一句 + density/granularity 抽取）+ `derivePaperMetrics`/`deriveColorDistribution`/`recomputeOverall`（D4 指标口径）+ `applyProposal`（D2/D5/D7：全收/部分/全否/混合，低置信规则存为禁用候选，stats 聚合，输入不可变）+ `readReflections`/`writeReflections`/`listPendingProposals`
- `host/schema.js`（扩展）：`validateReflections`（`confirmation` 为 null 或 `{accepted, at?, decisions?}`，append-only 契约）
- `host/store.js`（扩展）：导出 `atomicWriteJson`/`atomicWriteText` 供 profile 层复用
- `host/tools.js`（扩展）：新工具 `read_profile`（has_profile/summary/四层/pending_proposals，只读；无画像时摘要回退内置默认）+ `confirm_proposal`（一次性确认：`reflections.confirmation` 写入后重复确认拒绝；`accept:'all'|[]` / `reject:'all'|[]`，host 纯逻辑合并，Agent 不直接写规则）
- `host/plugin.js`（扩展）：`GET /paper-hl/profile`（四层 + 各 paper 未确认提案聚合）+ `POST /paper-hl/profile/init`（冷启动：默认创建 + 可并入引导表单的 colors/rules）+ `POST /paper-hl/profile/apply?paperId=`（GUI 确认通道，同 confirm_proposal 逻辑）
- `test/run-profile.js`（新）+ `run-tools.js`（扩展：read_profile/confirm_proposal 行为 + lossless）+ `run-plugin.js`（扩展：/profile 路由矩阵含负例）

**验证结果（2026-08-27）**
- 本地回归全绿：run-mock / run-tools / run-actions / run-plugin / run-render / **run-profile（新）** → 全部 PASS；check-host / check-utf8 → PASS
- run-profile 覆盖：YAML 往返 + 拒绝、ensureProfile 幂等、四层往返 + 校验矩阵、buildProfileSummary 形状（top-k/一句统计）、applyProposal 矩阵（全收 3 规则+2 示例、部分、全否、混合、低置信禁用、stats/颜色分布、不可变性）、confirm_proposal 一次性（二次确认 ok:false、reject-all 记 accepted:false）
- run-plugin 覆盖：GET /profile 冷启动 has_profile:false → init 后 has_profile:true + 自定义 colors/rules 并入 → apply 确认提案（confirmation 落盘、pending 清空）→ 负例（缺 paperId / 无 reflections / 重复确认 / 畸形 body → 4xx）
- 调试中修正：`confirm_proposal.decisions` 参数缺 `additionalProperties:true` 被 dsh-tools defineTool 拒绝（`unsupported JSON schema`）→ 补显式声明
- 真实画像落盘：`D:\aa\highlight-profile/` 五文件（含默认基线规则）；**注**：git 提交前发现一次性脚本写入的默认规则 id 重复（`rule-1`×2，`Array.push` 多参先求值所致）→ 已重编号为 rule-1/rule-2 并唯一化
- ⚠️ live 3081 冒烟待用户重启（host 代码变更，Agent 不得自行重启）：重启后 `GET /paper-hl/profile` 应返回 has_profile:true + 现有 `p-mikolov` 的 reflections.json 未确认提案 1 条进入 `pending_proposals`

**本轮未做（属后续 Phase）**：Phase 1（client 冷启动引导 + 图例驱动）、Phase 2–5

### Phase 1 — 冷启动配置流程 + colors.yml 驱动图例（~1 天）

**目标**：新用户路径「初始化画像」可用；图例/色板不再硬编码五色。

**交付**
- `client/render-body.js`（扩展）：纯函数 `colorLegend(colors)`（colors.yml → 图例/色板条目）替代硬编码 LEGEND；色板点击改色用 colors.yml 的颜色集合；「初始化画像」引导面板（检测 `/paper-hl/profile` 无画像 → 引导：五色语义编辑 + 密度/粒度基线声明 → POST 初始化 → 生成 `colors.yml` + 初始 `rules.json`）；已有画像则直接进入「画像」入口（面板留 Phase 3 完整版）
- `scripts/gen-client.js`（扩展）：durable bundle 注入 `profileData` fetch 传输（GET/POST `/paper-hl/profile`）与 `colorLegend` 导出

**验证**
- `test/run-render.js`（扩展）：`colorLegend` 纯函数矩阵（默认五色、自定义颜色数、空/坏 colors 容错）
- `scripts/simulate-render.js`（扩展）：注入「无画像 → 引导面板渲染 → 填写 → POST 初始化载荷断言（colors + 密度/粒度基线）」；注入「有画像 → 图例渲染自 colors.yml（非硬编码五色）→ 色板颜色集合与 colors.yml 一致」
- 浏览器人工走查：删/移 `highlight-profile`（备份后）→ 刷新 → 引导面板出现 → 初始化 → 图例按自定义颜色渲染 → 恢复备份

#### ✅ Phase 1 完成记录（2026-08-27，验证通过）

**交付**（git 工作区已落盘）
- `client/render-body.js`（扩展）：
  - 纯函数 `colorLegend(colors)`（colors.yml 色图 → `[{name,color,label}]`；null/空/残缺回退内置五色）—— 单一来源驱动**图例 / 改色色板 / 新增弹窗色板**（替代硬编码 `Object.keys(COLOR_MAP)`）
  - `markStyle(span, isActive, clickable, colors?)`（第 4 参：mark 背景经 profile 色图解析，未知颜色保留字面值不崩；缺省回退内置）与 `renderText(opts.colors)` 透传
  - `callProfile(method, path, payload, transport?)`（profile 数据函数：GET '' / POST /init；ok:false 与无传输拒绝，同 callWrite 契约）
  - PaperView：`profileState`（loading/has_profile/colors，mount 时 `loadProfile()` 拉 `/paper-hl/profile`，失败优雅回退默认色）+ **冷启动引导面板**（D6：无画像时替换论文视图 —— 五色行[色值/语义可编辑] + 每节密度基线 select + 高亮粒度 select + 「初始化画像」按钮 → POST `/init` 提交 colors + 两条基线规则 → 成功刷新进入论文视图）；图例/色板/mark 全部 palette 驱动
  - 新增 onboarding CSS（`.phl-onb*`）
- `scripts/gen-client.js`（扩展）：durable bundle 注入 `profileData(method, url, body)` fetch 传输；导出 `colorLegend`/`callProfile` 供 headless 测试；dynamic 半体不接 profile 传输（callProfile 干净拒绝）
- `client/client.js` / `dynamic/client-half.js`：重新生成
- `test/run-render.js`（扩展）：`callProfile`（GET/POST/ok:false/无传输）+ `colorLegend` 矩阵（null/自定义/残缺/空/未知名回退）+ `markStyle(colors)`（profile 色/回退/未知字面值）+ `renderText(opts.colors)`
- `scripts/simulate-render.js`（扩展）：**profile 端点 MOCK**（`/paper-hl/profile` GET/POST 拦截，真实数据零改动）；P1 断言 —— 无画像 → 引导面板（无 h1、5 色行、2 select）→ 点「初始化画像」→ POST `/init` 载荷（5 colors + density/granularity 规则）→ 面板消失、论文视图恢复 → **图例含自定义 label「红核心」**、**红色 span 的 mark 背景 = profile 色 `#ff0000`**（非内置 `#ff9c94`）；P2-a…P2-e 全量回归通过（绿板 `#b0e3a8` 与自定义色一致，色板计数 5 不变）

**验证结果（2026-08-27）**
- 本地回归全绿：run-mock / run-tools / run-actions / run-plugin / run-render / run-profile → 全部 PASS；check-host / check-utf8 / verify-http → PASS
- 端到端 `simulate-render.js`（live 3081 读真实数据 + POST/profile mock）→ **SIMULATION PASS**：bundle 含 v0.3 P1 接线（colorLegend/callProfile/profileData/初始化画像/phl-onb/defaultOnboardDraft/has_profile）；冷启动引导全链路 + palette 驱动图例/mark + P2-c/d/e 回归全过；**真实数据零改动**（live 数据现 12 spans，测试自适应）
- 兼容性：live 3081 仍是旧 host（无 `/paper-hl/profile` 路由）→ 新 bundle 的 `loadProfile` GET 404 → **优雅降级**（内置五色，功能不炸）；`verify-http` 确认新 bundle 已从磁盘直接服务（client 改动无需重启）
- 调试中修正：run-render 一处断言笔误（未知色断言 `'#nope'` → 应为字面 `'nope'`）
- ⚠️ 浏览器目视确认（3081 → 论文 tab：重启 host 后引导面板在有画像时不再出现、图例随 colors.yml 渲染）待用户操作（含 host 重启）

**本轮未做（属后续 Phase）**：Phase 2 画像摘要注入 propose + 提案确认机制（GUI 面板）；Phase 3 画像编辑面板；Phase 4 多论文收敛验收；Phase 5 收尾

### Phase 2 — 画像摘要注入 propose + 提案确认机制（~2 天，工作量重心）

**目标**：propose 真正消费画像；v0.2 遗留的 `reflections.json` 提案走通「确认 → 并入四层 → 下次 propose 生效」闭环。

**交付**
- `skills/propose.md`（更新）：输入新增「画像摘要」—— 先 `read_profile` 取摘要，按 L1 颜色语义、L2 规则（含置信度门槛）、L3 示例（匹配当前节/主张类型时优先参考）、L4 统计微调密度；输出要求与去重硬规则 R1–R4 不变
- `skills/reflect.md`（更新）：产出提案后明确「等待用户确认（GUI 面板或聊天确认），确认由系统 `applyProposal` 执行，Agent 不直接写 rules.json」
- `skills/global-read.md`（微调）：plan 的 `expected_colors/density_hint` 生成时参考画像摘要（L2 密度基线 + L1 语义）
- GUI「待确认提案」面板（`render-body.js` + gen-client 注入）：聚合各 paper `reflections.json` 未确认提案（来自 `/paper-hl/profile`）→ 每提案显示规则/示例/统计雏形 + 建议置信度 → 「全部接受 / 全部否决 / 逐条接受 / 逐条否决」→ POST `/paper-hl/profile/apply` → 乐观更新（已确认 → 面板移除 + ✓ 记录）
- 数据契约：确认后 `reflections.json.confirmation` 写入（append-only），`highlight-profile` 四层更新，`stats.json` 聚合（按论文累计认可率/修改率/颜色分布 —— 供 Phase 4 指标消费）

**验证**
- `test/run-profile.js`（扩展）：`applyProposal` 全收/部分/否决路径 + reflections.confirmation 幂等
- `scripts/simulate-render.js`（扩展）：注入提案面板渲染（真实 reflections.json 数据，**只读不写**）→ 点「全部接受」→ 断言 POST `/paper-hl/profile/apply` 载荷 `{paper_id, decisions:{accept:'all'}}` → 面板状态更新；点「逐条否决」→ 载荷含具体 rule/exemplar id
- 端到端 `step7` 子流程（见 Phase 4）：真实 LLM 会话 —— propose（含摘要注入）→ 模拟审查 → reflect 提案 → 确认 → 断言四层文件与下次 propose 行为（如规则生效）
- 浏览器人工走查：对现有 `reflections.json`（s3 提案，**先备份**）点「全部接受」→ `rules.json` 出现 3 条规则、`exemplars.json` 3 条、`stats.json` 更新、`reflection-notes.md` 追加、reflections.json 打 confirmation → 刷新面板提案消失 → 恢复备份
- ⚠️ host/tools 变更需用户重启 3081 后做真实冒烟（只读先行）

### Phase 3 — 画像编辑面板（GUI）（~1.5 天）

**目标**：四层画像可视化查看与手工修正（验收 2 的 GUI 通道）。

**交付**
- 「画像」tab（`render-body.js` + gen-client）：
  - `colors.yml`：色名 → 颜色值/语义描述行内编辑 + 保存（POST `/paper-hl/profile`）
  - `rules.json`：规则列表（开关启用/禁用、密度阈值/粒度/置信度可编辑）+ 新增规则
  - `exemplars.json`：浏览（span 文本/建议/用户决策/备注）、删除
  - `stats.json`：只读汇总表（每篇/累计：认可率、修改率、颜色分布、修改类型分布）
  - `reflection-notes.md`：自然语言笔记编辑 + 保存
  - 所有编辑乐观更新 + 失败回读校准（沿用 P2-c 模式）

**验证**
- `test/run-render.js`（扩展）：面板数据纯函数（画像四层 → 面板模型、编辑载荷构造）
- `scripts/simulate-render.js`（扩展）：面板渲染 + 各编辑动作 POST 载荷断言 + 乐观更新
- 浏览器人工走查：改一个颜色语义 → 保存 → 图例即时变化；禁用一条规则 → 下次 propose 摘要不含该规则（配合 Phase 2 端到端）；reflection-notes 编辑保存

#### ✅ Phase 3 完成记录（2026-08-27，验证通过）

> 执行说明：用户指示直接进入 Phase 3（Phase 2 待做）。Phase 3 依赖的存储层/路由（Phase 0）与 `loadProfile` 完整画像（Phase 1）已就绪，故可先行；Phase 2 的 propose 摘要注入与提案确认 GUI 随后补做，不影响 Phase 3 交付。

**交付**（git 工作区已落盘）
- `host/profile.js`（扩展）：`applyProfileUpdate(profile, update)` 纯函数 —— `{colors?, rules?, exemplars?, reflection_notes?}` 部分更新；colors 合并校验（hex 拒绝）、rules **全量替换**（两遍扫描：提交列表内 max id + 无 id 新规则分配 `rule-<n>`、显式 id 重复跳过、空文本丢弃、enabled/confidence 编辑保留）、exemplars 全量替换（面板删除即移除条目）、notes 字符串替换；**stats 不可编辑**；输入不可变
- `host/plugin.js`（扩展）：`POST /paper-hl/profile/save`（GUI 面板写通道 → applyProfileUpdate → 原子写 → `{ok, applied}`；hex 非法/畸形 body → 400）
- `client/render-body.js`（扩展）：
  - 纯函数 `profilePanelModel(profile)` / `profilePanelColors(profile)` / `profileSavePayload(drafts)`（四层 → 面板草稿模型；扁平色行 → `{name:{color,label}}` 保存载荷；缺失层省略）
  - `profileState` 升级为完整 `profile`（原仅 colors）——palette 改从 `profile.colors` 解析
  - 工具栏「画像」按钮 + **画像编辑面板**（`panelView='profile'` 整页视图）：L1 颜色（色名只读/色值/语义可编辑）、L2 规则（启用 checkbox + 文本 + 置信度 select + 删除 + 「添加规则」输入行）、L3 示例（摘要 + 删除）、L4a 统计（只读 per-paper + overall）、L4b 反思笔记（textarea）；「保存全部」→ `callProfile('POST','/save', profileSavePayload(drafts))` → 成功 flash + `loadProfile()` 回读 / 失败 flash；「← 返回论文」切回
  - 面板行带测试锚点（`data-phl-color` / `data-phl-rule` / `data-phl-ex` / `phl-pnl-stats-row`）+ `.phl-pnl*` / `.phl-profile-btn` CSS
- `scripts/gen-client.js`（扩展）：导出 `profilePanelModel`/`profilePanelColors`/`profileSavePayload`；`client/client.js` / `dynamic/client-half.js` 重新生成
- `test/run-profile.js`（扩展）：`applyProfileUpdate` 矩阵 —— colors 合并/hex 拒绝、rules 全量替换（既有 id 保留 + 新 id 分配 + 重复 id 折叠 + 空文本丢弃 + enabled:false 保留）、exemplars 清空/替换、notes 替换、空 update no-op、null 拒绝、不可变性
- `test/run-plugin.js`（扩展）：`POST /profile/save` 路由 —— 四层 applied 摘要、持久化回读（改色/规则 id+禁用/示例/笔记）、hex 非法 400、畸形 body 400
- `test/run-render.js`（扩展）：`profilePanelModel`（null 回退 + profile 映射）/`profileSavePayload`（扁平→map、缺失层省略）
- `scripts/simulate-render.js`（扩展）：profile mock 升级为**完整四层**（`MOCK_PROFILE`）+ `/save` 载荷捕获；P3 交互注入 —— 点「画像」→ 面板渲染（四层标题/5 色行/2 规则行/2 示例行/1 统计行/笔记 textarea/保存按钮）→ 改红色 hex → 保存（POST `/save` 载荷 `colors.red.color='#112233'`）→ 关 rule-1 → 保存（`rules[0].enabled=false` 且 id 保留）→ 删首个示例 → 保存（`exemplars` 减一）→ 改笔记 → 保存（`reflection_notes`）→ 添加规则 → 保存（`rules` 3 条、新规则无 id 交 host 分配）→ 「← 返回论文」→ 论文视图恢复

**验证结果（2026-08-27）**
- 本地回归全绿：run-mock / run-tools / run-actions / run-plugin / run-render / run-profile → 全部 PASS；check-host / check-utf8 / verify-http → PASS
- 端到端 `simulate-render.js`（live 3081 读真实数据 + POST/profile mock）→ **SIMULATION PASS**：P1 冷启动引导 + P2-a…P2-e 全量回归 + **P3 画像面板全链路**（打开/四层渲染/5 类编辑 → /save 载荷逐项断言/添加删除/返回）；真实数据零改动
- 调试中修正：stats 行缺 `phl-pnl-stats-row` 类名（断言找不到）→ 补类名；断言用 `indexOf` 匹配复合类名
- ⚠️ live 3081 冒烟：`/profile/save` 路由为本次新增，**需用户再次重启 3081** 后生效；重启前新 bundle 已从磁盘直接服务（「画像」按钮可见、面板可开、保存会 404 → flash 报错属预期降级）。重启后走查：点「画像」→ 改颜色/规则/笔记 → 「保存全部」→ flash「画像已保存」→ 图例即时按新色渲染
- 浏览器人工走查清单（待用户）：画像面板四层可查可改；保存即落盘（`/paper-hl/profile` 回读一致）；图例随 colors.yml 变化

**本轮未做（属后续 Phase）**：Phase 2（propose 摘要注入 + 待确认提案 GUI 面板）；Phase 4 多论文收敛验收；Phase 5 收尾

### Phase 4 — 多论文收敛验收（~2 天，含 3 篇真实论文处理；v0.3 核心验收）

**目标**：跑通并度量「同一用户连续 3 篇同领域论文 → 修改率显著下降」，产出验收证据。

**交付**
- `scripts/profile-stats.js`（新）：从 `highlight-profile/stats.json` + 各 paper `reflections.json` 汇总逐篇指标（认可率/修改率/颜色分布/修改类型），输出表格
- `scripts/step7-multi-paper.js`（新，仿 step6-e2e 驱动模式）：
  - 对每篇论文：`session.create` → 全局通读（含画像摘要参考）→ 对代表节（Abstract + Introduction + Method + Conclusion 等 3–4 节，控制成本）逐节 propose → 真实 `POST /paper-hl/write` 模拟审查（含改色/删除/新增，动作模式逐篇向「认可」收敛以模拟真实用户习惯学习）→ reflect → **确认提案**（经 `/paper-hl/profile/apply`）→ 每篇产出 metrics 写 `stats.json`
  - 安全网：运行前备份 `paper.highlights.json` 与 `highlight-profile/`，失败自动恢复
- 验收执行计划：
  - **第 1 篇（画像前基线）**：现有 `p-mikolov-2013-2013-1-word2vec`（v0.2 期审查记录即基线：s3 节 accept 0 / 改色 1 / 删 1 / 加 1 → 认可率低、修改率高）；如需可续跑补足代表节
  - **第 2/3 篇**：新增同领域论文 PDF 2 篇（词嵌入/NLP 2013 前后同领域，如 Mikolov 后续论文或同领域会议论文，经真实 MinerU 解析，`data/<paper_id>/` 落盘）
  - **判定**：第 3 篇认可率 ≥ 70% 且修改率较第 1 篇相对下降 ≥ 50%（D4 口径；阈值按实际数据可调并记录）
- 人工验收路径（文档化）：3081 浏览器逐篇走查（propose → 审查 → 确认提案 → 画像面板观察规则/示例增长），与 step7 指标互相印证

**验证**
- 回归全量（§3.5 清单 + run-profile + simulate-render 新用例）全绿
- step7 三篇跑通，`profile-stats.js` 输出逐篇曲线（基线 → 第 2 篇 → 第 3 篇），认可率上升、修改率下降趋势成立
- 若第 3 篇未达阈值：记录差距与原因（示例库规模/规则置信度/论文差异度），调整阈值或补充画像规则后复测（验收允许「阈值可调」，但须在文档记录调整理由）

### Phase 5 — 文档收尾 + 归档 v0.3.0（~0.5 天）

- 设计文档：§8 v0.3 标注「✅ 已完成」+ 验收记录；§10 风险 #5 关闭（确认机制闭环 + 收敛指标达标）；§4.3 画像目录位置按 D1 落地确认
- 本进度文件：各 Phase 完成记录（沿用 v0.2 格式）、§8 状态更新、§9 交付物清单勾选
- README：状态横幅更新为 v0.3 ✅ + 布局补 `host/profile.js` / `highlight-profile/` / 新技能说明 / step7
- git 归档：`v0.3.0`（含 `highlight-profile/`、`host/profile.js`、GUI 画像面板、step7、测试扩展、文档）

## 7. 风险与对策

| 风险 | 对策 | 验证点 |
|---|---|---|
| 差异推断质量（误推断污染画像） | 推断只产出提案（v0.2 已定）；**确认动作由 host 纯逻辑执行**，Agent 不直接写规则；低置信规则标「候选」不自动启用 | applyProposal 单测矩阵 + step7 端到端 |
| 示例库规模过小时 few-shot 效果差 | L3 注入 top-k（3–5 例）+ 按节/主张类型匹配优先；统计雏形兜底 | buildProfileSummary 形状断言 + 收敛趋势 |
| 确认机制破坏 append-only 契约 | `confirmation` 字段一次性写入不可改；applyProposal 幂等（重复确认拒绝）；变更摘要落 reflection-notes | run-profile 幂等/拒绝矩阵 |
| 3 篇论文验收成本高（MinerU 额度 + LLM 会话） | 每篇只审代表节（3–4 节）控制成本；第 1 篇复用 v0.2 数据作基线不重跑 | step7 三篇实际执行记录 |
| 收敛指标不达标 | 阈值可调但须记录理由；补充画像规则/示例后复测；区分「画像学习不足」与「论文差异大」 | profile-stats 曲线 + 人工评估 |
| 图例/色板改动破坏既有渲染 | colors.yml 默认值 = 现五色，向后兼容；colorLegend 纯函数容错（空/坏 colors 回退默认） | run-render 矩阵 + simulate-render |
| GUI 与 Agent 状态漂移（画像被并发编辑） | 单一 JSON 契约 + 编辑即时写盘 + 刷新重读（沿用 v0.2 模式） | simulate-render + 人工走查 |

## 8. 当前状态 / 待办

- **状态**：**v0.3 Phase 0 + Phase 1 归档 `v0.2.1`；Phase 3 已完成并归档 `v0.2.2`**（2026-08-27）。v0.2 归档 `v0.2.0`。
- **待办**：Phase 2（画像摘要注入 propose + 提案确认 GUI 面板）→ 4（多论文收敛验收）→ 5（收尾归档 v0.3.0）。**注**：Phase 3 已先行（用户指示），其依赖（Phase 0 存储/路由 + Phase 1 完整画像）均已就绪；Phase 2 的确认机制 host 侧已具备（`confirm_proposal` 工具 + `/profile/apply` 路由 + reflections.confirmation 契约），待补 GUI 提案面板 + 技能摘要注入。
- ⚠️ 数据状态：`data/p-mikolov-…/` **12 spans**（测试自适应）+ plan（s3 reviewed）+ duplicates 3 + `reflections.json`（**未确认提案，Phase 2 确认机制的首个真实用例**）；`D:\aa\highlight-profile/` **默认四层**（5 色 + 基线规则 rule-1/rule-2 + 空示例/统计 + 笔记模板）。
- ⚠️ 环境纪律：**3081 = 会话 Web，Agent 不得自行 kill/restart**（v0.2 §10 事故教训）；host 代码变更后需**用户手动重启**。当前 3081 已加载 v0.2.1 host（`/paper-hl/profile` 正常，live 冒烟通过：has_profile:true + pending_proposals 含 `p-mikolov` 提案 1 条）；**`POST /profile/save` 为 v0.2.2 新增，需再次重启后生效**；新 client bundle 已直接服务（画像按钮/面板可用，保存 404 → flash 报错属降级预期）。

## 9. v0.3 交付物清单（规划，随实施更新）

| 路径（规划） | 内容 | 状态 |
|---|---|---|
| `docs/paper-highlight-progress-v0.3.md` | 本进度文件 | ✅ 已建并维护（Phase 0/1/3 完成记录已写入） |
| `D:\aa\highlight-profile\{colors.yml, rules.json, exemplars.json, stats.json, reflection-notes.md}` | 四层画像存储（D1） | ✅ 已落盘（Phase 0，默认四层 + 基线规则） |
| `packages/paper-highlight/host/profile.js` | 画像读写/校验/`ensureProfile`/`buildProfileSummary`/`applyProposal`/`applyProfileUpdate` 纯逻辑（D2/D3/D5/D7） | ✅ 已实现（Phase 0 + Phase 3） |
| `packages/paper-highlight/host/tools.js`（扩展） | `read_profile` / `confirm_proposal` 工具 | ✅ 已实现（Phase 0） |
| `packages/paper-highlight/host/plugin.js`（扩展） | `GET /paper-hl/profile` + `POST /init` + `POST /apply` + **`POST /save`（Phase 3）** 路由 | ✅ 已实现（Phase 0 + Phase 3） |
| `packages/paper-highlight/host/schema.js`（扩展） | `reflections.json.confirmation` 校验（`validateReflections`） | ✅ 已实现（Phase 0） |
| `packages/paper-highlight/client/render-body.js`（扩展） | **`colorLegend(colors)` + `markStyle(colors)` + `callProfile` + 冷启动引导面板（Phase 1 ✅）+ 画像编辑面板 `profilePanelModel`/`profileSavePayload`（Phase 3 ✅）**；待确认提案面板（Phase 2） | Phase 1/3 已完成，Phase 2 规划 |
| `packages/paper-highlight/skills/propose.md`（更新） | 画像摘要注入（read_profile → 摘要 → propose 参考） | 规划（Phase 2） |
| `packages/paper-highlight/skills/reflect.md`（更新） | 提案 → 等待确认（确认由 applyProposal 执行） | 规划（Phase 2） |
| `packages/paper-highlight/skills/global-read.md`（微调） | plan 生成参考画像摘要 | 规划（Phase 2） |
| `packages/paper-highlight/scripts/step7-multi-paper.js` | 3 篇同领域论文收敛验收驱动 | 规划（Phase 4） |
| `packages/paper-highlight/scripts/profile-stats.js` | 逐篇收敛指标汇总（认可率/修改率曲线） | 规划（Phase 4） |
| `packages/paper-highlight/test/run-profile.js` | 画像层单测（冷启动/校验/摘要/applyProposal 矩阵/confirm 工具/applyProfileUpdate 矩阵） | ✅ 已实现（Phase 0 + Phase 3） |
| `packages/paper-highlight/test/{run-tools,run-plugin,run-render}.js`（扩展） | 新工具/路由/面板纯函数断言（Phase 0 ✅ / Phase 1 ✅ / Phase 3 ✅） | Phase 0/1/3 已完成，Phase 2 规划 |
| `packages/paper-highlight/scripts/simulate-render.js`（扩展） | 引导/图例交互（Phase 1 ✅）+ 画像面板交互（Phase 3 ✅）；提案面板（Phase 2 规划） | Phase 1/3 已完成，Phase 2 规划 |

## 10. 里程碑检查点

| 检查点 | 触发条件 | 判定 |
|---|---|---|
| M0 | Phase 0 完成 | ✅ 本地回归全绿（含 run-profile）；`/paper-hl/profile` 路由矩阵 + `confirm_proposal` 夹具闭环（live 冒烟待用户重启 3081） |
| M1 | Phase 1 完成 | ✅ 冷启动引导 + 图例/色板/mark palette 驱动（simulate-render PASS）；浏览器走查待用户操作 |
| M2 | Phase 2 完成 | 现有 reflections.json 提案经确认并入四层（备份后恢复）；propose 摘要注入生效（step7 子流程） |
| M3 | Phase 3 完成 | ✅ 画像面板四层可查可改；编辑即落盘（/save 载荷 + 回读断言）；simulate-render PASS；live 冒烟/浏览器走查待用户重启 3081 |
| M4 | Phase 4 完成（**v0.3 验收**） | 3 篇论文收敛指标达标（第 3 篇认可率 ≥ 70% 且修改率较基线相对下降 ≥ 50%，D4 口径） |
| M5 | Phase 5 完成 | 文档/README 更新；归档 `v0.3.0` |
