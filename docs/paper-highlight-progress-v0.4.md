# Paper Highlight Agent — v0.4 项目进度（打磨导出 / 领域地图 / 论文级反思 / UX）

> 版本：v0.4（打磨导出）· 状态：**Phase 0–3 已完成（归档 `v0.3.1` / `v0.3.2` / `v0.3.3`）· Phase 4–5 待实施** · 创建：2026-08-27 · 最近更新：2026-08-27
> **独立使用说明**：本文件含 v0.3 继承状态、v0.4 目标/已锁定决策/实施步骤（含验证方法）/风险/命令，可脱离旧文件单独续作；旧版记录见 `paper-highlight-progress-v0.3.md`（归档，v0.3.0）。

---

## 1. 项目定位与 v0.4 目标

- **项目一句话**：在 DeepSeek Harness（DSH）之上构建单论文多色高亮 Agent —— 用户提供论文 PDF → MinerU 云 API 解析为结构化 Markdown → `dsh web`（paper profile, 3081）GUI 整体渲染 → Agent 依据「论文整体认识 + 领域发展线 + 用户画像」逐节提出语义高亮 → 用户审查修改 → 画像持续学习 → **导出**。
- **v0.1（已完成，归档）**：管线打通 —— PDF → MinerU → `data/<paper_id>/` 归一化产物 → Agent 工具读写高亮 JSON → GUI 渲染正文 + 显示 spans。
- **v0.2（已完成，归档 `v0.2.0`）**：审查闭环 —— 「全局通读 → 逐节 propose → GUI 审查 → 差异分析/章节反思（reflections.json 提案）→ 下一节」核心循环全链路跑通。
- **v0.3（已完成，归档 `v0.3.0`）**：个性化画像收敛 —— 四层画像 + 冷启动 + 摘要注入 + 确认生效机制，三篇同领域论文收敛验收 PASS（修改率 50%→33%→0%）。
- **v0.4 目标**：打磨与导出 —— 把「审查完的论文」变成**可交付、可分享、可续读**的终端产物：① 导出带高亮 HTML/MD（`<mark>` + 图例，与 GUI 所见一致）；② 领域地图 `field-map.md` 初建并完善注入机制；③ 论文级反思与收尾总结；④ UX 打磨（快捷键、导出入口、会话恢复/进度续读）。

## 2. 关联文档

| 文档 | 路径 | 用途 |
|---|---|---|
| 设计文档 | `D:\aa\docs\paper-highlight-agent-design.md` | §7 领域知识（field-map 注入）、§8 v0.4 范围/验收、§9 目录结构（`field-map.md` 位置）、§10 风险 #6 |
| v0.3 进度归档 | `D:\aa\docs\paper-highlight-progress-v0.3.md` | v0.3 交付记录、四层画像/确认机制/收敛验收结论、环境纪律（§3.4） |
| v0.2 进度归档 | `D:\aa\docs\paper-highlight-progress-v0.2.md` | 审查闭环交付记录、校准结论、事故教训（仅回溯用） |
| 一页纸快照 | `D:\aa\docs\paper-highlight-one-pager.md` | 项目状态速览（v0.4 完成后同步更新） |
| 本文件 | `D:\aa\docs\paper-highlight-progress-v0.4.md` | v0.4 进度（当前，规划中） |

## 3. v0.3 继承状态（独立使用必需）

### 3.1 运行环境
- Windows；harness `dsh web`（port 3080，profile `web`）；**paper profile 独立跑 3081**
- paper profile 启动：`dsh --profile paper --port 3081 --no-open`（后台 job；`prepareProfile` 会重写 profile/cordis.yml，启动需 danger-full-access）
- DSH 安装：`C:\Users\eyx\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh`；profiles：`C:\Users\eyx\.dsh\profiles\`
- 环境变量：`MINERU_API`（已 setx，len=51）；`MINERU_BASE_URL`（默认 `https://mineru.net`）、`MINERU_UPLOAD_MODE=file|url`、`MINERU_OCR=1`、`MINERU_FORMULA=1`、`MINERU_LANGUAGE`
- 沙箱：`D:\aa` 内写入免授权；工作区外（`.dsh\.agent-presets`、`profiles/node_modules`）需 danger-full-access 一次性升级 + 用户批准；npm 用 `npm --cache D:\aa\.npm-cache`

