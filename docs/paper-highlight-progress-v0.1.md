# Paper Highlight Agent — v0.1 项目进度（已归档）

> 🗄️ **归档说明（2026-08-26 21:45）**：本文件为 v0.1 阶段（管线打通）的完成进度存档，v0.1 已交付验收通过。后续进展请以 **`paper-highlight-progress-v0.2.md`**（审查闭环）为准；本档案仅用于回溯 v0.1 的交付记录、校准结论与遗留事项。

# Paper Highlight Agent — 项目进度快照（可迁移）

> 生成方式：仅依据会话上下文汇总，未做环境核查。用于跨上下文/跨机器转移时恢复项目状态。
> 版本：v0.1（管线打通）✅ **已交付（2026-08-26 验收通过）** · 最近更新：Step 5 收尾完成——v0.1 两条验收标准全过（含浏览器目视确认：正文 + 5 处五色高亮 + 悬浮 rationale）

---

## 1. 项目与目标

- 设计文档：`D:\aa\docs\paper-highlight-agent-design.md`（§8 定义 v0.1 范围）
- v0.1 目标：**管线打通** —— PDF → MinerU 云 API → `data/<paper_id>/` 归一化产物 → Agent 工具读写高亮 JSON → GUI 渲染正文 + 显示 spans
- v0.1 验收标准（设计文档 §8）：
  1. 输入真实会议论文 PDF → paper profile 的 GUI 渲染出正文 Markdown
  2. Agent 可通过工具读写 `paper.highlights.json`，GUI 能显示已写入的 spans
- 运行环境：Windows；harness（dsh web，port 3080，profile `web`）；paper profile 计划独立跑 port **3081**

## 2. 关键决策（已定）

