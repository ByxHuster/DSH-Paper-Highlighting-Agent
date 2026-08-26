# Paper Highlight Agent — v0.2 项目进度（审查闭环）

> 版本：v0.2（审查闭环）· 状态：**Phase 0/1 已实现，已归档 v0.1.1（审查闭环进行中）** · 最近更新：2026-08-26 —— Phase 0/1 交付 + 端到端验证通过 + 事故教训（§10）+ Phase 2 分步策略（§6）
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

- **状态**：Phase 0/1 已实现并端到端验证通过（见 §6 Phase 0/1 完成记录），已 git 提交并打 **`v0.1.1`** 标签归档（Phase 0/1 快照）；**下一步 = Phase 2（client 审查交互，分步策略见 §6 P2-a…P2-f）**。
- 待办（剩余）：Phase 2（P2-a…P2-f）→ Phase 3 Agent 技能+工具 → Phase 4 差异/去重 → Phase 5 step6-e2e 验收 → Phase 6 文档收尾。
- 已知 cosmetic：空 `## References` 节已在 Phase 0 渲染端忽略（✅ 已完成）；GUI 高亮层只读（Phase 2 改造为可审查）。
- ⚠️ 环境纪律：**3081 = 会话 Web，Agent 不得自行 kill/restart**（见 §10 事故教训）。

## 9. v0.2 交付物清单（规划新增，随实施更新）

| 路径（规划） | 内容 | 状态 |
|---|---|---|
| `docs/paper-highlight-progress-v0.2.md` | 本进度文件 | ✅ 已建并维护 |
| `packages/paper-highlight/host/sections.js` | 节树构建 | ✅ 已实现（Phase 1） |
| `packages/paper-highlight/host/actions.js` | 审查动作纯逻辑 | ✅ 已实现（Phase 1） |
| `packages/paper-highlight/host/plugin.js`（扩展） | `POST /paper-hl/write` 审查写通路 + `/read` 返回 sections | ✅ 已实现（Phase 1） |
| `packages/paper-highlight/client/render-body.js`（扩展） | Phase 0 空节跳过 + span 钳制 | ✅ 已实现（Phase 0）；审查交互 UI ⬜ 属 Phase 2 |
| `packages/paper-highlight/host/tools.js`（扩展） | `list_sections` / `read_section` / write append 模式 | ⬜ 待实现（Phase 3） |
| `packages/paper-highlight/skills/global-read.md` 等 | 三份 Agent 技能 | ⬜ 待实现（Phase 3） |
| `packages/paper-highlight/scripts/step6-e2e.js` | v0.2 端到端验收驱动 | ⬜ 待实现（Phase 5） |
| `packages/paper-highlight/test/*`（扩展） | run-actions / run-render 新增；run-plugin / simulate-render 扩展 | ✅ 已实现（Phase 0/1 回归全绿） |

---

## 10. 事故教训（2026-08-26 · 3081 重启事故）

**事故**：为加载新 host 代码而执行 `Stop-Process -Id 8696`，试图「重启 3081」——但 **8696 正是跑在 3081 上的 harness Web（承载当前会话 GUI 的进程）**，杀掉后 Web 停滞、会话中断。

**根因**：误判进程可丢弃性。本项目 paper profile 就跑在 3081，且当前会话 GUI 同样经 3081 访问（本会话 system prompt 声明 Web GUI 即 http://127.0.0.1:3081）——「服务」与「会话载体」是**同一个进程**，不存在独立可安全重启的 web 进程。

**纪律（后续必须遵守）**
1. **3081 = 会话 Web = Agent 不得自行 kill/restart**。host 代码变更后的重启一律由**用户手动执行**（`dsh --profile paper --port 3081 --no-open`），Agent 只做只读验证。
2. 任何疑似「重启服务」的操作前，先确认目标进程身份（`netstat -ano | findstr :3081` + 进程 cmdline），默认监听端口进程不可杀，除非用户明确授权。
3. 端到端 live 验证（simulate-render 等）依赖「新代码已生效的 3081」：代码改完、用户重启后，Agent 先做**只读 GET**（`/paper-hl/read` 是否返回 `sections`）确认新代码已加载，再跑 live 验证。

**影响**：无代码/数据损失（改动已落盘），仅会话 Web 短暂停滞（用户重启后恢复）；本次教训作为环境操作纪律永久记录于此。