### 3.2 关键路径与交付物（v0.3 已就绪，勿重复造）
- git：**tag `v0.3.0`**（画像收敛交付），工作区 clean
- 插件包 `D:\aa\packages\paper-highlight\`：
  - `host/`：`schema.js`（模型校验 + `validateReflections` + `confirmation` 契约）、`store.js`（原子读写）、`mineru.js` / `normalize.js` / `pipeline.js`、`plugin.js`（`/paper-hl`：GET `/read` + POST `/write` + GET `/profile` + POST `/init` + POST `/apply` + POST `/save`）、`sections.js`、`actions.js`（审查动作纯逻辑）、`diff.js`（`classifySpanChange`/`summarizeDiff`）、**`profile.js`（v0.3：画像四层 + `ensureProfile`/`buildProfileSummary`/`applyProposal`/`applyProfileUpdate`）**、`tools.js` + `tools-plugin.mjs`（**8 工具**：`parse_pdf` / `read_highlights` / `write_highlights` / `list_sections` / `read_section` / `summarize_section_diff` / `read_profile` / `confirm_proposal`）
  - `client/`：`render-body.js`（渲染逻辑单一来源，含 P2-a…P2-e + `colorLegend`/`markStyle`/`callProfile`/冷启动引导/画像面板/提案面板）、`client.js`（durable bundle，ModuleLoader 格式）
  - `dynamic/`：`client-half.js` / `host-half.js`（动态双半体备用）
  - `skills/`：三份技能 `global-read.md` / `propose.md` / `reflect.md`（运行时经 `<projectRoot>/.agents/skills` junction 发现，**无需重启即可被 skill 工具加载**）
  - `scripts/`：`gen-client.js`、`simulate-render.js`、`verify-http.js`、`check-host.js`、`check-utf8.js`、`seed-demo.js`、`step4-e2e.js`、`step5-acceptance.js`、`step6-e2e.js`、**`step7-multi-paper.js` / `profile-stats.js`（v0.3）**
  - `test/`：`run-mock.js` / `run-tools.js` / `run-actions.js` / `run-plugin.js` / `run-render.js` / **`run-profile.js`（v0.3）** / `run-real.js` + `verify.js` + fixtures
- 画像存储：**`D:\aa\highlight-profile/`**（v0.3 验收留盘：`colors.yml` + `rules.json` + `exemplars.json` + `stats.json` + `reflection-notes.md`，git 跟踪；根解析同 data：组合 config `root` → `HIGHLIGHT_PROFILE_ROOT` → 默认 workspace）
- agent preset：`C:\Users\eyx\.dsh\.agent-presets\paper\`（含工具行；trust: user）
- profile：`C:\Users\eyx\.dsh\profiles\paper\`（bundles = dsh-base + dsh-web-app + paper-highlight；`cordis.patch.yml` 钉 `root: 'D:\aa'` + 默认 preset=paper）
- junction：`profiles\node_modules\paper-highlight` → 包

### 3.3 数据现状
- **三篇论文**（同领域 NLP 2013–2016）：
  - `p-mikolov-2013-2013-1-word2vec`：v0.2 数据（80 锚点 / 12+ spans / plan / s3 reviewed / duplicates 3 / **reflections 提案未确认**）
  - `p-sutskever-2014-seq2seq`：66 锚点 / 9 页 / **9 spans + 3 节 reviewed + reflections 已确认**（stats 条目 approve_rate 0.667 / modify_rate 0.333）
  - `p-bahdanau-2016-attention`：147 锚点 / 14 页 / **6 spans + 3 节 reviewed + reflections 已确认**（stats 条目 approve_rate 1.0 / modify_rate 0）
- **`D:\aa\highlight-profile/`**（验收留盘）：`colors.yml`（五色语义）+ `rules.json`（**9 规则**：rule-1..rule-9，rule-5 低置信禁用候选）+ `exemplars.json`（**13 示例**）+ `stats.json`（**2 篇论文**，overall 认可率 80% / 修改率 20%）+ `reflection-notes.md`
- **领域地图 `field-map.md` 尚不存在**（v0.4 Phase 2 初建）
- **导出能力尚不存在**（v0.4 Phase 0–1 新建；当前 GUI 渲染 = anchors 阅读序重建正文 + `<mark>` 注入，见 `render-body.js::renderText`/`buildBlockSegments`，v0.4 导出与之同源）
- 锚点模型：`anchor_id = a-<page:04d>-<block:02d>-<par:02d>`；span `char_start/char_end` 0 起始半开区间指向 `anchor.text`；`md_offset` 保证锚点文本在 `paper.md` 中按字符精确定位
- 正文过滤（v0.1）：保留 text/title/content；跳过 image/table/formula/ref_text 等

### 3.4 关键校准（既有结论，必须遵守）
1. **MinerU 流程**：`POST /api/v4/file-urls/batch`（须 **Content-Length**）→ 预签名 PUT → 系统自动提交任务 → 轮询 `extract-results/batch/{batch_id}` → 下载 `full_zip_url`；pipeline 返回字段是 **`batchId`**（非 taskId）
2. **zip 中间结构**：`layout.json`；`pdf_info[i].para_blocks`（段落合并视图，首选）/ `preproc_blocks`（兜底）；**para_blocks 原始数组序即权威阅读序（禁 bbox y 排序）**
3. **dsh-tools 工具输出必须 lossless JSON**：`undefined/NaN/Infinity/BigInt/循环引用` 报 `INVALID_TOOL_OUTPUT`；不存在字段显式 `?? null`
4. **dsh web 浏览器传输 = HTTP JSON-RPC**：`POST /api/<method>`，信封 `{type:'client-request', rpcId, method, payload}`；事件流 WebSocket `/api/events.mux`；`session.prompt` 用 `mode:'queue'` 异步受理，轮询 `session.list` 的 `running` 判定回合结束
5. **host 网络**：不用 `ctx.web.fetch`（无 fetch provider），直接用 Node `https`
6. **数据根目录解析**：组合 config `root` → `PAPER_HL_ROOT` → `process.cwd()` 兜底（paper profile 已钉 `root: 'D:\aa'`）
7. **client 插件机制**：`conversation.view` 槽位 + `window.__ModuleLoader__.load({id, factory})` bundle；数据走同源 `fetch('/paper-hl/read')`；CSS 用 `document.querySelector("style[data-plugin-css=…]")` 注入；`gen-client.js` 以 toString 内嵌 `render-body.js` 纯函数并导出（`keyAction` 等新纯函数须同样导出）
8. **环境纪律（v0.2 §10 事故教训，永久生效）**：**3081 = 会话 Web = Agent 不得自行 kill/restart**。host 代码变更后的重启一律由用户手动执行；Agent 只做只读验证；live 验证前先只读 GET `/paper-hl/read` 确认新代码已加载

### 3.5 测试命令（v0.3 回归基线，v0.4 改动后必须全绿）
```powershell
$env:NODE_PATH = 'C:\Users\eyx\.dsh\profiles\node_modules'
node D:\aa\packages\paper-highlight\test\run-mock.js
node D:\aa\packages\paper-highlight\test\run-tools.js
node D:\aa\packages\paper-highlight\test\run-actions.js
node D:\aa\packages\paper-highlight\test\run-plugin.js
node D:\aa\packages\paper-highlight\test\run-render.js
node D:\aa\packages\paper-highlight\test\run-profile.js
node D:\aa\packages\paper-highlight\test\run-export.js   # v0.4 Phase 0 新增
node D:\aa\packages\paper-highlight\test\run-reflect-paper.js   # v0.4 Phase 3 新增
node D:\aa\packages\paper-highlight\scripts\simulate-render.js   # live 3081，POST 走 mock，真实数据零改动
node D:\aa\packages\paper-highlight\scripts\verify-http.js
node D:\aa\packages\paper-highlight\scripts\step6-e2e.js          # 需要 3081 运行 + LLM 会话（按需）
node D:\aa\packages\paper-highlight\scripts\step8-export-e2e.js   # v0.4 Phase 5 新增（按需）
```

## 4. v0.4 范围与验收（设计文档 §8）

**范围**
- 导出带高亮 HTML（`<mark>` + 图例）/ Markdown。
- 领域地图 `field-map.md` 初建与注入机制完善。
- 论文级反思与收尾总结。
- UX 打磨：键盘操作、图例、快捷键、会话恢复（重开会话续读 JSON）。

**验收标准（两条，均为硬指标）**
1. **端到端稳定**：完整流程无人工介入可交付导出文件 —— 对真实论文经 `step8-export-e2e.js` 全流程产出 `data/<paper_id>/export/<paper_id>.html` + `.md`，产物校验 PASS（`<mark>` 数 = 导出 spans 数、图例条目 = colors 键数、HTML 自包含无外部引用）。
2. **导出 HTML 在浏览器/笔记软件中打开正常，图例完整** —— 人工走查：浏览器打开导出 HTML 目视「高亮颜色正确、图例条目与 `colors.yml` 五色一致、无外部资源依赖」；笔记软件/VS Code 预览 Markdown 打开正常。

**风险/依赖（设计 §10）**
- 导出渲染与 GUI 不一致（同源 anchors 重建 + 单测兜底，见 D2）。
- 领域地图注入时机/大小（只读按需注入，不常驻，见 D4）。
- 长论文上下文管理（设计 §10 #6，未来，v0.4 仅论文级反思的整篇汇总需要控制 token）。

## 5. v0.4 关键设计决策（实现前已锁定）

| # | 决策 | 结论 | 理由/备注 |
|---|---|---|---|
| **D1** | 导出产物位置 | **`data/<paper_id>/export/<paper_id>.html|md`**（论文目录内子目录，git 可跟踪） | 与论文数据同处，Agent 文件工具可直接访问；`listPaperIds` 只扫 `data/` 顶层目录（`plugin.js::listPaperIds`），`data/<paper_id>/export/` 不污染论文枚举 |
| **D2** | 导出渲染来源 | **anchors 阅读序重建正文 + `<mark>` 注入 + 图例（L1 `colors.yml` 驱动）**；HTML **自包含**（内联 CSS、无外部资源/JS 依赖，打开即用） | 与 GUI 渲染同源（`render-body.js` 的 `renderText`/`buildBlockSegments` 即 anchors 阅读序重建 + `<mark>`），**所见即所得**；避免第三方 MD 渲染器；**否决**「直接改 paper.md 注入」方案（依赖 `md_offset` 与归一化文本一致性、且 GUI 本就不按 Markdown 渲染，易导出与所见不一致）——留作后续增强 |
| **D3** | 导出 spans 范围 | 默认导出 **`accepted` + `user_added`**（排除 `rejected`/未决 `proposed`）；`include_pending` 选项（默认 false） | 未决候选不应进交付物；口径与 GUI 高亮显示（`excludeRejected`）一致 |
| **D4** | 领域地图 | `field-map.md` 建在 **workspace 根 `D:\aa\field-map.md`**（设计 §9）；初建由 global-read 通读三篇论文（Mikolov 2013 / Sutskever 2014 / Bahdanau 2016）+ 领域常识骨架化；Agent 经 `read_field_map` 工具**只读、按需注入**（不常驻 system prompt，设计 §7）；增补走论文级反思提案 + 文件工具编辑（用户可手工编辑） | 设计 §7「分头维护、按需注入」落地；文件手动可编辑 = 可维护性双通道之一 |
| **D5** | 论文级反思产物 | 收尾（全部可审查节 `reviewed` 或用户说「论文完毕」）→ 整篇 `summarize_section_diff`（无 section 参数）→ host 纯函数 `paperReflectionTemplate` 生成结构化模板 → Agent 填充自然语言 → 落盘 **`data/<paper_id>/paper-reflection.md`**；沉淀的偏好（规则/示例）仍走 `profile_proposal`（需用户确认，防污染）；领域地图增补点记入文档 | 延续「Agent 只提案、确认才生效」；论文级反思 = 章节反思在整篇尺度的汇总 + 收尾总结，不自我空转（设计 §5.5） |
| **D6** | UX 快捷键/导出/恢复 | GUI 论文视图新增：`keyAction` 快捷键映射（**1-5 改色 / a 接受 / d 删除 / r 改范围 / n 新增 / Esc 取消 / Ctrl+Enter 标记节完毕 / e 导出对话框**，仅论文视图 + 非输入态生效）；工具栏「导出」按钮 + 导出对话框（格式 HTML/MD、是否含未决、下载）→ `GET /paper-hl/export?…&download=1`；会话恢复 = mount 时按 `plan.status` 渲染**审查进度条 + 「继续上次」**（定位第一个未审查节；JSON 全量续读 v0.2 已具备，补进度视图） | 快捷键/进度均为纯函数可单测；导出 GUI/Agent 双通道 |
| **D7** | 工具与路由 | 新增 **3 工具**：`export_paper`（格式/是否含未决/输出 inline\|file）、`read_field_map`（只读）、**`reflect_paper`（Phase 3 追加：论文级反思脚手架，D5 落地所需）**；新增路由 **`GET /paper-hl/export?paperId=&format=html|md&include_pending=&download=1`**；工具数 **8 → 10（Phase 1/2）→ 11（Phase 3）** | 导出 GUI 下载 + Agent/自动化双通道；领域地图只读注入；论文级反思脚手架（Phase 3 实施决定：D5「调 paperReflectionTemplate」需 Agent 可调用的 host 工具，故追加第 11 个工具） |

## 6. 实施步骤（Phase 0–5，含交付物与验证方法）

> **验证方法总则（贯穿所有 Phase）**：① 纯函数单测矩阵（run-export / run-tools / run-plugin / run-render 扩展）→ ② 本地回归全绿（§3.5 清单）→ ③ `simulate-render.js` 交互注入（POST 走 mock 或备份后真实，**真实数据零改动**）→ ④ 真实 3081 只读冒烟（先 GET 确认新 host 代码已加载；host 改动后需**用户手动重启** 3081，Agent 不得 kill/restart）→ ⑤ 浏览器人工走查清单。每 Phase 完成记录沿用 v0.3 格式（✅ 完成记录，含交付/验证结果/未做清单）。

### Phase 0 — 导出核心纯逻辑（`host/export.js`，~2 天）

**目标**：把「highlights + anchors + colors.yml → 带高亮 HTML/MD」做成纯函数，后续所有导出功能的地基。

**交付**
- `host/export.js`（新，纯逻辑可单测，不依赖 DOM）：
  - `buildExportSpans(highlights, {include_pending})`：过滤 + 归一化 —— 默认保留 `accepted`+`user_added`（排除 `rejected`/未决 `proposed`；`include_pending:true` 时含 `proposed`）；`char_start/end` 对 `anchor.text.length` 钳制
  - `renderHtml({paper, highlights, colors, include_pending})`：自包含 HTML —— 正文段落（anchors 阅读序重建，同 GUI `renderText` 语义）+ `<mark class="hl-<color>">` 注入 + **图例**（`legendHtml(colors)`）+ 内联 CSS（颜色类来自 colors.yml）+ 元信息头（标题/paper_id/导出时间/导出统计）；**无外部资源/JS 引用**
  - `renderMarkdown(...)`：同源正文 + `<mark>` 注入（兼容主流 MD 查看器）+ 顶部图例区
  - `legendHtml(colors)` / `legendMd(colors)`：L1 色图 → 图例条目（缺省/空/坏 colors 回退内置五色，对齐 `colorLegend` 容错）
  - 颜色解析复用 `profile.js` 的 `readProfile(root).colors`（缺失回退内置五色）
- 复用既有：`store.js::readHighlights/readPaperMd/readAnchors`、`sections.js::buildSections`、`profile.js::readProfile`

**验证**
- 新增 `test/run-export.js`：矩阵 —— 空 spans / 无画像回退五色 / 跨行与越界钳制 / 排除 rejected+未决 / `include_pending=true` 含 proposed / 颜色类与 colors.yml 一致 / **HTML 自包含断言**（无 `http://`/`https://` 资源引用、`<mark>` 数 = 导出 spans 数、图例条目 = colors 键数、`hl-red` 等类存在）/ MD 同样断言 + 输出可读（无非法转义）
- 本地回归全绿（§3.5 既有 run-* 全过）