- 数据落盘：`D:\aa\data\<paper_id>/{paper.md, anchors.json, meta.json, paper.highlights.json}`
- 锚点模型：anchor_id = `a-<page:04d>-<block:02d>-<par:02d>`（1 起始、零填充）；span 的 `char_start/char_end` 为 0 起始、半开区间，指向 `anchor.text`；`md_offset` 保证锚点文本在 `paper.md` 中按字符精确定位（标题块偏移在 `# `/`## ` 前缀之后）
- 正文过滤（v0.1 简化）：保留 block 类型 text/title/content；跳过 image/table/formula/caption/unknown；页眉页脚按 bbox 边距启发式（top/bottom < 5% 页高）；一个 block = 一个段落 = 一个锚点
- 工具行（parse_pdf/read_highlights/write_highlights）放在 **paper agent preset**；client UI 行放在 **profile 组合**（bundle patch 或 profile 的 cordis.patch.yml）
- host 网络：不用 `ctx.web.fetch`（无 fetch provider），直接用 Node `https`（已验证可行；curl/PS 的 HTTPS 因 schannel 凭据层故障不可用，Node OpenSSL 通道正常）
- MinerU 配置走环境变量：`MINERU_API`（或 `MinerU_API`）、`MINERU_BASE_URL`（默认 `https://mineru.net`）、`MINERU_UPLOAD_MODE=file|url`、`MINERU_OCR=1`、`MINERU_FORMULA=1`、`MINERU_LANGUAGE`
- 【校准 2026-08-26 真实冒烟】MinerU 网关拒绝**无 Content-Length** 的请求（chunked 传输报 `-10002 type mismatch for field "files"`）；`host/mineru.js request()` 已对带 body 的请求显式设置 Content-Length（同时满足 OSS 预签名 PUT 的要求）
- 【校准】zip 内中间结构是 **`layout.json`**（无 middle.json，已加入首选列表）：`pdf_info[i].para_blocks`（段落合并视图，首选）/ `preproc_blocks`（原始布局视图，兜底）；span 文本在 `spans[].content`；实测块类型：`title`/`text` 保留，`ref_text`（参考文献）/`table`/`image`/`interline_equation` 跳过；页眉页脚/页码等由 MinerU 归入 `discarded_blocks`（`aside_text`/`page_number`/`page_footnote`），不参与遍历（SKIP_TYPES 已补充）
- 【校准】MinerU `para_blocks` **原始数组序即权威阅读序**（列感知）：对双栏作者块，按 bbox y 排序会错排列内顺序（Tomas→Kai→Greg→Jeffrey）；已移除 y 排序改用原始块序，anchor_id 的 block 分量 = MinerU 原始块索引，阅读序契约由真实数据测试守护
- 【校准 2026-08-26 Step 4】dsh-tools 的工具**输出必须是 lossless JSON**：返回值含 `undefined` / `NaN` / `Infinity` / `BigInt` / 循环引用都会在输出边界报 `ToolOutputError INVALID_TOOL_OUTPUT`（"value is not lossless JSON"）。parse_pdf 曾因 `task_id: result.taskId`（pipeline 实际返回 `batchId`，该键为 undefined）触发——工具落盘成功但模型看到错误、被迫重试；已改 `host/tools.js` 为 `task_id: result.batchId ?? null`，并在 `test/run-tools.js` 加 lossless 回归断言（含 JSON 往返稳定）
- 【校准 2026-08-26 Step 4】dsh web 浏览器传输 = HTTP JSON-RPC：`POST /api/<method>`，信封 `{type:'client-request', rpcId, method, payload}`（`dsh-client-connection`/`dsh-host-apiproxy`）；事件流走 WebSocket `/api/events.mux`（验收驱动只用 unary 轮询，未用事件流）。`session.create` 不带 `agentPreset` 时取 profile 的 `agent-presets default`（paper 组合已生效，返回 `agentPreset:"paper"`）；`session.prompt` 用 `mode:'queue'` 异步受理，轮询 `session.list` 的 `running` 判定回合结束
- 【校准 2026-08-26 重启事故】`dsh --profile paper` 的**启动目录不可靠**：用户重启 3081（新进程 cwd = `C:\Users\eyx`）后 `/paper-hl/read` 报 500 `ENOENT scandir 'C:\Users\eyx\data'`——host 插件数据根目录此前仅取 `process.cwd()`。修复：①立即恢复（无需重启）：建 junction `C:\Users\eyx\data → D:\aa\data`，运行中进程立即可用；②持久修复：`host/plugin.js` 根目录解析改为 **组合 config `root` → `PAPER_HL_ROOT` → `process.cwd()`（兜底）**，paper profile 的 `cordis.patch.yml` 钉 `root: 'D:\aa'`（与 `agent-presets default: paper` 同款跨层 config 覆盖）；新增 `test/run-plugin.js` 回归（config.root 与 cwd 无关、未知 paperId 回退、缺失根目录 500 JSON）。⚠️ junction 在下次重启后可删除（持久修复后不再依赖）；重启后 parse_pdf 的 lossless 修复亦随新进程生效

## 3. 已完成

### Step 0 — 契约锁定 ✅
- DSH Inspect：`harness.registerTool/defineTool/handle`；Host `fs`/`web` 服务；Client `Slots.listSubTree` → **`conversation.view`**（会话视图环，list 槽，`only:<active id>` 切换）定为论文渲染宿主，`shell.overlay` 为备选；`tool.view.cordis`（key: self）可用于动态插件 Run 卡验证
- MinerU v4 流程（已按真实冒烟校准，见 §2）：`POST /api/v4/file-urls/batch`（`{files:[{name,data_id?}], model_version, language, enable_formula, enable_table}`，须带 Content-Length）→ 预签名 PUT 上传原始字节（无 Content-Type）→ 系统自动提交任务 → `GET /api/v4/extract-results/batch/{batch_id}` 轮询至 `done` → 下载 `full_zip_url`。原「file/urls + base64 + 显式建任务」假设作废
- 参考：https://mineru.net/apiManage/docs · https://github.com/Nebutra/MinerU-Skill/blob/main/references/api_reference.md · https://github.com/HKUDS/LightRAG/blob/2a729d37/lightrag/parser/external/mineru/client.py

