# Paper Highlight Agent — v0.2 项目进度（审查闭环）

> 版本：v0.2（审查闭环）· 状态：**Phase 0/1 + Phase 2 全部完成（P2-a…P2-f 已实现并验证，审查闭环核心达成）** · 最近更新：2026-08-27 —— P2-e 审查完成信号 + P2-f 全量回归/真实写冒烟/归档（`v0.1.2` 标签），P2-d 浏览器目视确认并真实新增 `s-006` 落库（§6 完成记录）
> **独立使用说明**：本文件含 v0.1 继承状态、v0.2 目标/决策/实施步骤/风险/命令，可脱离旧文件单独续作；旧版记录见 `paper-highlight-progress-v0.1.md`（归档）。

---

## 1. 项目定位与 v0.2 目标

- **项目一句话**：在 DeepSeek Harness（DSH）之上构建单论文多色高亮 Agent —— 用户提供论文 PDF → MinerU 云 API 解析为结构化 Markdown → `dsh web`（paper profile, 3081）GUI 整体渲染 → Agent 依据「论文整体认识 + 领域发展线 + 用户画像」逐节提出语义高亮 → 用户审查修改 → 画像持续学习 → 导出。
- **v0.1（已完成，归档）**：管线打通 —— PDF → MinerU → `data/<paper_id>/` 归一化产物 → Agent 工具读写高亮 JSON → GUI 渲染正文 + 显示 spans。
- **v0.2 目标**：审查闭环 —— 完整跑通「全局通读 → 逐节 propose → GUI 审查 → 差异分析/章节反思 → 下一节」核心循环。

## 2. 关联文档

| 文档 | 路径 | 用途 |
|---|---|---|
| 设计文档 | `D:\aa\docs\paper-highlight-agent-design.md` | §5 Agent 工作流、§8 v0.2 范围、§10 风险 #4/#5 |
| v0.1 进度归档 | `D:\aa\docs\paper-highlight-progress-v0.1.md` | v0.1 交付记录与校准结论回溯 |
| 本文件 | `D:\aa\docs\paper-highlight-progress-v0.2.md` | v0.2 进度（当前） |

## 3. v0.1 继承状态（独立使用必需）

### 3.1 运行环境
- Windows；harness `dsh web`（port 3080，profile `web`）；**paper profile 独立跑 3081**
- paper profile 启动：`dsh --profile paper --port 3081 --no-open`（后台 job；`prepareProfile` 会重写 profile/cordis.yml，启动需 danger-full-access）
- DSH 安装：`C:\Users\eyx\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh`；profiles：`C:\Users\eyx\.dsh\profiles\`
- 环境变量：`MINERU_API`（已 setx，len=51）；`MINERU_BASE_URL`（默认 `https://mineru.net`）、`MINERU_UPLOAD_MODE=file|url`、`MINERU_OCR=1`、`MINERU_FORMULA=1`、`MINERU_LANGUAGE`
- 沙箱：`D:\aa` 内写入免授权；工作区外（`.dsh\.agent-presets`、`profiles/node_modules`）需 danger-full-access 一次性升级 + 用户批准；npm 用 `npm --cache D:\aa\.npm-cache`

### 3.2 关键路径与交付物（已就绪，勿重复造）
- 插件包：`D:\aa\packages\paper-highlight\`
  - `host/schema.js`（anchors/highlights 模型校验、越界 span 拒绝）
  - `host/store.js`（`data/<paper_id>` 原子读写，写入即校验）
  - `host/mineru.js`（云 API 客户端：上传→任务→轮询→下载；`resolveMineruConfig` 读 env）
  - `host/normalize.js`（zip → `paper.md` + `anchors.json` + `meta.json`，含跳过统计）
  - `host/pipeline.js`（`processPdf`；`paperIdFromPdfPath`）
  - `host/plugin.js`（durable host 插件，`inject:['webServer']`，`/paper-hl` 路由：`GET /read` + `POST /write`；根目录解析 `config.root → PAPER_HL_ROOT → cwd` 兜底）
  - `host/sections.js`（v0.2 Phase 1：节树构建，title 锚点 + md 标题级别 → `s1…sN` + empty/kind；`/read` 每请求派生返回）
  - `host/actions.js`（v0.2 Phase 1：审查动作纯逻辑 accept/reject/recolor/rescope/add/note/review_section，decisions 只追加）
  - `host/tools.js` + `host/tools-plugin.mjs`（三工具：`parse_pdf` / `read_highlights` / `write_highlights`，全量覆盖写）
  - `client/render-body.js`（渲染单一来源：纯函数模块层定义、经 `toString()` 嵌入 bundle；锚点序渲染 + `<mark>` + 图例/选择器/刷新；Phase 0：空节标题跳过 + span 区间钳制）
  - `client/client.js`（durable bundle，ModuleLoader 格式，`callData=fetch('/paper-hl/read')`）
  - `dynamic/client-half.js`（动态浏览器半体备用）
  - `scripts/`：`gen-client.js`、`verify-http.js`、`seed-demo.js`、`simulate-render.js`、`step4-e2e.js`、`step5-acceptance.js`
  - `test/`：`run-mock.js`、`run-tools.js`、`run-actions.js`（Phase 1 动作）、`run-plugin.js`（路由+写通路）、`run-render.js`（Phase 0 渲染）、`run-real.js`（需 key）、`verify.js`（共享断言）
- agent preset：`C:\Users\eyx\.dsh\.agent-presets\paper\`（含 `paper-highlight-tools` 行；trust: user）
- profile：`C:\Users\eyx\.dsh\profiles\paper\`（bundles = dsh-base + dsh-web-app + paper-highlight；`cordis.patch.yml` 钉 `root: 'D:\aa'` + `agent-presets default: paper`）
- junction：`profiles\node_modules\paper-highlight` → 包；`C:\Users\eyx\data` → `D:\aa\data`（重启事故临时恢复，持久修复后已不依赖，可删）

### 3.3 数据现状
- `D:\aa\data\p-mikolov-2013-2013-1-word2vec\`：
  - `paper.md`（28,880 字符）、`anchors.json`（**80 锚点 / 11 页**，`md_offset` 逐字符匹配 paper.md + 严格阅读序）
  - `meta.json`（`middle_json: layout.json`、跳过统计 ref_text 32 / table 8 / interline_equation 5 / image 1 / empty 5）
  - `paper.highlights.json`（**5 spans 五色各 1**：red=核心贡献、yellow=目标定义、blue=局限瓶颈、green=可借鉴启发、purple=待深挖；`status:"proposed"`、`decisions` 带 proposed 记录、char 区间全部合法）
- 锚点模型：`anchor_id = a-<page:04d>-<block:02d>-<par:02d>`（1 起始零填充）；span `char_start/char_end` 为 0 起始半开区间，指向 `anchor.text`
- 正文过滤（v0.1）：保留 block 类型 text/title/content；跳过 image/table/formula/caption/ref_text/aside_text/page_number 等；一个 block = 一段 = 一个锚点
- 已知 cosmetic：paper.md 末尾空 `## References` 节（ref_text 被跳过）→ v0.2 渲染端忽略空节