#### ✅ Phase 0 完成记录（2026-08-27，验证通过）

**交付**（git 工作区已落盘）
- `host/export.js`（新，纯逻辑可单测，零外部依赖）：
  - `buildExportSpans(highlights, {include_pending})`（D3 过滤+钳制）：默认保留 `accepted`+`user_added`，`include_pending` 时含 `proposed`，`rejected` 永不导出；越界钳制、未知锚点/空区间跳过
  - `renderHtml({highlights, colors?, include_pending?, exported_at?})`（D2 自包含 HTML）：anchors 阅读序重建正文 + `<mark class="hl-<color>">` 注入 + 图例 + 内联 CSS + 元信息头（标题/paper_id/导出时间/统计）；**无外部资源/JS**
  - `renderMarkdown(...)`：同源正文 + `<mark>` 内联注入 + 顶部图例区（兼容 GFM/VS Code 预览）
  - `legendHtml/legendMd(palette)` + `resolveColors(colors)`（L1 色图 → 图例；null/空/残缺回退内置五色，对齐 client `colorLegend` 容错）
  - `buildExport({format, highlights, colors, include_pending, exported_at})` 统一入口（route/tool 共用，返回 content + stats）+ `normalizeFormat`/`exportDir`/`exportFileName`/`writeExport`（D1：`data/<paper_id>/export/<paper_id>.<ext>` 原子写）