### Step 1 — 数据模型 + MinerU 逻辑 + 离线验证 ✅（mock 全绿）
- 代码：`D:\aa\packages\paper-highlight\`
  - `host/schema.js`：anchors/highlights 模型与校验（`validateAnchors` / `validateHighlights` / `newHighlightsSkeleton`）
  - `host/store.js`：`data/<paper_id>` 原子读写（写入即校验）
  - `host/mineru.js`：API 客户端（`parsePdf` 上传→任务→轮询→下载；`resolveMineruConfig` 读 env）
  - `host/normalize.js`：zip → `paper.md` + `anchors.json` + `meta.json`（含跳过统计）
  - `host/pipeline.js`：`processPdf({pdfPath, root, paperId?, title?, mineruConfig?})`；`paperIdFromPdfPath`
  - `package.json`（name `paper-highlight`，`dsh.bundle.patch: ./cordis.patch.yml`，`dsh.client` 声明），`README.md`，`cordis.patch.yml`（当前 `- insert: []` 占位）
- 测试：`test/run-mock.js` → **PASS**（4 锚点精确匹配、paper.md 逐字符匹配、image/table/formula/header_footer 跳过统计正确、md_offset 完整性全过、highlights 往返、越界 span 拒绝）；`test/run-real.js` 就绪（需 key）；`test/verify.js` 共享断言
- 真实 PDF 的 paperId：`p-mikolov-2013-2013-1-word2vec`（`D:\aa\Mikolov 等 - 2013 - 2013.1 Word2Vec.pdf`，0.22MB）

### Step 2 — Agent 工具 + paper preset ✅（真实冒烟已通过）
- `host/tools.js`：三个 ToolDefinition（`parse_pdf` / `read_highlights` / `write_highlights`；默认 root = `process.cwd()`；output.schema 与 object 参数需显式 `additionalProperties`）
- `host/tools-plugin.mjs`：ESM 包装，`name='paper-highlight-tools'`，`inject=['tools']`，`ctx.tools.register(defineTool(def))`（durable 工具标准形态，同 dsh-tool-fs）
- `test/run-tools.js` → **PASS**（defineTool 转换、read/write 往返、非法 span 拒绝）
- 安装：junction `C:\Users\eyx\.dsh\profiles\node_modules\paper-highlight` → `D:\aa\packages\paper-highlight`（用户批准了 danger-full-access 升级）；本地 `npm install --cache D:\aa\.npm-cache` 装好 `@deepseek-ai/dsh-tools@0.1.1-rc.2` + `fflate`（18 包），插件模块经 junction 路径加载验证通过
- preset：`agentPresets.copy('standard','paper','Paper Highlight Agent')` → `C:\Users\eyx\.dsh\.agent-presets\paper\`（trust: user）；`preset.yml` 已改描述；`agent.cordis.yml` 末尾追加行：
  ```yaml
  - id: paper-highlight-tools
    name: 'paper-highlight/tools-plugin'
  ```
- **`standingKeyFor('paper')` → mounted OK**（组合真实挂载、所有行激活）
- 探针动态插件 `pset-1`（copy/list/standingKeyFor 工具）已创建并停止（动态插件进程级，重启后失效）

### Step 2 真实冒烟（2026-08-26）✅ PASS

- 前置：用户 `setx MinerU_API "<key>"` 并重启 harness → `$env:MinerU_API` 可见（len=51）
- 命令：`node D:\aa\packages\paper-highlight\test\run-real.js` → 上传（`POST /api/v4/file-urls/batch`）→ 轮询（`waiting-file`→`done`，elapsed 4.8s）→ 下载 zip → 归一化 → 断言 → 高亮往返 → 干净骨架落盘
- 结果：80 锚点 / 11 页 / 28,656 字符；`md_offset` 完整性全过；2 spans 读写往返一致；最终 `paper.highlights.json` 为干净骨架（无测试残留）
- 产物目录：`D:\aa\data\p-mikolov-2013-2013-1-word2vec/`（paper.md / anchors.json / meta.json / paper.highlights.json）；meta 记录 `middle_json: layout.json`、跳过统计 `ref_text 32 / table 8 / interline_equation 5 / image 1 / empty 5`
- 期间修复两处（见 §2 校准条目）：`host/mineru.js request()` 补 Content-Length；`host/normalize.js` 认 `layout.json`/`para_blocks` + 移除 y 排序 + SKIP_TYPES 扩充
- 回归：`run-mock.js` / `run-tools.js` 修复后仍全 PASS；成功批次 zip 保留于 `.mineru-work/8e04c2b7-…/` 供离线迭代（避免重复消耗 API 额度）
- 已知 cosmetic：paper.md 末尾留空 `## References` 标题（ref_text 内容被跳过），v0.2 渲染端可忽略空节