### 3.4 关键校准（既有结论，必须遵守）
1. **MinerU 流程**：`POST /api/v4/file-urls/batch`（须 **Content-Length**，chunked 报 `-10002`）→ 预签名 PUT 原始字节（无 Content-Type）→ 系统自动提交任务 → 轮询 `GET /api/v4/extract-results/batch/{batch_id}` → `done` 后下载 `full_zip_url`；pipeline 返回值字段是 **`batchId`**（非 taskId）
2. **zip 中间结构**：是 **`layout.json`**（无 middle.json）；`pdf_info[i].para_blocks`（段落合并视图，首选）/ `preproc_blocks`（原始布局，兜底）；**para_blocks 原始数组序即权威阅读序（双栏列内感知，禁 bbox y 排序）**
3. **dsh-tools 工具输出必须 lossless JSON**：`undefined/NaN/Infinity/BigInt/循环引用` 报 `INVALID_TOOL_OUTPUT`；工具返回值中不存在字段须显式 `?? null`
4. **dsh web 浏览器传输 = HTTP JSON-RPC**：`POST /api/<method>`，信封 `{type:'client-request', rpcId, method, payload}`；事件流 WebSocket `/api/events.mux`；`session.create` 不带 agentPreset 时取 profile 的默认（paper 组合）；`session.prompt` 用 `mode:'queue'` 异步受理，轮询 `session.list` 的 `running` 判定回合结束
5. **host 网络**：不用 `ctx.web.fetch`（无 fetch provider），直接用 Node `https`（curl/PS HTTPS 因 schannel 凭据层故障不可用，Node OpenSSL 通道正常）
6. **数据根目录解析**：组合 config `root` → `PAPER_HL_ROOT` → `process.cwd()` 兜底（重启后 cwd 不可靠，paper profile 已钉 `root: 'D:\aa'`）
7. **client 插件机制**：`conversation.view` 槽位（list 槽/session 作用域）+ `window.__ModuleLoader__.load({id, factory})` bundle；数据走同源 `fetch('/paper-hl/read')`；CSS 用 `document.querySelector("style[data-plugin-css=…]")` 注入

### 3.5 测试命令（v0.1 回归基线，改动后必须全绿）
```powershell
node D:\aa\packages\paper-highlight\test\run-mock.js
node D:\aa\packages\paper-highlight\test\run-tools.js
node D:\aa\packages\paper-highlight\test\run-actions.js   # Phase 1 审查动作（7 动作 + 负例）
node D:\aa\packages\paper-highlight\test\run-plugin.js    # 路由 + 写通路校验矩阵 + sections
node D:\aa\packages\paper-highlight\test\run-render.js    # Phase 0 渲染（空节跳过 + 钳制）
node D:\aa\packages\paper-highlight\test\run-real.js       # 需要 MINERU_API（消耗额度，按需）
node D:\aa\packages\paper-highlight\scripts\step4-e2e.js   # 3081 运行中；新建会话并消耗一次 MinerU
node D:\aa\packages\paper-highlight\scripts\simulate-render.js
node D:\aa\packages\paper-highlight\scripts\verify-http.js
```
（依赖已本地安装；NODE_PATH 兜底：`C:\Users\eyx\.dsh\profiles\node_modules`）

## 4. v0.2 范围与验收（设计文档 §8）

**范围**
- Agent 技能：全局通读（论文地图 + 章节计划）、逐节 propose（候选 spans + 理由）
- GUI 审查交互：接受 / 删除 / 改色 / 改范围 / 手动新增 / 备注；审查完成后提交信号
- 差异分析 + 章节反思：产出画像更新提案
- 去重：论文地图「已高亮主张」清单驱动；渲染端忽略空节

**验收标准**
1. 完整跑通循环，人工评估 propose 质量可接受（高亮处确有语义价值、密度合理）
2. 用户删除/改色操作后，Agent 能给出合理的画像更新提案

**风险/依赖（设计 §10 #4/#5）**
- span 锚定在渲染后的稳定性（文本归一化、跨行处理）
- 审查交互 UX 的舒适度（标注层与原文的视觉区分）
- 差异推断质量（v0.3 靠用户确认机制兜底，v0.2 仅产出提案）

## 5. v0.2 关键设计决策（实现前已锁定）

1. **审查操作即时写盘，不攒批**：每个用户操作立即 `POST /paper-hl/write` 追加一条 `decision`（只追加、不可变）并更新 `status`，维持「JSON 是 Agent 与 UI 唯一契约、可断点续作、可审计」；撤销 = 反向操作记为新 decision，不删历史。
2. **审查完成信号双通道**：GUI 按钮写 `plan.sections[i].status='reviewed'`（+ reviewed_at 时间戳）为主；聊天说「审查完毕」为等价信号（Agent 重读 JSON 见标记即触发差异分析）。
3. **节索引由 host 生成**：新增 `host/sections.js`，基于 title 类锚点 + paper.md 标题前缀（`#`/`##`）构建章节树 `{id, title, level, anchorIds[], plan_status}`；`/paper-hl/read` 一并返回 `sections`；空节标 `empty`，渲染端忽略。
4. **工具面保持小**：新增 `list_sections()` / `read_section({section})`；`write_highlights` 扩展 **append 模式**（propose 追加 proposed spans，不动既有 spans，复用现有 schema 校验）；去重逻辑放提示词规则，`duplicates` 只追加。
5. **画像摘要 v0.2 用内置默认**（五色语义 + 密度基线：每节 3–5 处、句子级）；四层画像 + 冷启动属 v0.3。差异分析提案落盘 `data/<paper_id>/reflections.json`（字段对齐设计 §4.3 四层，供 v0.3 直接消费），v0.2 不做确认 UI。