- `test/run-export.js`（新）：矩阵 —— buildExportSpans 默认/include_pending/钳制/跳过、resolveColors（null→5 内置、部分补全、未知→#cccccc+name）、renderHtml 自包含断言（无 http(s)/JS、`<mark>` 数=导出 spans 数、图例条目=色键数、hl-`<color>` CSS、HTML 转义）、renderMarkdown（H1/meta/内联 mark/图例/原文保留）、buildExport 路由+stats+include_pending、normalizeFormat 未知格式抛错

**验证结果（2026-08-27）**
- 新增 `run-export.js` → PASS；本地回归全绿：run-mock / run-tools / run-actions / run-plugin / run-render / run-profile / **run-export（新）** → 全部 PASS；check-host / check-utf8 → PASS
- 调试中修正：测试夹具字符偏移笔误（如 [0,7)→[0,9)）与 legend 计数口径（CSS 选择器亦含 `.phl-legend-item` → 改用 `class="phl-legend-item"` 精确计数）
- 真实数据离线冒烟（export_paper inline，零写入）：`p-bahdanau-2016-attention` html → 6 marks / 5 legend / 无外部 http；md → 6 marks 标题正确

**本轮未做（属后续 Phase）**：Phase 1 host 路由 + export_paper 工具；Phase 2–5

### Phase 1 — host 路由 + Agent 工具（`export_paper`，~1 天）

**目标**：导出能力对 GUI（下载）与 Agent（工具）双通道开放。

**交付**
- `host/plugin.js`（扩展）：`GET /paper-hl/export?paperId=<id>&format=html|md&include_pending=&download=1` → 生成并返回内容（`Content-Type: text/html; charset=utf-8` / `text/markdown; charset=utf-8` + `Cache-Control: no-store`）；`download=1` 时加 `Content-Disposition: attachment; filename="<paper_id>.<ext>"`；负例 400/404 同 `/write` 契约
- `host/tools.js`（扩展）：新工具 `export_paper({paper_id, format?='html', include_pending?=false, output?='inline'|'file', root?})` —— `inline` 返回内容字符串（lossless）+ 统计（spans 数/导出 spans 数/字符数）；`file` 写盘 `data/<paper_id>/export/<paper_id>.<ext>` 并返回路径
- `scripts/verify-http.js`（扩展，可选）：`/paper-hl/export` 通路由自检