## 4. 当前阻塞 / 待办

### ✅ 已解除：MinerU_API 环境变量
- 用户 `setx MinerU_API` + 重启 harness 后 `$env:MinerU_API` 可见（len=51）；真实冒烟已通过（见 §3 Step 2 真实冒烟）

### Step 3 — Client 渲染 + 高亮层 ✅（durable bundle + 3081 服务就绪，GUI 验收待人工确认）

**DSH client 插件机制调研结论（本次会话实测确认）**
- bundle 格式：`window.__ModuleLoader__.load({id, factory})`，factory 内 `require("react")` 等，导出 `{apply(ctx), inject}`；CSS 用 `document.querySelector("style[data-plugin-css=…]")` 注入（参照 dsh-client-ui-layout/lib/client.js）
- 目标槽位：`conversation.view`（list 槽 / session 作用域，`conversation.session` 槽声明）——注册 `{name:'conversation.view', id, order, label, inject}` + React 组件即新增一个会话视图 tab（`tabs.length>1` 时头部渲染 tab 条，参照 ui-trajectory 的注册与 ui-conversation 的 viewTabs）
- 标准 props：`sessionId/useSession/useProjection/…`（本视图未用，数据走自建通路）
- 数据通路（Step 3 落地）：**durable host 插件注册 webserver 路由** `GET /paper-hl/read[?paperId=]` → `{ok, paperId, paperMd, anchors, highlights, papers}`；client bundle 用 `fetch('/paper-hl/read')`（同源，无需 CORS/RPC）。动态双半插件的 `harness.handle ↔ host.call` 通路亦已调研确认（本会话无 cordis 工具，未走 Run 卡路线）

**交付物**
- `client/render-body.js`：渲染逻辑单一来源（React.createElement 纯 JS，无 JSX；锚点序渲染 paper.md 段落 + `<mark>` 高亮区间 + 图例/选择器/刷新；闭包契约 `React/callData/styles`）
- `scripts/gen-client.js` → 产出 `client/client.js`（durable bundle，`callData=fetch('/paper-hl/read')`）与 `dynamic/client-half.js`（动态浏览器半，`callData=host.call('paper.read')`，备用）
- `host/plugin.js`：durable host 插件（`inject:['webServer']`，注册 `/paper-hl` 前缀路由，复用 `host/store.js`，零外部依赖；`PAPER_HL_ROOT` 可覆盖根目录）
- `cordis.patch.yml`：bundle patch 插入 `- id: paper-highlight, name: 'paper-highlight'`（一行覆盖 host 插件 + client roster）
- `scripts/verify-http.js`（三条通路自检）、`scripts/seed-demo.js`（种子 spans，幂等）、`scripts/check-host.js`/`check-utf8.js`（双半体校验）

**paper profile（Step 4 脚手架提前）**
- `C:\Users\eyx\.dsh\profiles\paper\`：package.json（bundles = dsh-base + dsh-web-app + paper-highlight）、cordis.yml、cordis.patch.yml（`agent-presets default: paper`）、pnpm-workspace.yaml（同 web 模板；依赖走 profiles/node_modules junction 树，无需安装）
- 启动：`dsh --profile paper --port 3081 --no-open`（web 是子命令别名，`--profile` 挂根级；prepareProfile 会重写 profile/cordis.yml → 启动需 danger-full-access）
- `--dump-config` 验证：`default: paper` + `# == paper-highlight` 行正确组合