## 6. 实施步骤（Phase 0–6，含交付物与测试）

### Phase 0 — 渲染稳定性小件（~0.5 天）
- 渲染端忽略空节（References）；空白折叠/文本归一化容错；锚点就近匹配兜底（跨行、渲染差异不炸）。
- 测试：扩展 `scripts/simulate-render.js`（空节不渲染、归一化后 span 仍命中）。

### Phase 1 — host 写通路 + 节索引（~1–1.5 天）
- `host/sections.js`：节树构建。
- `host/plugin.js` 新增 `POST /paper-hl/write`，动作：`accept` / `reject` / `recolor` / `rescope` / `add` / `note` / `review_section`；复用 store 原子写 + schema 校验（区间在 anchor 内、id 唯一、decisions 只追加）；paperId 白名单与 config.root 沿用现有修复。
- `/paper-hl/read` 返回增加 `sections`。
- 测试：扩展 `test/run-plugin.js`（写通路校验矩阵：非法区间 / 未知动作 / 未知 paperId 拒绝；`review_section` 后 plan 状态迁移）。

### ✅ Phase 0/1 完成记录（2026-08-26，端到端验证通过）

**交付**（git 工作区已落盘，未提交）
- `host/sections.js`（新）：22 节树（真实数据验证：s1 paper_title、s22 References 空节）；`/read` 返回 sections 并合并 plan 状态
- `host/actions.js`（新）：7 动作纯逻辑，decisions 只追加
- `host/plugin.js`（扩展）：`GET /read` + `POST /paper-hl/write`（校验矩阵：未知 paper→404、未知 span/动作/越界→400、畸形 body→400、缺 paperId→400）
- `host/schema.js`（扩展）：plan.sections 条目（id/status/reviewed_at…）+ span.note 校验
- `client/render-body.js`（重构）：纯函数模块层定义 + `toString()` 嵌入（单一来源）；Phase 0 空节标题跳过 + clampRange 钳制
- `client/client.js` / `dynamic/client-half.js`：`gen-client.js` 重新生成
- 测试：`run-actions.js`（新）、`run-render.js`（新）、`run-plugin.js`（扩展）、`simulate-render.js`（扩展）

**验证结果（2026-08-26）**
- 本地回归全绿：run-mock / run-tools / run-actions / run-plugin / run-render → 全部 PASS
- 端到端 `simulate-render.js`（live 3081，新 host 代码）→ **SIMULATION PASS**：1 h1 + 20 h2（References 空节已跳过、无 References 标题）、58 段、5 个 mark 五色各 1、rationale tooltip / 选择器 / 刷新 / 图例齐全
- 写通路未对真实数据做 live 冒烟（避免改动 5 spans 演示数据）；run-plugin 已在临时 fixture 全量覆盖写矩阵，Phase 2 GUI 上线时走真实写路径
- ⚠️ 浏览器目视确认（3081 → 论文 tab → References 标题消失、5 高亮正常）待用户操作

**本轮未做（属后续 Phase）**
- Phase 2 GUI 审查交互（操作条/选择映射/新增/改范围/完成信号）——host 写通路 API 已就绪，交互 UI 未实现
- Phase 3–6、git 提交（工作区改动待 commit）

### Phase 2 — client 审查交互（~2–3 天，工作量重心）
- 每处 `<mark>` 可点击 → 操作条：接受 / 删除 / 改色（图例五色；colors.yml 驱动留 v0.3）/ 改范围 / 备注。
- **文本选择 → 手动新增**：`client/render-body.js` 为每个渲染文本节点维护 `{anchorId, baseOffset}` 映射表，`window.getSelection()` 映射回 `anchor + char_start/char_end`（复用 `md_offset` 契约）→ 弹出颜色选择 + 理由输入，`status='user_added'`。
- **改范围**：选中新文本替换原区间（同一映射机制）。
- **审查完成按钮**：当前节 → `POST /paper-hl/write {action:'review_section'}`。
- 所有操作乐观更新 UI + 失败回滚（回读校准）。
- 测试：`simulate-render.js` 扩展为可注入交互（模拟 selection、操作条点击），断言写盘载荷正确 + 渲染同步。

#### Phase 2 分步实现策略与验证（P2-a … P2-f）

**设计原则**：所有可计算逻辑（选择→锚点区间映射、动作载荷构造、乐观更新 reducer、rejected 过滤）都做成**模块层纯函数 + `toString()` 嵌入 bundle**（同 Phase 0/1 的 render-body 单一来源模式），可脱离浏览器单测；交互行为（点击/选择/输入）在 `simulate-render.js` 里注入模拟事件驱动，断言写盘载荷与渲染同步。**写通路 API 已就绪（Phase 1），本阶段只做 client 消费端。**