**验证**
- `test/run-plugin.js`（扩展）：/export 路由矩阵 —— 缺 paperId 400 / 未知 format 400 / 未知 paperId 404 / 正常 200 + Content-Type / download header / `include_pending` 效果（spans 数变化）
- `test/run-tools.js`（扩展）：`export_paper` —— inline 返回形状 + lossless / file 写盘路径存在 + 内容回读 / 未知 format ok:false
- 本地回归全绿 + `verify-http.js`；真实 3081 只读冒烟（host 重启后）：`GET /paper-hl/export?paperId=p-bahdanau-2016-attention&format=html` 返回可打开 HTML

#### ✅ Phase 1 完成记录（2026-08-27，验证通过）

**交付**（git 工作区已落盘）
- `host/plugin.js`（扩展）：`GET /paper-hl/export?paperId=<id>&format=html|md&include_pending=&download=1`（`handleExport`）→ `Content-Type: text/html|text/markdown; charset=utf-8` + `Cache-Control: no-store` + `Content-Length`；`download=1` 加 `Content-Disposition: attachment; filename="<paper_id>.<ext>"`；负例 400/404 同 `/write` 契约；**无副作用**（profile 缺失时回退内置五色，不创建画像）
- `host/tools.js`（扩展）：新工具 **`export_paper`**（`{paper_id, format?, include_pending?, output?('inline'|'file'), root?}`）—— inline 返回 content + stats（lossless）；file 写盘 `data/<paper_id>/export/<paper_id>.<ext>` 并返回路径（content 置 null + content_chars）；工具数 **8 → 10**
- `scripts/verify-http.js`（扩展）：`/paper-hl/export` live 探针（旧 host 404 作信息性提示，不判失败）

**验证结果（2026-08-27）**
- `test/run-plugin.js`（扩展）：/export 路由矩阵 —— 200 + Content-Type（html/md）+ download 附件头、include_pending 效果（2→3 marks）、负例（缺 paperId 400 / 未知 format 400 / 未知 paperId 404）→ PASS；`invoke` 升级为捕获 headers（向后兼容）
- `test/run-tools.js`（扩展）：export_paper —— inline 形状 + stats（默认 4 marks / include_pending 5）+ lossless、file 写盘回读 4 marks、未知 format/paper ok:false → PASS
- 本地回归全绿（7 套全过）+ check-host / check-utf8 PASS
- 真实数据离线路由冒烟（plugin.apply fake ctx，root=D:\aa）：`/paper-hl/export` bahdanau → 200 `text/html` 6 marks；ghost → 404；pdf → 400
- **live 3081 只读冒烟（用户已重启 host，2026-08-27）**：`verify-http.js` 全绿 —— GET `/paper-hl/export` → 200 `text/html; charset=utf-8`（mikolov 7 marks / bahdanau 6 marks，legend 5，无外部资源引用）；md → 200 `text/markdown; charset=utf-8` 标题正确 6 marks；`download=1` → `Content-Disposition: attachment; filename="p-bahdanau-2016-attention.html"`；负例 live 400/404 正确；`GET /paper-hl/read` 确认新 host 已加载；client bundle 未变（无 client 改动）

**本轮未做（属后续 Phase）**：Phase 2 领域地图 field-map.md + read_field_map + 技能注入；Phase 3 论文级反思；Phase 4 UX 打磨；Phase 5 step8 端到端 + 文档收尾 + 归档 v0.4.0

### Phase 2 — 领域地图 `field-map.md` + `read_field_map` + 技能注入（~1.5 天）

**目标**：领域知识上下文落地（设计 §7），让 propose 能判断语句「分量」。

**交付**
- **`D:\aa\field-map.md`**（新，workspace 根，git 跟踪）：领域发展线骨架 —— NLP 2013–2016 主线（word2vec → seq2seq → attention）+ 三篇论文定位（继承谁 / 挑战谁 / 可能引领什么）+ 里程碑/范式转移标注 + 「空白区」待后续论文累积（手动可编辑）
- `host/tools.js`（扩展）：新工具 `read_field_map({root?})` —— 只读返回 `field-map.md` 内容 + 元信息（路径/存在/字符数）；不存在时 `ok:false` + 提示「可在收尾提议初建」；lossless
- 技能更新：
  - `skills/global-read.md` 步骤 3：领域定位改为「先 `read_field_map`（存在则注入；不存在则基于常识定位并在收尾提议初建）」+ 记录该论文定位增量（候选增补点）
  - `skills/propose.md` 输入：需要领域分量判断时 `read_field_map` 按需注入（不常驻，设计 §7）
  - `skills/reflect.md`（论文级，与 Phase 3 一并）：收尾时「领域地图增补点」小节

**验证**
- `test/run-tools.js`（扩展）：`read_field_map` —— 存在（内容+元信息）/ 不存在（ok:false + 提示）/ root 解析 / lossless
- `field-map.md` 落盘内容人工评审（设计 §7 一致性：按需注入、不常驻）
- 本地回归全绿

#### ✅ Phase 2 完成记录（2026-08-27，验证通过）

**交付**（git 工作区已落盘）
- **`D:\aa\field-map.md`**（新，workspace 根，git 跟踪，D4）：领域发展线骨架 —— ① 领域主线（word2vec 2013 → seq2seq 2014 → attention 2015–2016 → 空白区 Transformer/预训练/LLM）；② 三篇已收录论文定位（每篇：贡献/继承/引领/范式地位/检索标记）；③ 里程碑与范式转移表（含「判断语句分量」的用法说明：首次提出/规模化范式节点按 red，复述按常规密度）；④ 空白区 + 增补约定（append-only，标注来源与日期）
- `host/tools.js`（扩展）：新工具 **`read_field_map({root?})`**（D4，只读注入）—— 返回 `{ok, exists, path, chars, content}`；不存在时 `ok:false` + 提示「propose creating it at paper-level wrap-up (design §7)」；工具数 **9 → 10**
- `skills/global-read.md`（更新）：输入新增 5「领域地图（read_field_map）」；步骤 3 领域定位改为走 `read_field_map` —— 存在则注入领域发展线并判断继承/挑战/引领与范式节点，不存在则基于常识定位并在论文级反思收尾提议初建/增补
- `skills/propose.md`（更新）：输入新增 5「领域地图（按需）」—— 仅范式转移节点/领域分量判断时注入，不常驻 system prompt