**验证结果（2026-08-26）**
- `GET http://127.0.0.1:3081/` → 200（含 `__DSH_BOOT__`）
- `GET /plugins/paper-highlight/client.js` → 200（ModuleLoader 格式、id 正确、`fetch('/paper-hl/read')` 就位）
- `GET /paper-hl/read` → `{ok:true, paperId:'p-mikolov-2013-2013-1-word2vec', paperMd 28880 字符, anchors 80, highlights spans 9}`；按 paperId 查询亦通
- `scripts/seed-demo.js` → 9 spans / 7 锚点 / 5 色全（红3 黄2 蓝1 绿2 紫1，status=proposed，decisions 带 proposed 记录）
- 回归：run-mock / run-tools 仍 PASS
- **无浏览器强验证（新增）**：
  - 已服务 `index.html` 的 `window.__DSH_BOOT__` 含 `{"id":"paper-highlight","url":"/plugins/paper-highlight/client.js?rev=…","inject":["@deepseek-ai/dsh-client-runtime"]}` → 浏览器启动即加载插件
  - `scripts/simulate-render.js`：React/DOM shim 在 Node 中执行**已发布 bundle**，经真实 3081 数据通路（`fetch('/paper-hl/read')`，相对路径解析同浏览器）渲染并断言全过：loading→ready 状态迁移、恰一个 h1（论文标题）、58 段、9 个 span mark（图例 mark 除外）且颜色分布 = 种子分布（红3/黄2/蓝1/绿2/紫1）、rationale tooltip、论文选择器、刷新按钮、图例语义齐全
- 待人工确认：浏览器打开 3081 → 会话视图 tab 条出现「论文」→ 渲染正文 + 高亮色块（headless 证据已齐，仅剩视觉确认）

**GUI 验收路径（用户操作）**：打开 `http://127.0.0.1:3081` → 打开/新建会话（新建默认 paper preset，含三个工具）→ 会话头部 tab 条点击「论文」→ 见论文标题、段落、图例与高亮色块（当前数据 = Step 4 Agent 写入的 5 spans，五色各 1）；改 `paper.highlights.json` 后点「刷新」即时更新

### ✅ Step 4 — paper profile 端到端（2026-08-26 真实验收通过）

**驱动方式（无浏览器自动化）**
- 调研确认 dsh web 的 HTTP JSON-RPC 传输（见 §2 校准条目）：`POST /api/session.create` / `session.prompt` / `session.list` / `session.history`
- 新增交付物 `packages/paper-highlight/scripts/step4-e2e.js`：`session.create`（不带 agentPreset）→ 断言默认 preset=paper → `session.prompt` 下达 v0.1 验收任务 → 轮询至回合空闲 → `session.history` 汇总工具链 → `GET /paper-hl/read` 报告 GUI 数据通路 → 退出码判定（PASS/INCOMPLETE）

**真实结果（全绿）**
- `session.create` 返回 `agentPreset:"paper"`（profile 默认 preset 生效）✓
- Agent 工具链：parse_pdf（真实 MinerU，task `228f9749-bd4e-4587-b258-dd552002af2e`；前两次调用返回值序列化报错见下方修复）→ read_highlights（空骨架）→ write_highlights（5 spans）→ read_highlights（逐项核对一致）；回合 149s
- 归一化：11 页 / 80 锚点 / 28,656 字符；meta 记录 `middle_json: layout.json`、跳过统计 `ref_text 32 / table 8 / interline_equation 5 / image 1 / empty 5`
- Agent 写入 5 spans（s-001…s-005，五色各 1）：red=Abstract 核心贡献（低成本高质量词向量）、yellow=1.1 目标定义、blue=Introduction 局限瓶颈、green=King-Man+Woman≈Queen 向量类比启发、purple=Conclusion 知识库事实扩展待深挖；`status:"proposed"`、`decisions` 带 proposed 记录、char 区间精确落在锚点文本内（[324,499)/[0,200)/[400,563)/[250,389)/[0,184)）；**read_highlights 回读逐项一致** ✓
- GUI 数据通路：`GET /paper-hl/read` → 5 spans；`simulate-render.js` 改为**数据驱动**（原硬编码 9 个种子 mark）→ 5 个 `<mark>`、颜色分布 1/1/1/1/1、rationale tooltip、图例、选择器、刷新按钮全过 ✓
- 回归：run-mock / run-tools（含新增 lossless 断言）/ verify-http / simulate-render 全 PASS