| 步骤 | 目标 | 交付 | 验证手段 |
|---|---|---|---|
| **P2-a 写通路接线** | client 能调 `POST /paper-hl/write` | render-body 增加 `callWrite(action)` 数据函数；`gen-client.js` 注入 durable fetch POST（`?paperId=` + JSON body），dynamic 半体备份暂不接 write | 重新生成 bundle + `check-host/utf8`；`run-render` 对 `buildWriteUrl/encodeWriteBody` 纯函数单测；simulate-render 断言 bundle 含 write 调用 |
| **P2-b 交互状态与纯 reducer** | UI 状态模型可测 | 纯函数：`localApplySpans(spans, actionPayload)`（乐观更新）、`excludeRejected(spans)`（rejected 不高亮渲染但保留 JSON/audit）、`spanActiveStyle(status)`；PaperView state 增 `activeSpanId / menuOpen / drafts` | `run-render` 对 reducer/过滤纯函数矩阵单测（不依赖 React） |
| **P2-c 操作条** | 接受/删除/改色/备注 | 每处 `<mark>` 可点击（onClick→选中态 outline）；操作条悬浮（半透明底+边框，视觉区分原文）；接受→accept、删除→reject、改色→recolor（色板=图例五色，点击即改）、备注→note（输入框+保存）；每动作乐观更新 + callWrite，失败→回读 `/read` 校准并提示 | `simulate-render` 注入：点击 mark→断言操作条渲染；点接受/改色→断言 fetch POST 载荷 `{action, span_id, color}` 正确 + 本地渲染同步（status/颜色变化） |
| **P2-d 选择→新增/改范围（核心难点）** | 手动新增 + 改范围 | 纯函数 `buildSegmentMap(blocks)`（每段按 spans 切成文本节点段，带 anchorId + 相对 anchor.text 的 baseOffset）；纯函数 `mapSelection(segments, sel)`（Range 起止→`{anchor, char_start, char_end}`，跨段/反向/越界/空选择容错）；`mouseup` 检测非空选择且未点 mark→「新增高亮」弹窗（颜色+理由）→POST `add`；选中新文本替换原区间→POST `rescope` | `run-render` 对 `buildSegmentMap/mapSelection` 矩阵单测（同段/跨段/反向/越界/边界 offset）；simulate-render 注入伪造 selection→断言弹窗 + POST 载荷 |
| **P2-e 审查完成信号** | 节状态闭环 | `/read` 的 sections（含 plan 合并）→GUI 节列表；「本节审查完毕」按钮→POST `review_section`→乐观更新 plan status（节旁 ✓） | simulate-render 断言节列表渲染 + 点击按钮→POST `{action:'review_section', section}` 载荷；run-render 节状态过滤纯函数单测 |
| **P2-f 交互回归 + 人工验收** | 交付验收 | 全量回归 + 人工走查清单 + git 提交 | 回归：run-mock/tools/actions/plugin/render + simulate-render（交互注入版）全绿；人工走查（3081 浏览器）：点高亮→操作条、接受/删除/改色/备注各一次、选文本→新增、改范围、标记本节完毕→刷新后节状态保留、References 空节不渲染；写通路真实数据冒烟（先备份 `paper.highlights.json`，git 可回滚） |

**UX 决策（实现时落实）**
- 视觉区分：选中 mark 加 outline、操作条半透明悬浮于行内上方；rejected 不高亮（灰显或隐藏）但保留在 JSON 作为差异分析信号。
- 撤销 = 反向操作（重新接受/改回原色）记为新 decision，不删历史（维持 decisions 只追加契约）。
- 颜色面板固定五色（colors.yml 驱动留 v0.3）；备注直接写 `span.note`（schema 已支持）。

#### ✅ P2-a + P2-b 完成记录（2026-08-26 晚，验证通过）

**范围**：仅 Phase 2 的 P2-a（写通路接线）与 P2-b（交互状态与纯 reducer），未做 P2-c…P2-f。

**交付**（git 工作区已落盘，未提交）
- `client/render-body.js`（扩展）：新增模块层纯函数 `buildWriteUrl` / `encodeWriteBody` / `callWrite`（P2-a 写通路）+ `excludeRejected` / `localApplySpans` / `spanActiveStyle`（P2-b 状态模型），全部经 `toString()` 嵌入 BODY；PaperView 增 `activeSpanId / menuOpen / drafts` 交互状态，渲染侧接入 `excludeRejected`（rejected 不高亮、保留 JSON 审计）
- `scripts/gen-client.js`（扩展）：durable bundle 注入 `writeData` fetch POST 传输（`?paperId=` + JSON body）；**dynamic 半体备份暂不接 write**（callWrite 以 `typeof writeData` 守卫，明确报错）
- `client/client.js` / `dynamic/client-half.js`：重新生成
- `test/run-render.js`（扩展）：P2-a 纯函数矩阵（URL/body 构造、callWrite ok/ok:false/传输异常/无传输四态）+ P2-b reducer 矩阵（accept/reject/recolor/rescope/note/add、不可变性、未知 action/span 空操作容错）+ `excludeRejected`/`spanActiveStyle`
- `scripts/simulate-render.js`（扩展）：断言 shipped bundle 含 `writeData/callWrite/buildWriteUrl/encodeWriteBody`（P2-a）与 `excludeRejected/localApplySpans/spanActiveStyle/activeSpanId/menuOpen/drafts`（P2-b）

**验证结果（2026-08-26）**
- 本地回归全绿：run-mock / run-tools / run-actions / run-plugin / run-render → 全部 PASS
- `check-host.js` / `check-utf8.js` → PASS（host/client 半体可加载、UTF-8 字符存活）
- 端到端 `simulate-render.js`（live 3081，读真实数据）→ **SIMULATION PASS**：bundle 含写通路接线与交互状态；仍 1 h1 + 20 h2（References 空节跳过）、58 段、5 mark 五色各 1、图例/选择器/刷新齐全
- 写通路未对真实数据做 live POST 冒烟（避免改动 5 spans 演示数据）；callWrite 的 HTTP 行为已在 run-render 用注入传输单测覆盖，真实 POST 留给 P2-c（操作条接线）端到端走查
- ⚠️ 浏览器目视确认（3081 → 论文 tab：刷新后渲染行为不变，P2-b 状态字段无可见变化属预期）待用户操作

**本轮未做（属后续 Phase）**
- P2-d 选择→新增/改范围、P2-e 审查完成信号、P2-f 全量回归 + git 提交（工作区改动待 commit）

#### ✅ P2-c 完成记录（2026-08-26 深夜，验证通过）

**范围**：仅 Phase 2 的 P2-c（操作条：接受 / 删除 / 改色 / 备注 + 乐观更新接线），未做 P2-d…P2-f。

**交付**（git 工作区已落盘，未提交）
- `client/render-body.js`（扩展）：
  - 新增纯函数 `markStyle(span, isActive, clickable)`（色块 + 状态样式 + 选中 outline）、`reconcileSpan(spans, serverSpan)`（服务端确认 span 合并回乐观层）
  - `renderText(text, spans, opts)` 增 `{ onMarkClick, activeSpanId }`：mark 可点击（onClick）+ 选中 outline（向后兼容 2 参调用）
  - PaperView：增 `spansOverride`（乐观覆盖层，null=服务端数据）与 `flash`（失败提示）；`onMarkClick` 选中/切换操作条；`applyAction(payload)` = 乐观 `localApplySpans` → `callWrite` → 成功以 `res.span` 做 `reconcileSpan` / 失败 `flash` 提示 + 回读 `/read` 校准（回滚覆盖层）；悬浮操作条（`phl-ab`：接受/删除按钮 + 五色板 + 备注输入+保存 + × 关闭），reject 后该 span 移出可见列表（操作条自然关闭）
  - 新增 P2-c CSS（半透明悬浮条、色板、按钮、输入框、flash）