**验证结果（2026-08-27）**
- `test/run-tools.js`（扩展）：read_field_map —— 存在（content+chars+path 解析到指定 root）/ 不存在（ok:false + create-hint）/ lossless → PASS
- 本地回归全绿：run-mock / run-tools / run-actions / run-plugin / run-render / run-profile / run-export → 全部 PASS；check-host / check-utf8 → PASS
- 真实数据离线冒烟：`read_field_map`（root=D:/aa）→ ok:true / exists:true / 2367 chars，内容正确；root=D:/aa/data（无文件）→ ok:false + 正确提示
- `field-map.md` 内容人工评审（设计 §7 一致性）：领域发展线 + 三篇定位（继承谁/挑战谁/引领什么）+ 里程碑/范式转移标注 + 空白区，按需注入不常驻 —— 通过
- ⚠️ `read_field_map` 为 host 侧新增工具，**live 3081 待用户重启后生效**（技能变更经 .agents/skills junction 动态发现，无需重启；工具行需重启加载）

**本轮未做（属后续 Phase）**：Phase 3 论文级反思（含 reflect.md 的「领域地图增补点」小节，与 Phase 3 一并）；Phase 4 UX 打磨；Phase 5 step8 端到端 + 归档 v0.4.0

### Phase 3 — 论文级反思 + 收尾总结（~1.5 天）

**目标**：论文审查完的「收尾」动作 —— 整篇汇总 + 偏好沉淀 + 领域地图增补点。

**交付**
- `host/reflection.js`（新，纯逻辑）：`paperReflectionTemplate({paper, highlights, diff, profileSummary})` → 结构化模板（论文概述 / 章节审查统计表 / 沉淀偏好 / 领域地图增补点 / 未来工作方向 / 导出状态）—— diff 来自整篇 `summarizeDiff`（无 section）
- `skills/reflect.md`（扩展）：新增「论文级反思」步骤 —— 触发（全部可审查节 `reviewed` 或用户说「论文完毕」）→ 整篇 `summarize_section_diff`（无 section 参数）→ 调 `paperReflectionTemplate` 填充自然语言 → 落盘 **`data/<paper_id>/paper-reflection.md`** → 呈报；偏好仍走 `profile_proposal`（需用户确认，Agent 不直接写规则）；领域地图增补点 → 并入文档/提案
- （可选）第 4 篇论文（若需补充验证样本，经真实 MinerU 解析落盘）

**验证**
- `test/run-export.js`（扩展，或新 `run-reflect-paper.js`）：`paperReflectionTemplate` 矩阵 —— 空 diff / 全接受 / 含 rejected+recolored / 无画像回退 / lossless
- step8 端到端覆盖「论文级反思产物存在 + 结构断言」（Phase 5）
- 实跑一篇（`p-bahdanau-2016-attention` 或第 4 篇）留盘样例

#### ✅ Phase 3 完成记录（2026-08-27，验证通过）

**交付**（git 工作区已落盘）
- `host/reflection.js`（新，纯逻辑可单测）：`paperReflectionTemplate({paper, highlights, diff?, profileSummary?, sections?, now?})` → 结构化论文级反思 markdown（D5）—— ①论文概述（plan.summary + Agent 补充位）②审查进度表（已审查/总数 + 逐节 span 计数，sections 提供时经 anchor_ids 统计，否则 plan-only 表）③整篇差异汇总（summarizeDiff 无 section 的计数/认可率/改色·删除·新增样例）④沉淀偏好（画像现状 L1–L4 + 推断信号占位）⑤领域地图增补点占位 ⑥未来工作方向占位 ⑦导出状态（导出候选数 + export_paper 路径）；含 `fmtCount`/`sampleLines`/`sectionTable`/`paperReflectionFile`/`writePaperReflection` 辅助
- `host/tools.js`（扩展）：新工具 **`reflect_paper({paper_id, output?('inline'|'file'), root?})`** —— 读 highlights + L1 画像 + 整篇 `summarizeDiff` + buildSections，渲染脚手架；inline 返回 content + stats，file 写盘 `data/<paper_id>/paper-reflection.md`；**工具数 10 → 11**（D7 已标注：D5「Agent 调 paperReflectionTemplate」需 host 工具落地，Phase 3 实施决定追加）
- `skills/reflect.md`（扩展）：新增「论文级反思（收尾）」章节 —— 触发（全部可审查节 reviewed 或用户说「论文完毕」）→ 整篇 `summarize_section_diff`（无 section）→ `reflect_paper` 生成脚手架 → 填充自然语言落盘 `paper-reflection.md` → 呈报；偏好仍走 `profile_proposal`（需确认），领域地图增补走文件工具（append-only）
- `test/run-reflect-paper.js`（新）：矩阵 —— 空/冷启动（零计数 + 无画像行 + lossless）、全接受（diff 计数/认可率 1/无样例）、混合 diff（rejected+recolored+added 样例行渲染）、profileSummary 沉淀偏好行、sections 逐节 span 计数表、fmtCount 零填充、paperReflectionFile 路径
- **实跑留盘样例**：`data/p-bahdanau-2016-attention/paper-reflection.md`（`reflect_paper output:'file'` 真实数据生成脚手架 + Agent 填充自然语言）—— 6/6 全接受、认可率 1.0、33 节进度表、领域地图增补点（注意力范式节点已收录、建议标注 ICLR 2015 会议版）、未来工作（expected annotation / RNNsearch-50 / OOV）

**验证结果（2026-08-27）**
- `run-reflect-paper.js` → PASS；`run-tools.js`（扩展）reflect_paper —— inline 形状 + 整篇 diff stats（6/5/1）+ 逐节表 + 画像行 + lossless、file 写盘回读、未知 paper ok:false → PASS
- 本地回归全绿：run-mock / run-tools / run-actions / run-plugin / run-render / run-profile / run-export / **run-reflect-paper（新）** → 全部 PASS；check-host / check-utf8 → PASS
- ⚠️ `reflect_paper` 为 host 侧新增工具，**live 3081 待用户重启后生效**（技能变更已动态生效）