**修复（Step 4 发现）**
- `host/tools.js` parse_pdf 返回值 `task_id: result.taskId` → pipeline 无该字段（实为 `batchId`），键值为 `undefined` → dsh-tools 输出边界报 `INVALID_TOOL_OUTPUT`（工具落盘成功但模型看到错误并重试）；已改为 `task_id: result.batchId ?? null` 并加注释；`test/run-tools.js` 新增 `assertLosslessJson` 回归（undefined/NaN/Infinity/BigInt/循环引用 + JSON 往返稳定），parse_pdf/read_highlights/write_highlights 输出全过
- 重启后连带发现并修复 cwd 回归（见 §2 重启事故条目）：根目录解析 config.root → env → cwd 兜底 + profile patch 钉 `D:\aa` + `test/run-plugin.js` 回归；当前运行进程经 junction `C:\Users\eyx\data` 已立即恢复（未重启），下次重启后持久修复生效

**数据现状**：`data/p-mikolov-2013-2013-1-word2vec/` 为 Step 4 真实解析 + Agent 写入的 5 spans（原 seed-demo 的 9 个演示 spans 被本次真实解析覆盖——演示数据即 Agent 真实产物，更贴近验收语义）

**剩余人工步骤**：浏览器打开 3081 视觉确认（headless 证据已齐：渲染树断言 + 真实数据通路 + 5 色 mark 分布）

### ✅ Step 5 — 验收收尾（2026-08-26 v0.1 交付完成）

**v0.1 两条验收标准（设计文档 §8）——全部通过**
- ① 输入真实会议论文 PDF → paper profile 的 GUI 渲染出正文 Markdown：✅ Step 4 真实解析（11 页 / 80 锚点 / 28,880 字符）+ **用户浏览器目视确认**（重启事故修复后 500 消失，正文正常加载）
- ② Agent 可通过工具读取/写入 `paper.highlights.json`，GUI 能显示已写入的 spans：✅ Step 4 端到端（5 spans 五色、read_highlights 回读逐项一致）+ **用户目视确认 5 处高亮与悬浮 rationale 正常**

**正文过滤抽样人工校验（新增 `scripts/step5-acceptance.js`，真实数据全过）**
- 锚点契约：80 锚点 `md_offset` 逐字符匹配 paper.md + 严格阅读序 ✓
- highlights：5 spans schema 合法、区间全在锚点文本内、id 唯一 ✓
- 过滤抽查：paper.md 无表格行 / 公式块 / 图片嵌入 / 参考文献正文残留；保留块仅 text(58)+title(22)；跳过统计与 meta 一致（ref_text 32 / table 8 / interline_equation 5 / image 1 / empty 5）✓
- 章节结构：标题 + Abstract→§7 Follow-Up Work 共 22 个标题齐全；空 `## References` 为已知 cosmetic（ref_text 跳过），v0.2 渲染端可忽略空节

**文档收尾**
- 设计文档：头部状态改为 v0.1 已交付；§8 v0.1 标注验收通过 + 三项风险/依赖化解记录；§10 未决点 #1–#3 标记 ✅（v0.2+ 的 #4–#7 保留）
- README：v0.1 状态横幅 + step5-acceptance.js 入库
- 本进度文件：Step 5 ✅，v0.1 交付