- `test/run-render.js`（扩展）：`markStyle` 矩阵（色块/光标/选中 outline/状态透明度）+ `renderText(opts)`（onClick 触发、active 与否 outline、2 参向后兼容）+ `reconcileSpan`（按 id 替换、未知 id/null 不变、不可变性）
- `scripts/simulate-render.js`（扩展）：**POST /paper-hl/write 走 MOCK**（`writeCapture` 捕获载荷，从只读 `/read` 派生完整响应，真实数据零改动——真实写冒烟留 P2-f 备份后做）；注入交互：点 mark→断言操作条渲染 + 选中 outline + 接受/删除/五色板/备注输入齐全；点接受→断言 POST 载荷 `{action:'accept', span_id}` + 本地渲染同步（`[accepted]`/opacity 1）；点绿色色板→断言 POST 载荷 `{action:'recolor', span_id, color:'green'}` + 背景变绿
- `client/client.js` / `dynamic/client-half.js`：重新生成（dynamic 半体仍不含 writeData）

**验证结果（2026-08-26）**
- 本地回归全绿：run-mock / run-tools / run-actions / run-plugin / run-render → 全部 PASS
- `check-host.js` / `check-utf8.js` → PASS
- 端到端 `simulate-render.js`（live 3081 读真实数据 + POST mock）→ **SIMULATION PASS**：bundle 含 P2-a/b/c 全部接线；mark 可点击、操作条渲染与五色板/备注齐全；accept/recolor 的 POST 载荷正确且本地渲染同步（status→accepted、背景→绿）；真实数据未被改动
- ⚠️ 浏览器目视确认（3081 → 论文 tab：点高亮→操作条、接受/删除/改色/备注、失败提示）待用户操作
- 调试中修正一处测试预期：操作条根节点 className 须精确匹配 `phl-ab`（前缀匹配会误命中 `phl-ab-head` 等子节点）；mock 写响应须为 `Response` 形状（`{ok,status,json}`），否则 durable `writeData` 的 `res.json()` 抛错

**本轮未做（属后续 Phase）**
- P2-d 选择→新增/改范围（`buildSegmentMap`/`mapSelection`）、P2-e 审查完成信号（review_section 按钮）、P2-f 全量回归 + 真实写冒烟 + git 提交（工作区改动待 commit）

#### ✅ P2-d 完成记录（2026-08-26，验证通过）

**范围**：仅 Phase 2 的 P2-d（选择→新增/改范围：`buildSegmentMap`/`mapSelection` 纯函数 + 文本选择→锚点区间映射 + 「新增高亮」弹窗 + 「改范围」模式），未做 P2-e…P2-f。

**交付**（git 工作区已落盘，未提交）
- `client/render-body.js`（扩展）：
  - 新增纯函数 `buildBlockSegments`/`buildSegmentMap`（每段按 spans 切成文本节点段的扁平 segment 列表，带 anchorId + 相对 anchor.text 的 `[start,end)` 偏移，渲染节点序即 segment 序）、`mapSelection`（normalized `{start:{seg,offset}, end:{seg,offset}}` → `{anchor, char_start, char_end}`，同段/跨段/反向交换/越界钳制/空选择/跨锚点拒绝全容错）
  - 新增 DOM 胶水 `nodeOffsetToSeg`/`blockChildToSeg`/`selectionToNorm`（按 `data-phl-seg`/`data-phl-anchor` 属性解析：文本节点在 seg 元素内→字符偏移、seg 元素本身→子索引 0/末尾、block 元素→子索引映射段、不可解析→null/ok:false 静默）
  - `renderText` 增 `{withSegments, segBase, anchorId}`：每个渲染文本节点（普通文本 + mark）包 `<span data-phl-seg>`/`<mark data-phl-seg>` 以便 DOM 选择映射回锚点偏移；2 参/3 参旧调用完全向后兼容（不传 withSegments 时仍返回裸字符串 + mark）
  - PaperView：增 `addDraft`（新增高亮弹窗：五色板 + 理由输入 + 添加/取消）与 `rescueTarget`（改范围模式：提示条 + 取消按钮）；`.phl-body` 挂 `onMouseUp`（非折叠选择 → `selectionToNorm`→`mapSelection`→ 新增弹窗或 rescope，跨段落选择 flash 提示「高亮不能跨段落选择」，处理完 `removeAllRanges` 清选择）；操作条新增「改范围」按钮（选中新文本替换原区间）
  - `reconcileSpan` 增第三参 payload：`add` 的乐观 clientId 与服务端 s-<n> id 匹配（reconcile 替换 `_local` 乐观 span，新增即时回填真实 id）
- `scripts/gen-client.js`（扩展）：durable bundle 额外导出 `buildBlocks/buildSegmentMap/mapSelection/selectionToNorm/nodeOffsetToSeg`（headless 测试与浏览器驱动同一份内嵌代码）
- `client/client.js` / `dynamic/client-half.js`：重新生成（dynamic 半体仍不含 writeData，selection 胶水随 BODY 同步嵌入）
- `test/run-render.js`（扩展）：P2-d 纯函数矩阵 —— buildBlockSegments（排序/钳制/空文本/无 spans 单段）、buildSegmentMap（跨块扁平序与区间保持）、mapSelection（同段/跨段/反向/越界索引拒绝/越界偏移钳制/边界 offset/空选择/跨锚点/null）、nodeOffsetToSeg（文本节点/seg 元素/block 元素边界/不可解析）、selectionToNorm（折叠→null、不可解析→ok:false）、renderText withSegments（data 属性 + 向后兼容）、reconcileSpan clientId 匹配
- `scripts/simulate-render.js`（扩展）：POST /paper-hl/write 走 MOCK（载荷捕获 + 只读 /read 派生完整响应，真实数据零改动）；新增 P2-d 驱动 —— `window.getSelection` stub + `data-phl-seg` 节点链伪造 DOM-ish selection：选文本→断言「新增高亮」弹窗（五色板/理由输入/添加按钮）→ 点绿色 + 输入理由 → 断言 POST `{action:'add', anchor, char_start, char_end, color, rationale, clientId}` 与内嵌 `mapSelection` 期望范围一致 + 本地渲染同步（新 mark 绿色 [user_added]、服务端 s-id 回填）；点 mark→操作条「改范围」→ 断言提示条渲染 + 操作条关闭 → 在另一段落选文本 → 断言 POST `{action:'rescope', span_id, anchor, char_start, char_end}` 范围与 mapSelection 一致 + mark 迁移到新 anchor、提示条清除