**本轮未做（属后续 Phase）**：Phase 4 UX 打磨（keyAction 快捷键/导出入口/会话恢复进度条）；Phase 5 step8 端到端 + 文档收尾 + 归档 v0.4.0

### Phase 4 — UX 打磨（快捷键 + 导出入口 + 会话恢复，~2 天）

**目标**：GUI 审查/导出体验闭环 —— 键盘操作、一键导出、断点续读。

**交付**
- `client/render-body.js`（扩展，全部纯函数可单测）：
  - `keyAction(event, state, opts)`：快捷键映射表（**1-5 改色 / a 接受 / d 删除 / r 改范围 / n 新增 / Esc 取消 / Ctrl+Enter 标记节完毕 / e 打开导出对话框**）—— 仅在论文视图 + 非输入态（非 input/textarea 焦点）生效；返回待执行的 action 或 null
  - 工具栏「导出」按钮 + 导出对话框（格式 HTML/MD 单选、包含未决 checkbox、下载按钮）→ `GET /paper-hl/export?paperId=<id>&format=<…>&include_pending=<…>&download=1`（新标签/下载）
  - 会话恢复：mount 时按 `plan.sections[].status` 渲染「审查进度条」（已审查节数/可审查节总数）+「继续上次」→ 定位第一个未审查节；刷新/重开不丢状态（JSON 全量续读 v0.2 已具备，补进度视图与导航）
  - 图例补 hover 说明（沿用 `colorLegend` 驱动）
- `scripts/gen-client.js`（扩展）：导出 `keyAction` 等新纯函数；`client/client.js` / `dynamic/client-half.js` 重新生成

**验证**
- `test/run-render.js`（扩展）：`keyAction` 矩阵（各键位 → 动作/空操作/论文视图外忽略/输入态忽略）、进度模型（部分 reviewed → 进度分数 + 下一未审查节 id；无 plan 时全 0 兜底）
- `scripts/simulate-render.js`（扩展）：P4 交互注入 —— 快捷键触发（如 `d` → 删除 POST 载荷断言）、导出对话框打开 → 下载 URL 断言（paperId/format/include_pending/download=1）、进度条渲染断言
- 本地回归全绿；浏览器人工走查清单（快捷键逐键操作、导出下载后浏览器打开、刷新后进度保留）

#### ✅ Phase 4 完成记录（待实施后填写，格式沿用 v0.3）

### Phase 5 — step8 端到端 + 文档收尾 + 归档 v0.4.0（~1.5 天）

**目标**：验收证据 + 文档/归档。

**交付**
- `scripts/step8-export-e2e.js`（新）：对真实论文（`p-bahdanau-2016-attention`，或第 4 篇）跑全流程 —— `read` → `export_paper`（html + md）→ 产物校验（文件存在、`<mark>` 数 = 导出 spans 数、图例条目 = colors 键数、HTML 无外部资源引用、MD 可读）→ 论文级反思产物存在 + 结构断言 → **判定 PASS**；运行前备份、失败自动恢复
- 文档：设计文档 §8 v0.4 标注完成 + 验收记录 + §10 风险 #6 更新；README 布局补 `host/export.js` / `host/reflection.js` / `field-map.md` / 新工具 / `step8-export-e2e.js`；本进度文件各 Phase 完成记录 + §8 终态 + §9 清单勾选；one-pager 更新 v0.4 状态
- **git 归档 `v0.4.0`**

**验收核对**
- ① 端到端稳定：`step8-export-e2e.js` PASS（完整流程无人工介入产出 html+md 交付物）
- ② 导出 HTML 浏览器/笔记软件打开正常、图例完整：人工走查（浏览器打开导出 HTML 目视高亮颜色 + 图例与 colors.yml 五色一致；VS Code/笔记软件预览 MD 正常）

#### ✅ Phase 5 完成记录（待实施后填写，格式沿用 v0.3）

## 7. 风险与对策

| 风险 | 对策 | 验证点 |
|---|---|---|
| 导出渲染与 GUI 不一致 | 同源 anchors 阅读序重建 + 颜色解析复用 profile L1；HTML 自包含无外部依赖 | run-export 矩阵 + step8 产物校验 |
| MD 中注入 `<mark>` 破坏 Markdown 语法/查看器兼容 | 段落级重建（锚点文本）不在原始 MD 语法上注入；顶部图例区；兼容主流查看器 | run-export MD 断言 + 人工打开走查 |
| 会话恢复进度来源不稳（plan.status 由 host 写） | 依赖既有 reviewed 状态（v0.2/v0.3 已稳定）；进度纯函数容错（无 plan 全 0） | run-render 进度矩阵 + 人工刷新走查 |
| 领域地图注入时机/大小失控 | `read_field_map` 只读 + 按需注入 + 不常驻 system prompt（设计 §7）；用户可手工编辑 | 技能评审 + 实跑 |
| 快捷键误触 | 仅论文视图 + 非输入态生效；`keyAction` 单测 + 浏览器走查 | run-render + simulate-render |
| host 变更重启纪律 | 沿用环境纪律（§3.4 第 8 条）：host 变更由用户手动重启 3081，Agent 只读验证 | 各 Phase 冒烟记录 |
| 论文级反思整篇汇总 token 过大（长论文） | 只汇总 structured diff（计数+样例，`summarize_section_diff` 输出本身紧凑）；模板填充受限 | step8 实际执行记录 |

## 8. 当前状态 / 待办