**v0.1 遗留（已知 cosmetic / 后续版本）**
- paper.md 末尾空 `## References` 标题（v0.2 渲染端忽略空节）
- GUI 高亮层只读展示（接受/删除/改色等审查交互属 v0.2）
- 画像四层 / propose / 差异学习均属 v0.2–v0.3（设计 §8）

### ▶️ v0.2 待办（审查闭环）
- Agent 技能：全局通读（论文地图 + 章节计划）→ 逐节 propose → 差异分析 + 章节反思（设计 §5）
- GUI 审查交互：接受/删除/改色/改范围/手动新增/备注 + 审查完成信号
- 去重：论文地图「已高亮主张」清单驱动；渲染端忽略空节

## 5. 环境与操作备忘

- DSH 安装：`C:\Users\eyx\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh`；profiles：`C:\Users\eyx\.dsh\profiles\`（node_modules 为 junction 树，指向 dsh 安装的 node_modules；`healProfilesModuleFallback` 只增不删）
- 测试命令：
  ```powershell
  node D:\aa\packages\paper-highlight\test\run-mock.js
  node D:\aa\packages\paper-highlight\test\run-tools.js
  node D:\aa\packages\paper-highlight\test\run-plugin.js
  node D:\aa\packages\paper-highlight\test\run-real.js   # 需要 MINERU_API
  node D:\aa\packages\paper-highlight\scripts\step4-e2e.js  # Step 4 端到端验收（3081 运行中；会新建会话并消耗一次 MinerU 解析）
  ```
  （依赖已本地安装；如需 NODE_PATH 兜底：`C:\Users\eyx\.dsh\profiles\node_modules`）
- 沙箱：工作区 `D:\aa` 内写入无需授权；工作区外写入（如 `~/.dsh/.agent-presets`、`profiles/node_modules`）需 `danger-full-access` 一次性升级 + 用户批准
- npm 需指定工作区内缓存：`npm --cache D:\aa\.npm-cache ...`
- 动态插件（cordis_define/run）为进程级临时物，重启后需重建；durable 交付物在 `packages/paper-highlight` + preset + profile（Step 3 已改走 durable 路线：client bundle + `/paper-hl` webserver 路由，不依赖动态插件）
- 早期会话用 cordis preset（含动态插件工具）；Step 3 会话为 standard preset（无 cordis 工具）→ 验证改走 paper profile（3081）durable 组合
- paper profile 服务：`dsh --profile paper --port 3081 --no-open`（后台 job pwsh-7，启动需 danger-full-access；prepareProfile 重写 profile/cordis.yml）

## 6. 交付物清单

| 路径 | 内容 | 状态 |
|---|---|---|
| `D:\aa\docs\paper-highlight-agent-design.md` | 设计文档 | ✅ v0.1 已交付标注（§8/§10 更新） |
| `D:\aa\packages\paper-highlight\` | 插件包（host/client/skills/test/scripts/dynamic） | ✅ Step 1-5 完成：冒烟 + client bundle + host 路由 + 端到端验收驱动 + lossless/root 修复 + 验收抽样脚本 |
| `D:\aa\data\p-mikolov-2013-2013-1-word2vec\` | 论文数据目录（paper.md / anchors.json / meta.json / paper.highlights.json） | ✅ Step 4 真实解析 + Agent 写入 5 spans（五色各 1，回读一致，GUI 目视确认） |
| `C:\Users\eyx\.dsh\.agent-presets\paper\` | paper agent preset | 已挂载验证 |
| `C:\Users\eyx\.dsh\profiles\node_modules\paper-highlight` | junction → 包 | 已建 |
| `C:\Users\eyx\.dsh\profiles\paper\` | paper profile（3081 服务运行中；cordis.patch.yml 钉 `root: D:\aa` + `default: paper`） | ✅ 已建并启动 |
| `C:\Users\eyx\data` | junction → `D:\aa\data`（重启事故临时恢复，持久修复后已不依赖，可删） | ✅ 已建 |
| `D:\aa\field-map.md` | 领域发展线（§7） | v0.4 再建 |