**验证结果（2026-08-26）**
- 本地回归全绿：run-mock / run-tools / run-actions / run-plugin / run-render → 全部 PASS
- `check-host.js` / `check-utf8.js` / `verify-http.js` → PASS（host/client 半体可加载、UTF-8 字符存活、3081 路由与 bundle 正常）
- 端到端 `simulate-render.js`（live 3081 读真实数据 + POST mock）→ **SIMULATION PASS**：bundle 含 P2-a/b/c/d 全部接线（新增 p2d 标记断言：buildSegmentMap/buildBlockSegments/mapSelection/selectionToNorm/nodeOffsetToSeg/data-phl-seg/新增高亮/改范围/addDraft/rescueTarget/onBodyMouseUp）；P2-c accept/recolor 回归通过；P2-d 新增全链路（弹窗渲染 → add 载荷与内嵌 mapSelection 逐字节一致 → 乐观新增 + 服务端 s-id 回填 → 新 mark 绿色 [user_added]）与改范围全链路（改范围按钮 → 提示条 → 另一段落选文本 → rescope 载荷正确 → mark 迁到新 anchor）通过；**真实数据零改动**（paper.highlights.json 仍 5 spans 五色 proposed、mtime 未变）
- 调试中修正测试预期：buildBlockSegments 对「两 mark」文本产出 5 段（非 4）；buildSegmentMap 跨块计数（a-2 带 mark 为 3 段）；nodeOffsetToSeg 的 block 子索引边界语义（childIndex k → 第 k 个子段的起点）；segText 实际 28 字符（trailing 段长 17）
- ⚠️ 浏览器目视确认（3081 → 论文 tab：选文本→新增高亮弹窗（选色/填理由→添加）、点高亮→操作条「改范围」→选新文本→范围迁移、跨段落选择提示）待用户操作

**本轮未做（属后续 Phase）**
- P2-e 审查完成信号（「本节审查完毕」按钮 + plan 状态闭环）、P2-f 全量回归 + 真实写冒烟（先备份 `paper.highlights.json`，git 可回滚）+ git 提交（工作区改动待 commit）

#### ✅ P2-e 完成记录（2026-08-27，验证通过）

**范围**：仅 Phase 2 的 P2-e（审查完成信号：节状态闭环 —— `/read` sections → GUI 节列表 + 「标记本节审查完毕」按钮 → POST `review_section` → 乐观更新 plan status「节旁 ✓」），未做 P2-f 及其它。

**交付**（git 工作区已落盘，未提交）
- `client/render-body.js`（扩展）：
  - 新增纯函数 `sectionList(sections, plan, overrides)`（过滤 paper_title + empty 节，合并 plan 审查状态与乐观 override，输出 `{id,title,anchor_id,reviewed,reviewed_at}`）与 `currentSectionId(sections, blockTops, scrollTop, viewportHeight)`（视口中线规则：最后一个锚块顶 ≤ 视口中线的可审查节为「当前节」，paper_title/empty 永不入选）
  - PaperView：新增 `sectionOverrides`（乐观节状态 map）+ `currentSection` 状态；`.phl-body` 挂 `onScroll`（从事件 target 读 scrollTop/clientHeight/children → 纯函数 `currentSectionId` 派生当前节，无需 ref、headless 可驱动）；头部工具栏新增「标记本节审查完毕」按钮（按当前节 POST `review_section`，乐观 ✓ → 服务端 entry 回填，失败回读校准）；legend 下方渲染节列表条（`phl-sections`：每节 chip 带 `data-phl-sec`，已审查 ✓ 高亮、当前节描边）；h1/h2/p 块元素增 `data-phl-anchor` 供滚动定位
- `scripts/gen-client.js`（扩展）：durable bundle 额外导出 `sectionList`/`currentSectionId`
- `client/client.js` / `dynamic/client-half.js`：重新生成
- `test/run-render.js`（扩展）：P2-e 纯函数矩阵 —— sectionList（过滤 paper_title/empty、plan 状态合并、override 优先、plan 兜底、null/空）、currentSectionId（中线下/深滚/顶部 null、paper_title 排除、缺块顶跳过、empty 排除）
- `scripts/simulate-render.js`（扩展）：mock 增 `review_section` 响应；P2-e 交互 —— 断言节条渲染数 = `sectionList(live)` 且每 chip 带节 id；伪造 DOM scroll target（均匀块顶）驱动 `onScroll` → 当前节与内嵌 `currentSectionId` 一致 + chip 高亮；点「标记本节审查完毕」→ 断言 POST `{action:'review_section', section:<current>}` → flush 后 chip 显示 done（✓）

**验证结果（2026-08-27）**
- 本地回归全绿：run-mock / run-tools / run-actions / run-plugin / run-render → 全部 PASS
- 端到端 `simulate-render.js`（live 3081 + POST mock）→ **SIMULATION PASS**：bundle 含 P2-a…P2-e 全部接线（新增 p2e 标记断言）；节条渲染 20 个可审查节（paper_title + empty References 剔除）、当前节高亮、review_section POST 命中当前节（s3）、chips 显示 done（✓）
- 调试中修正：harness 的期望 `currentSectionId` 需按组件约定用「内容坐标」块顶（`rect.top − base + scrollTop`），否则与组件计算不一致（s21 vs s3）
- ⚠️ 浏览器目视确认（3081 → 论文 tab：滚动切换当前节高亮、点「标记本节审查完毕」→ 节旁 ✓、刷新后节状态保留）待用户操作

**本轮未做（属后续 Phase）**
- P2-f 全量回归 + 真实写冒烟 + git 提交归档