- **状态**：**v0.4 Phase 0–3 已完成（归档 `v0.3.1` / `v0.3.2` / `v0.3.3`）**——导出核心纯逻辑 + host 路由 + `export_paper` + `field-map.md` + `read_field_map` + 论文级反思（`reflect_paper` + `paper-reflection.md` 样例）；Phase 4–5 待实施。v0.3 全部完成（归档 `v0.3.0`）。
- **待办（v0.4）**：Phase 4 UX 打磨（快捷键 `keyAction` / 导出入口 / 会话恢复进度条）→ Phase 5 step8 端到端 + 文档收尾 + 归档 `v0.4.0`。Phase 0–3 已完成实现并验证（见 §6 完成记录）。
- ⚠️ 数据状态（v0.3 验收留盘）：**三篇论文** —— `p-mikolov…`（v0.2 数据，reflections 提案未确认，可作 GUI 演示）、`p-sutskever-2014-seq2seq`（9 spans + 3 节 reviewed + 已确认）、`p-bahdanau-2016-attention`（6 spans + 3 节 reviewed + 已确认）；`highlight-profile/` **9 规则 + 13 示例 + stats 2 篇**（overall 认可率 80% / 修改率 20%）；**`field-map.md` 待 v0.4 初建**。
- ⚠️ 环境纪律：**3081 = 会话 Web，Agent 不得自行 kill/restart**；host 代码变更后需用户手动重启。

## 9. v0.4 交付物清单（规划，随实施更新）

| 路径（规划） | 内容 | 状态 |
|---|---|---|
| `docs/paper-highlight-progress-v0.4.md` | 本进度文件 | ✅ 已建（Phase 0–1 完成记录已写入，Phase 2–5 待填） |
| `D:\aa\field-map.md` | 领域发展线（NLP 2013–2016 主线 + 三篇论文定位 + 里程碑/范式转移 + 空白区，D4） | ✅ 已落盘（Phase 2） |
| `packages/paper-highlight/host/export.js` | 导出纯逻辑：`buildExportSpans` / `renderHtml` / `renderMarkdown` / `legendHtml` / `legendMd`（D2/D3） | ✅ 已实现（Phase 0） |
| `packages/paper-highlight/host/reflection.js` | 论文级反思模板：`paperReflectionTemplate`（D5） | ✅ 已实现（Phase 3） |
| `packages/paper-highlight/host/plugin.js`（扩展） | `GET /paper-hl/export?paperId=&format=&include_pending=&download=`（D7） | ✅ 已实现（Phase 1） |
| `packages/paper-highlight/host/tools.js`（扩展） | `export_paper`（Phase 1 ✅）+ `read_field_map`（Phase 2 ✅）+ `reflect_paper`（Phase 3 ✅）工具（工具数 8 → 11，D7） | ✅ 已实现（Phase 1/2/3） |
| `packages/paper-highlight/skills/global-read.md`（更新） | 领域定位改走 `read_field_map` + 定位增量记录（D4） | ✅ 已实现（Phase 2） |
| `packages/paper-highlight/skills/propose.md`（更新） | `read_field_map` 按需注入（D4） | ✅ 已实现（Phase 2） |
| `packages/paper-highlight/skills/reflect.md`（更新） | 论文级反思步骤 + `paper-reflection.md` 落盘（D5） | ✅ 已实现（Phase 3） |
| `packages/paper-highlight/client/render-body.js`（扩展） | `keyAction` + 导出对话框 + 审查进度条/继续上次（D6） | 待实施（Phase 4） |
| `packages/paper-highlight/scripts/gen-client.js`（扩展） | 导出 `keyAction` 等新纯函数；bundle 重新生成 | 待实施（Phase 4） |
| `packages/paper-highlight/scripts/step8-export-e2e.js` | 导出端到端验收驱动（html+md 产物校验 + 论文级反思断言） | 待实施（Phase 5） |
| `packages/paper-highlight/scripts/verify-http.js`（扩展） | `/paper-hl/export` live 探针 | ✅ 已实现（Phase 1） |
| `packages/paper-highlight/test/run-export.js` | 导出层单测（渲染矩阵 + 自包含断言 + 模板矩阵） | ✅ 已实现（Phase 0） |
| `packages/paper-highlight/test/run-reflect-paper.js` | 论文级反思模板单测（空/全接受/混合 diff/画像行/逐节表） | ✅ 已实现（Phase 3） |
| `packages/paper-highlight/test/{run-tools,run-plugin}.js`（扩展） | `export_paper` 工具 + `/export` 路由断言（Phase 1 ✅）；`read_field_map` 断言（Phase 2 ✅）；快捷键/进度断言（Phase 4 待做） | 部分（Phase 1+2 ✅ / Phase 4 待做） |
| `packages/paper-highlight/scripts/simulate-render.js`（扩展） | P4 快捷键/导出对话框/进度条交互注入 | 待实施（Phase 4） |
| 文档：设计文档 §8/§10 + README + one-pager | v0.4 完成标注 + 布局/状态更新 | 待实施（Phase 5） |

## 10. 里程碑检查点

| 检查点 | 触发条件 | 判定 |
|---|---|---|
| M0 | Phase 0 完成 | ✅ 新增 `run-export.js` 全绿 + 本地回归全绿（run-mock/tools/actions/plugin/render/profile/export 全过）+ 真实数据离线冒烟 PASS |
| M1 | Phase 1 完成 | ✅ `/paper-hl/export` 路由矩阵 + `export_paper` 工具断言 + verify-http PASS + **live 3081 冒烟 PASS**（用户已重启：200 text/html + md + download 附件头 + 负例 400/404） |
| M2 | Phase 2 完成 | ✅ `field-map.md` 落盘（领域主线+三篇定位+里程碑/范式转移+空白区）+ `read_field_map` 工具（存在/缺失提示/root 解析）+ 技能注入（global-read/propose）+ 本地全绿 + 真实数据离线冒烟 PASS（live 工具行待用户重启 3081） |
| M3 | Phase 3 完成 | ✅ `paperReflectionTemplate` 矩阵 PASS（run-reflect-paper）+ `reflect_paper` 工具断言 + **实跑一篇留盘样例**（`p-bahdanau` paper-reflection.md，6/6 全接受） |
| M4 | Phase 4 完成 | `keyAction`/进度矩阵 + simulate-render P4 交互 PASS；浏览器走查待用户 |
| M5 | Phase 5 完成（**v0.4 验收**） | `step8-export-e2e.js` PASS（端到端稳定）+ 导出 HTML 浏览器/笔记软件打开正常、图例完整（人工）+ 文档更新 + 归档 `v0.4.0` |