#### ✅ P2-f 完成记录（2026-08-27，交付验收）

**范围**：Phase 2 收尾 —— 全量回归 + 真实写冒烟 + git 提交归档；同时记录 P2-d 人工目视留下的真实数据改动。

**P2-d 目视确认遗留**：用户浏览器走查 P2-d（选文本→新增高亮）在 3081 上执行了**真实 POST `add`**，已持久化 `s-006`（`a-0001-07-01[55,78)`，yellow，user_added）—— 这本身就是「真实写通路」的活体证明。`data/` 已被 git 跟踪，该改动随本次归档一起提交。

**真实写冒烟（2026-08-27，先备份后恢复）**
- 备份 `paper.highlights.json` → 对 live 3081 执行真实 POST：`review_section s5` → 200 `{ok:true, section:{id:s5,status:'reviewed',reviewed_at}}`，重读 `/read` 确认 `s5.plan.status='reviewed'`；`accept s-001` → 200，span 变 `accepted` 且 decisions 追加为 2 条，重读确认 → **恢复备份**（回到用户当前状态：6 spans、plan.sections 空、`s-006` 保留）。真实写通路（P2-a + host applyAction）端到端验证通过。

**回归全量（2026-08-27）**：run-mock / run-tools / run-actions / run-plugin / run-render → 全部 PASS；check-host / check-utf8 / verify-http → PASS（3081 现服务 6 spans，含用户 `s-006`）；simulate-render → **SIMULATION PASS**（P2-c accept/recolor + P2-d 新增/改范围 + P2-e 节状态闭环全链路，POST 全程 mock、真实数据零改动）。
- 修订：`test/run-plugin.js` 的「5 spans served」硬断言改为「原 5 条 demo span 仍在 + ≥5 条」（demo 数据现合法携带用户走查新增的 span，精确计数不再成立）。

**归档（git）**
- 提交信息：`v0.1.2: Phase 2 审查交互完成（P2-a…P2-f）+ 用户走查 s-006 落库`
- 标签：`v0.1.2`（Phase 2 快照；Phase 0/1 为 `v0.1.1`，v0.1 为 `v0.1`）
- 提交内容：`client/render-body.js`、`client/client.js`、`dynamic/client-half.js`、`scripts/gen-client.js`、`scripts/simulate-render.js`、`test/run-render.js`、`test/run-plugin.js`、`docs/paper-highlight-progress-v0.2.md`、`data/…/paper.highlights.json`（含 `s-006`）

**待人工验收（P2-f 收尾清单）**：3081 浏览器走查 —— 点高亮→操作条、接受/删除/改色/备注各一次、选文本→新增、改范围、标记本节完毕→刷新后节状态保留、References 空节不渲染。

### Phase 3 — Agent 技能 + 工具（~1.5–2 天）
- `packages/paper-highlight/skills/` 三份技能（落地时按 DSH preset 机制选型是否并入 system prompt）：
  1. `global-read.md`：两遍阅读第一遍 —— 论文地图（章节结构、核心主张清单、领域定位）+ `plan`（每节 expected_colors / density_hint / skip）→ 写 `paper.highlights.json.plan`。
  2. `propose.md`：输入 = 论文地图 + `read_section` 文本 + 已高亮主张清单 + 画像摘要（默认）→ 候选 spans（颜色 + rationale + 粒度）→ `write_highlights` append，`status='proposed'`。
  3. `reflect.md`：审查后差异分析 → 推断（改色规律 / 删除模式 / 粒度偏好）→ 画像更新提案（规则修正 + 示例入库 + 统计雏形）落盘 `reflections.json`。
- 新工具 `list_sections` / `read_section` 注册进 paper preset（沿用 `tools-plugin.mjs` 形态）。
- 测试：`test/run-tools.js` 扩展（新工具 lossless 断言 + append 模式回归）。

### Phase 4 — 差异分析支撑 + 去重规则（~1 天）
- 可选 host 辅助工具 `summarize_section_diff({section})`：输出该节 proposed→final 变更计数与样例（accepted/rejected/recolored/rescoped/added），降低 Agent 漏算概率、逻辑可单测。
- 去重提示词硬规则：主张已在已高亮清单/`duplicates` 中则默认跳过（除非画像规则声明「重复也标」）；Agent 把重复主张登记进 `duplicates`（只追加）。

### Phase 5 — 端到端验收（~1 天）
- 新增 `scripts/step6-e2e.js`（仿 step4-e2e.js 驱动模式）：
  - `session.create` → prompt「全局通读并给出计划，然后对 §1 提出高亮」→ 轮询回合 → 断言 `plan` 写入 + proposed spans 落盘；
  - 经 `POST /paper-hl/write` 模拟用户操作（改色 1 处、删除 1 处、新增 1 处）→ prompt「本节审查完毕」→ 轮询 → 断言 `reviewed` 标记 + `reflections.json` 提案与模拟操作对应；
  - 退出码 PASS/INCOMPLETE；真实数据用现有 `p-mikolov-2013-2013-1-word2vec`（不重复消耗 MinerU 额度）。
- 回归全量：run-mock / run-tools / run-plugin / verify-http / simulate-render。
- 人工验收路径：3081 浏览器 → 会话 →「论文」tab 走一遍完整审查（操作步骤文档化）。

### Phase 6 — 文档收尾（~0.5 天）
- 设计文档 §8 v0.2 标注完成 + §10 风险 #4 更新（#5 差异推断质量随 v0.3 关闭）；本进度文件追加实施记录；README 状态横幅更新。

## 7. 风险与对策

| 风险 | 对策 | 验证点 |
|---|---|---|
| 跨行/归一化破坏锚定（#4） | Phase 0 就近匹配 + 文本节点→anchor 映射表；span 校验拒绝越界区间 | simulate-render + run-plugin |
| 审查交互 UX（标注层与原文区分） | 操作条悬浮、半透明标注延续 v0.1 视觉；改色/新增即时反馈 | 人工目视验收 |
| 差异推断质量（#5） | 推断只产出提案不自动改规则；样例入库待 v0.3 确认机制兜底 | step6-e2e 断言提案合理性 |
| GUI 与 Agent 状态漂移 | 单一 JSON 契约 + 每次操作即时写盘 + 刷新即重读 | step6 全链路 |
| 提案格式与 v0.3 画像对齐 | reflections.json 字段对齐 4.3 四层（rules/exemplars/stats） | 设计评审 |

## 8. 当前状态 / 待办

- **状态**：Phase 0/1 已实现并端到端验证通过（见 §6 Phase 0/1 完成记录），已 git 提交并打 **`v0.1.1`** 标签归档（Phase 0/1 快照）；**Phase 2 全部完成（P2-a 写通路接线 → P2-b 交互状态 → P2-c 操作条 → P2-d 选择→新增/改范围 → P2-e 审查完成信号 → P2-f 全量回归+真实写冒烟），已 git 提交并打 `v0.1.2` 标签归档**（见 §6 各完成记录）。浏览器目视：P2-d 已由用户走查（并真实新增 `s-006` 落库）；P2-e/f 目视走查待用户。
- 待办（剩余）：Phase 3 Agent 技能+工具 → Phase 4 差异/去重 → Phase 5 step6-e2e 验收 → Phase 6 文档收尾。
- 已知 cosmetic：空 `## References` 节已在 Phase 0 渲染端忽略（✅ 已完成）；GUI 高亮层可审查（✅ P2-c/d 完成：操作条接受/删除/改色/备注 + 选文本新增/改范围；✅ P2-e 节完成信号完成：节列表条 + 「标记本节审查完毕」+ plan 状态闭环）。
- ⚠️ 环境纪律：**3081 = 会话 Web，Agent 不得自行 kill/restart**（见 §10 事故教训）。

## 9. v0.2 交付物清单（规划新增，随实施更新）

| 路径（规划） | 内容 | 状态 |
|---|---|---|
| `docs/paper-highlight-progress-v0.2.md` | 本进度文件 | ✅ 已建并维护 |
| `packages/paper-highlight/host/sections.js` | 节树构建 | ✅ 已实现（Phase 1） |
| `packages/paper-highlight/host/actions.js` | 审查动作纯逻辑 | ✅ 已实现（Phase 1） |
| `packages/paper-highlight/host/plugin.js`（扩展） | `POST /paper-hl/write` 审查写通路 + `/read` 返回 sections | ✅ 已实现（Phase 1） |
| `packages/paper-highlight/client/render-body.js`（扩展） | Phase 0 空节跳过 + span 钳制；P2-a 写通路纯函数；P2-b 状态模型；P2-c 操作条（`markStyle`/`reconcileSpan`/`renderText(opts)`/`applyAction` 乐观更新/悬浮操作条）；**P2-d 选择→新增/改范围（`buildBlockSegments`/`buildSegmentMap`/`mapSelection` 纯函数 + `nodeOffsetToSeg`/`blockChildToSeg`/`selectionToNorm` DOM 映射 + `renderText(withSegments)` data-phl-seg 包装 + 新增高亮弹窗/改范围按钮/onBodyMouseUp + `reconcileSpan` clientId 匹配）；P2-e 节状态闭环（`sectionList`/`currentSectionId` 纯函数 + 节列表条/「标记本节审查完毕」按钮/onBodyScroll 滚动定位/块 `data-phl-anchor` + 乐观 `sectionOverrides`）** | ✅ 已实现（Phase 0 + P2-a/b/c/d/e） |
| `packages/paper-highlight/scripts/gen-client.js`（扩展） | durable bundle 注入 `writeData` fetch POST 传输；**导出内嵌纯函数（buildBlocks/buildSegmentMap/mapSelection/selectionToNorm/nodeOffsetToSeg/sectionList/currentSectionId）供 headless 测试驱动**；dynamic 半体暂不接 write | ✅ 已实现（P2-a + P2-d/e 导出） |
| `packages/paper-highlight/host/tools.js`（扩展） | `list_sections` / `read_section` / write append 模式 | ⬜ 待实现（Phase 3） |
| `packages/paper-highlight/skills/global-read.md` 等 | 三份 Agent 技能 | ⬜ 待实现（Phase 3） |
| `packages/paper-highlight/scripts/step6-e2e.js` | v0.2 端到端验收驱动 | ⬜ 待实现（Phase 5） |
| `packages/paper-highlight/test/*`（扩展） | run-actions / run-render 新增；run-plugin / simulate-render 扩展（**P2-c 注入交互：点 mark→操作条、accept/recolor POST 载荷 + 本地渲染同步；P2-d 注入伪造 selection：新增高亮弹窗 + add/rescope POST 载荷断言 + 渲染同步；P2-e 节状态：节条渲染数 = 内嵌 sectionList + 伪造 scroll target 驱动 currentSectionId + review_section POST + done 状态**） | ✅ 已实现（Phase 0/1 + P2-a/b/c/d/e 回归全绿） |

---

## 10. 事故教训（2026-08-26 · 3081 重启事故）

**事故**：为加载新 host 代码而执行 `Stop-Process -Id 8696`，试图「重启 3081」——但 **8696 正是跑在 3081 上的 harness Web（承载当前会话 GUI 的进程）**，杀掉后 Web 停滞、会话中断。

**根因**：误判进程可丢弃性。本项目 paper profile 就跑在 3081，且当前会话 GUI 同样经 3081 访问（本会话 system prompt 声明 Web GUI 即 http://127.0.0.1:3081）——「服务」与「会话载体」是**同一个进程**，不存在独立可安全重启的 web 进程。

**纪律（后续必须遵守）**
1. **3081 = 会话 Web = Agent 不得自行 kill/restart**。host 代码变更后的重启一律由**用户手动执行**（`dsh --profile paper --port 3081 --no-open`），Agent 只做只读验证。
2. 任何疑似「重启服务」的操作前，先确认目标进程身份（`netstat -ano | findstr :3081` + 进程 cmdline），默认监听端口进程不可杀，除非用户明确授权。
3. 端到端 live 验证（simulate-render 等）依赖「新代码已生效的 3081」：代码改完、用户重启后，Agent 先做**只读 GET**（`/paper-hl/read` 是否返回 `sections`）确认新代码已加载，再跑 live 验证。

**影响**：无代码/数据损失（改动已落盘），仅会话 Web 短暂停滞（用户重启后恢复）；本次教训作为环境操作纪律永久记录于此。
