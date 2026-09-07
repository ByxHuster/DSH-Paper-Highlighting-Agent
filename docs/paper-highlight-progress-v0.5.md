# Paper Highlight Agent — v0.5.x 系列项目进度（合并版）

> 系列：v0.5 / v0.5.1 / v0.5.2 / v0.5.3 / v0.5.4 / v0.5.4.1 / v0.5.4.3 —— **全部完成并验收通过（2026-09-01）**，v0.5.x 系列开发完毕。
> 本文件由 `paper-highlight-progress-v0.5.md` 与 `paper-highlight-progress-v0.5.1/2/3/4.md` **合并**而来（各分文档已删除），内容为各版本开发记录全文（继承状态 / 决策 / 实施 / 验证 / 风险 / 命令 / 交付记录），按版本分节；每节含该版本当时的「继承基线」，可独立阅读。

---

## 系列速览（版本时间线）

| 版本 | 主题 | git tag | 状态 |
|---|---|---|---|
| v0.5.0 | 一键格式化（工厂重置）：`format_all` 工具 + `POST /paper-hl/format` + GUI 确认对话框 | `v0.5.0` | ✅ 归档 |
| v0.5.1 | 图例彩色语义 + 轻量公式渲染（**公式渲染已由 v0.5.3 回滚移除**，仅图例彩色保留） | `v0.5.1` | ✅ 归档 |
| v0.5.2 | 章节目录一键审批（`approve_section`，含「无高亮也通过」；+同日公式灰块热修复） | `v0.5.2` | ✅ 归档 |
| v0.5.3 | 放弃数学渲染 + 一键审批「反选」（`revert_section` = **批量恢复待审**，非否决）+ 画像面板空白/无法返回修复 | `v0.5.3` | ✅ 归档 |
| v0.5.4 | 格式化后「重新提出高亮」按钮（`propose-request` 路由，记录请求 + 复制指令） | `v0.5.4` | ✅ 归档 |
| v0.5.4.1 | 顶端导航栏固定（`.phl-top` sticky 控制条组；含浅色磨砂配色修正，代码注释标 v0.5.4.2） | `v0.5.4.1` | ✅ 归档 |
| v0.5.4.3 | 移除「标记本节审查完毕」按钮 + Ctrl+Enter 快捷键（由章节标签点击取代） | `v0.5.4.3` | ✅ 归档 |

> 注意：无独立的 `v0.5.4.2` 标签 —— 顶栏配色修正（浅色磨砂）随 amend 并入 `v0.5.4.1`（代码注释中记为 v0.5.4.2）。

---

## 关联文档（合并版）

| 文档 | 路径 | 用途 |
|---|---|---|
| 设计文档 | `D:\aa\docs\paper-highlight-agent-design.md` | §4 数据模型、§6 画像防污染、§9 目录结构 |
| 一页纸快照 | `D:\aa\docs\paper-highlight-one-pager.md` | 项目状态速览（v0.5.x 已同步） |
| 用户指南 | `D:\aa\docs\paper-highlight-user-guide.md` | 面向使用者的功能说明与 FAQ |
| 插件 README | `D:\aa\packages\paper-highlight\README.md` | 版本历史与能力摘要 |
| 早期进度归档 | `D:\aa\docs\paper-highlight-progress-v0.1/0.2/0.3/0.4.md` | 各早期版本交付记录 |
| 本文档 | `D:\aa\docs\paper-highlight-progress-v0.5.md` | **v0.5.x 系列开发进度（合并版，本文件）** |

---
## v0.5 · 一键格式化（工厂重置）


> 版本：v0.5（一键格式化）· 状态：**Phase 0 完成 + live 验证 PASS（已归档 `v0.5.0`）** · 创建：2026-08-27 · 最近更新：2026-08-31

---

### 1. 项目定位与 v0.5 目标

- **项目一句话**：在 DeepSeek Harness（DSH）之上构建单论文多色高亮 Agent —— 用户提供论文 PDF → MinerU 云 API 解析为结构化 Markdown → `dsh web`（paper profile, 3081）GUI 整体渲染 → Agent 依据「论文整体认识 + 领域发展线 + 用户画像」逐节提出语义高亮 → 用户审查修改 → 画像持续学习 → **导出**。
- **v0.1（已完成，归档）**：管线打通 —— PDF → MinerU → `data/<paper_id>/` 归一化产物 → Agent 工具读写高亮 JSON → GUI 渲染正文 + 显示 spans。
- **v0.2（已完成，归档 `v0.2.0`）**：审查闭环 —— 「全局通读 → 逐节 propose → GUI 审查 → 差异分析/章节反思（reflections.json 提案）→ 下一节」核心循环全链路跑通。
- **v0.3（已完成，归档 `v0.3.0`）**：个性化画像收敛 —— 四层画像 + 冷启动 + 摘要注入 + 确认生效机制，三篇同领域论文收敛验收 PASS。
- **v0.4（已完成，归档 `v0.4.0`）**：打磨导出 —— HTML/MD 导出 + 领域地图 `field-map.md` + 论文级反思 + UX（快捷键/进度条/导出对话框）。
- **v0.5 目标**：一键格式化（工厂重置）—— 一个动作清空「所有论文高亮记录 + 个性化画像」，让整个工作区回到开箱即用的初始状态，用于换新课题 / 转交他人 / 重新开始学习。

### 3. v0.4 继承状态（独立使用必需）

#### 3.1 运行环境
- Windows；harness `dsh web`（port 3080，profile `web`）；**paper profile 独立跑 3081**
- paper profile 启动：`dsh --profile paper --port 3081 --no-open`（后台 job；`prepareProfile` 会重写 profile/cordis.yml，启动需 danger-full-access）
- DSH 安装：`C:\Users\eyx\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh`；profiles：`C:\Users\eyx\.dsh\profiles\`
- 环境变量：`MINERU_API`（已 setx，len=51）；`MINERU_BASE_URL`、`MINERU_UPLOAD_MODE=file|url`、`MINERU_OCR=1`、`MINERU_FORMULA=1`、`MINERU_LANGUAGE`
- 沙箱：`D:\aa` 内写入免授权；工作区外需 danger-full-access 一次性升级 + 用户批准；npm 用 `npm --cache D:\aa\.npm-cache`

#### 3.2 关键路径与交付物（v0.4 已就绪，勿重复造）
- git：**tag `v0.4.0`**（打磨导出交付），工作区 clean
- 插件包 `D:\aa\packages\paper-highlight/`：
  - `host/`：`schema.js` / `store.js` / `mineru.js` / `normalize.js` / `pipeline.js` / `plugin.js`（`/paper-hl` 路由矩阵）/ `sections.js` / `actions.js` / `diff.js` / **`profile.js`（v0.3 画像四层）** / **`export.js`（v0.4 导出）** / **`reflection.js`（v0.4 论文级反思）** / `tools.js` + `tools-plugin.mjs`（**11 工具**，`allTools()` 自动注册）
  - `client/`：`render-body.js`（渲染逻辑单一来源，含 P2-a…e + colorLegend/callProfile/冷启动引导/画像面板/提案面板/导出对话框/快捷键/进度条）、`client.js`（durable bundle，ModuleLoader 格式）
  - `dynamic/`：`client-half.js` / `host-half.js`（动态双半体备用）
  - `skills/`：三份技能 `global-read.md` / `propose.md` / `reflect.md`
  - `scripts/`：`gen-client.js`、`simulate-render.js`、`verify-http.js`、`check-host.js`、`check-utf8.js`、`seed-demo.js`、`step4-e2e.js`、`step5-acceptance.js`、`step6-e2e.js`、**`step7-multi-paper.js` / `profile-stats.js`（v0.3）**、**`step8-export-e2e.js`（v0.4）**
  - `test/`：`run-mock.js` / `run-tools.js` / `run-actions.js` / `run-plugin.js` / `run-render.js` / **`run-profile.js`（v0.3）** / **`run-export.js` / `run-reflect-paper.js`（v0.4）** / `run-real.js` + `verify.js` + fixtures
- 画像存储：**`D:\aa\highlight-profile/`**（`colors.yml` + `rules.json` + `exemplars.json` + `stats.json` + `reflection-notes.md`）
- 论文数据：**`D:\aa\data/<paper_id>/`**（`paper.md` + `anchors.json` + `meta.json` + `paper.highlights.json` + `reflections.json` + `paper-reflection.md` + `export/`）

#### 3.3 环境纪律（沿用 §3.4，勿破坏）
1. **3081 = 会话 Web**：Agent **不得自行 kill/restart**；需要重启时由用户操作，重启后刷新页面。
2. host 代码变更（plugin/format/tools）后，live 3081 需**用户手动重启**才生效；client 变更（render-body/gen-client → 重新生成 bundle）刷新页面即生效（bundle 按请求从磁盘读取）。
3. 沙箱：`D:\aa` 内写入免授权；工作区外需 danger-full-access 一次性升级 + 用户批准。
4. npm：`npm --cache D:\aa\.npm-cache`。
5. 工单纪律：`node scripts/gen-client.js` 在修改 `client/render-body.js` / `scripts/gen-client.js` 后**必须重跑**，否则 bundle 与单一来源不一致。

### 4. v0.5 目标与已锁定决策

#### 4.1 目标（D1）
一键格式化：在 GUI 顶部工具栏提供「**格式化**」危险按钮 → 弹出确认对话框 → 用户确认后清除：
1. **所有论文高亮记录**（`data/<paper_id>/` 内）：
   - `paper.highlights.json` → 重置为空白骨架（**保留** `paper` 元信息 + `anchors` 锚点，清空 `plan` / `spans` / `duplicates`）；
   - `reflections.json`（逐篇反思提案）、`export/`（导出产物）、`paper-reflection.md`（论文级反思）→ 删除；
   - **保留** `paper.md` / `anchors.json` / `meta.json` —— 已解析论文正文不丢，可立即重新 propose。
2. **个性化画像**（`highlight-profile/`）：整个目录删除 → GUI 回到冷启动引导。

#### 4.2 已锁定决策（D1–D4）
- **D1（scope）**：支持 `all`（默认）/ `highlights` / `profile` 三种范围 —— `format_all` 工具与 `/paper-hl/format` 路由均可选；GUI 一键固定走 `all`。
- **D2（确认门禁）**：破坏性操作必须显式 `confirm: true`（路由 body / 工具参数），否则 400 / `ok:false` —— 杜绝 GET 预取或误触导致的清空。
- **D3（保留论文正文）**：`paper.md` / `anchors.json` / `meta.json` 永不删除 ——「格式化」清的是高亮与画像，不是论文本身。
- **D4（审计回报）**：格式化响应返回逐项清空计数（`papers_processed` / `spans_cleared` / `plans_cleared` / `duplicates_cleared` / `reflections_removed` / `exports_removed` / `paper_reflections_removed` / `profile_removed` / `rules_cleared` / `exemplars_cleared`），不额外生成备份文件（用户要的就是清空；响应即审计记录）。

### 5. 实施步骤与验证方法

#### Phase 0 —— 一键格式化全链路（`format_all` 工具 + `/paper-hl/format` 路由 + GUI 对话框）
1. **`host/format.js`（纯逻辑，新增）**：
   - `normalizeScope(scope)` → `'all'|'highlights'|'profile'`（默认 all，未知值抛错）；
   - `formatHighlights(highlights)` **纯函数**：保留 `paper` + `anchors`，重置 `plan`/`spans`/`duplicates`（输出过 `validateHighlights`）；
   - `formatAll(root, {confirm, scope})` 异步编排：`confirm!==true` 抛错；按 scope 遍历 `data/` 重置/删除 + 删除 `highlight-profile/`（先直读 `rules.json`/`exemplars.json` 计数，避免 `ensureProfile` 副作用）；返回审计统计。
2. **`host/plugin.js`（路由）**：`POST /paper-hl/format`，body `{confirm:true, scope?}` → 200 + 审计统计；缺 confirm / 坏 JSON / 未知 scope → 400；GET → 404（仅 POST，防预取）。
3. **`host/tools.js`（工具）**：`format_all`（confirm 必填，scope/root 可选，执行时 `confirm!==true` → `ok:false`）；经 `allTools()` 自动注册（12 工具）。
4. **`client/render-body.js` + `scripts/gen-client.js`（GUI）**：
   - `callFormat(payload, transport)` 纯数据函数（POST `/paper-hl/format`，body `{confirm:true, scope}`）；
   - 顶部工具栏「格式化」按钮（危险样式）→ 对话框（`phl-fmt`）：警告文案 + 清除清单 + 「取消 / 确认格式化」（`phl-fmt-danger`）；确认 → `callFormat({confirm:true, scope:'all'})` → 成功后 flash + `loadProfile()` + `load()` 回到冷启动；
   - 快捷键 `Esc`（cancel 分支）同时关闭格式化对话框；`gen-client.js` 增加 `formatData` 传输 + `exports.callFormat`，**重跑生成 bundle**。
5. **测试**：
   - `test/run-format.js`（新）：纯逻辑 + 路由矩阵（`normalizeScope` / `formatHighlights` / confirm 门禁 / 三种 scope 的磁盘断言：spans 清零、reflections/export/paper-reflection 删除、论文正文保留、画像目录删除或保留）；
   - `test/run-plugin.js`（扩展）：`/paper-hl/format` 路由矩阵（GET 404 / 缺 confirm 400 / 坏 JSON 400 / 未知 scope 400 / confirm:true 200 + 审计 + 磁盘重置）；
   - `test/run-tools.js`（扩展）：`format_all` 工具（defineTool 转换 required / confirm 门禁 ok:false / 未知 scope ok:false / confirm:true 清空 + lossless）；
   - `test/run-render.js`（扩展）：`callFormat`（ok 解析 / ok:false 拒绝 / 无传输拒绝 + body `{confirm:true, scope}`）；
   - `scripts/simulate-render.js`（扩展 P5）：格式化按钮 → 对话框（警告 + 清单）→ 取消不 POST / 确认 POST `{confirm:true, scope:"all"}` → 对话框关闭 + 回到冷启动引导（profile mock 翻 false）。

#### 验收方法（M1）
- ✅ `test/run-format.js` PASS（纯逻辑 + 路由矩阵 + 磁盘断言）
- ✅ `test/run-plugin.js` / `run-tools.js` / `run-render.js` 扩展 PASS
- ✅ `scripts/simulate-render.js` P5 交互 PASS（真实 3081 只读数据通路，POST 全 mock，真实数据零改动）
- ✅ `node scripts/gen-client.js` 重新生成 bundle（client.js / client-half.js），check-utf8 PASS
- ✅ **live 3081 冒烟 PASS（2026-08-31，用户重启后）**：
  - `POST /paper-hl/format`（无 confirm）→ **400** `{ok:false,error:'format requires confirm: true (destructive operation)'}`（confirm 门禁生效）；
  - `POST /paper-hl/format`（confirm:true + 未知 scope 'nuke'）→ **400** `{ok:false,error:'format: unsupported scope "nuke"…'}`（scope 校验生效）；
  - **用户实跑格式化**：三篇论文 `paper.highlights.json` 全部重置（0 spans / 0 plan / 0 duplicates），`reflections.json` / `export/` / `paper-reflection.md` 全部删除，`paper.md` / `anchors.json` / `meta.json` 保留，`highlight-profile/` 被删除后经冷启动 init 重建（2 条默认规则 + 0 示例 + 0 统计）—— 全链路行为与设计完全一致 ✅

### 6. 风险

| # | 风险 | 缓解 |
|---|---|---|
| 1 | **格式化误触清空真实数据** | POST 专属路由（GET 404）+ 必须 `confirm:true` + GUI 二次确认对话框（危险样式 + 不可撤销提示） |
| 2 | 格式化误删论文正文 | D3：`formatAll` 只触碰 `paper.highlights.json`/`reflections.json`/`export/`/`paper-reflection.md` 与 `highlight-profile/`，`paper.md`/`anchors.json`/`meta.json` 永不删除（测试有磁盘断言） |
| 3 | `ensureProfile` 副作用在格式化时重建画像 | `countProfileLayers` 直读 `rules.json`/`exemplars.json` 计数，不调用 `readProfile`（会 ensure 创建缺失层） |
| 4 | host 代码未重启导致 GUI 点「格式化」404 | 环境纪律：host 变更由用户重启 3081；verify-http 用「无 confirm → 400」安全探针区分新旧 host |
| 5 | 测试误删真实数据 | 全部 fixture 在 `test/.tmp/`（gitignored）；simulate-render 的 format POST 走 mock，真实数据零改动 |

### 7. 命令速查（v0.5）

```powershell
$env:NODE_PATH = 'C:\Users\eyx\.dsh\profiles\node_modules'   # fflate 解析
node test/run-format.js          # v0.5 一键格式化纯逻辑 + 路由矩阵
node test/run-plugin.js && node test/run-tools.js && node test/run-render.js   # 扩展回归
node scripts/gen-client.js       # 改 render-body.js / gen-client.js 后必须重跑
node scripts/simulate-render.js  # live 3081，含 P5 格式化交互（POST mock，真实数据零改动）
node scripts/verify-http.js      # 路由自检（含 format 安全探针）
node scripts/check-host.js && node scripts/check-utf8.js
```

### 8. 交付记录（v0.5.0 已归档）

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 | 一键格式化全链路完成 + live 验证 PASS | ✅ `host/format.js`（纯逻辑 + 三 scope + confirm 门禁）+ `POST /paper-hl/format` 路由（GET 404 / 缺 confirm 400 / 未知 scope 400）+ `format_all` 工具（12 工具）+ GUI 格式化按钮 + 确认对话框 + `callFormat` 传输 + `run-format.js` PASS + run-plugin/run-tools/run-render 扩展 PASS + simulate-render P5 交互 PASS + gen-client 重跑 + check-utf8 PASS + **live 3081 冒烟 PASS（用户重启后：无 confirm → 400 / 未知 scope → 400；用户实跑格式化，磁盘状态与设计完全一致）** → **归档 `v0.5.0`（2026-08-31）** |



---

## v0.5.1 · 图例彩色语义 + 轻量公式渲染


> 版本：v0.5.1（两个小改动：①图例高亮语义彩色显示 ②内联/行间公式轻量渲染）· 状态：**Phase 0 完成 + 离线测试 PASS + live bundle 验证（已归档 `v0.5.1`）** · 创建：2026-08-31 · 最近更新：2026-08-31
> **⚠️ 已被 v0.5.3 取代**：本版本②的**轻量公式渲染已于 v0.5.3 移除**（回滚至 v0.5.0 纯文本渲染，正文按原文显示）；**①图例彩色语义保留**。本文件仅作历史归档。

---

### 1. 项目定位与 v0.5.1 目标

- **项目一句话**：在 DeepSeek Harness（DSH）之上构建单论文多色高亮 Agent —— 用户提供论文 PDF → MinerU 云 API 解析为结构化 Markdown → `dsh web`（paper profile, 3081）GUI 整体渲染 → Agent 依据「论文整体认识 + 领域发展线 + 用户画像」逐节提出语义高亮 → 用户审查修改 → 画像持续学习 → **导出**。
- **v0.1–v0.5（已完成，归档 `v0.5.0`）**：管线打通 → 审查闭环 → 画像收敛 → 打磨导出 → 一键格式化（工厂重置）。
- **v0.5.1 目标（两个小改动）**：
  1. **图例高亮语义彩色显示**：把页面上「核心洞见/贡献 / 关键定义/方法 / 局限/风险 / 可借鉴/启发 / 待深挖/存疑」这几个高亮语义标签，用**对应的彩色**显示（原来只显示色块、文字是灰色）。
  2. **轻量公式渲染**：用**轻量化方法**（无外部依赖，不引入 KaTeX/MathJax）在 web 中渲染**内联/行间公式** —— 兼容 `$…$` / `$$…$$` / `\(…\)` / `\[…\]` 定界符，也处理 MinerU 归一化留下的**裸 LaTeX 片段**（如 `N \times D`、`l o g _ { 2 } ( V )`、`\mathbf { f }`、`{ - }`）。

### 3. v0.5 继承状态（独立使用必需）

#### 3.1 运行环境
- Windows；harness `dsh web`（port 3080，profile `web`）；**paper profile 独立跑 3081**
- paper profile 启动：`dsh --profile paper --port 3081 --no-open`（后台 job；`prepareProfile` 会重写 profile/cordis.yml，启动需 danger-full-access）
- 沙箱：`D:\aa` 内写入免授权；工作区外需 danger-full-access 一次性升级 + 用户批准

#### 3.2 关键路径与交付物（v0.5 已就绪，勿重复造）
- git：**tag `v0.5.0`**（一键格式化交付），工作区 clean（本版本改动前）
- 插件包 `D:\aa\packages\paper-highlight/`：
  - `host/`：`schema.js` / `store.js` / `mineru.js` / `normalize.js` / `pipeline.js` / `plugin.js`（`/paper-hl` 路由矩阵，含 `POST /format`）/ `sections.js` / `actions.js` / `diff.js` / `profile.js` / `export.js` / `reflection.js` / **`format.js`（v0.5）** / `tools.js` + `tools-plugin.mjs`（**12 工具**）
  - `client/`：`render-body.js`（渲染逻辑单一来源）、`client.js`（durable bundle）、`dynamic/client-half.js`
  - `scripts/`：`gen-client.js` / `simulate-render.js` / `verify-http.js` / `check-host.js` / `check-utf8.js` 等
  - `test/`：`run-mock.js` / `run-tools.js` / `run-actions.js` / `run-plugin.js` / `run-render.js` / `run-profile.js` / `run-export.js` / `run-reflect-paper.js` / **`run-format.js`（v0.5）**
- 画像存储：`D:\aa\highlight-profile/`（v0.5 格式化后为**冷启动默认**：2 条默认规则 + 0 示例 + 0 统计）
- 论文数据：`D:\aa\data/<paper_id>/`（v0.5 格式化后高亮已清空：0 spans / 0 plan / 0 duplicates；`paper.md`/`anchors.json`/`meta.json` 保留）

#### 3.3 环境纪律（沿用 §3.3，勿破坏）
1. **3081 = 会话 Web**：Agent **不得自行 kill/restart**；需要重启时由用户操作。
2. host 代码变更后 live 3081 需**用户手动重启**才生效；client 变更（render-body/gen-client → 重新生成 bundle）刷新页面即生效（bundle 按请求从磁盘读取）。
3. 工单纪律：修改 `client/render-body.js` / `scripts/gen-client.js` 后**必须重跑** `node scripts/gen-client.js`。

### 4. v0.5.1 目标与已锁定决策

#### 4.1 目标（D1）
1. **图例彩色语义**：论文视图顶部图例的五个语义标签文字，直接渲染为各自高亮色（红色标签文字 = 红色高亮色等），视觉上一眼对应；保留原有色块。
2. **轻量公式渲染**：正文中的公式片段渲染为「衬线斜体 + 浅蓝底」的公式样式；支持显式定界符（内联 `$…$` / `\(…\)`，行间 `$$…$$` / `\[…\]`）与裸 LaTeX 片段（命令 / 上下标 / OCR 花括号噪声）。

#### 4.2 已锁定决策（D2–D6）
- **D2（轻量零依赖）**：**不引入 KaTeX / MathJax / 任何外部资源** —— 用纯函数分词器 + Unicode 符号 / 组合附加符 / CSS 样式实现；未知命令原样保留（绝不丢信息）。
- **D3（选区精确性优先）**：每个数学片段独立成一个 segment（`buildBlockSegments` / `renderText` 同步细分），数学 span 携带 `data-phl-dlen`（显示长度），`nodeOffsetToSeg` 把「显示偏移 ≥ 显示末」映射回原始 LaTeX 范围 —— 整段选中的数学 token 范围**精确**；部分选中按原始范围夹取。**非数学锚点的 segment 布局与 v0.5.0 完全一致**（回归守卫测试）。
- **D4（不破坏渲染主干）**：数学转换只发生在「普通文本段」（非 `<mark>` 高亮内）—— 高亮 span 仍是单一 segment、内容为原始文本，mark 的映射与渲染逻辑零改动；无数学的文本段仍输出单个文本节点。
- **D5（公式定界符兼容）**：`$$…$$` / `\[…\]` 渲染为块级（`.phl-math-display`，居中）；`$…$` 要求内容含 LaTeX 线索（`\` / `_` / `^` / `{`）才当作公式，避免吞掉美元金额之类的普通文本。
- **D6（导出保持原始文本）**：本版本公式渲染仅作用于 **GUI web 渲染**；`export.js` 导出 HTML/MD 仍输出原始文本（避免把 Unicode 转换写进分享产物，影响复制 LaTeX）。导出与 GUI 的差异记录在用户指南 FAQ。

#### 4.3 覆盖的转换（`mathConvert`）
- 希腊字母：`\alpha` α … `\Omega` Ω（大小写全表）；
- 运算符/关系符：`\times` ×、`\cdot` ·、`\pm` ±、`\le/ge/ne/approx/equiv/in/subset/cup/cap/forall/exists/infty/partial/nabla/to/rightarrow/sum/prod/int/ldots/prime/degree/sqrt/perp` 等；
- 加粗/正体/斜体：`\mathbf{x}` → **𝐱**（Unicode 数学粗体）、`\mathrm{...}` / `\mathit{...}` / `\text{...}` 去命令保留内容；旧式字体开关 `\bf/\rm/\it/\tt/\cal` 静默消失；
- 附加符：`\bar{x}` x̄、`\hat{x}` x̂、`\tilde{x}` x̃、`\dot{x}` ẋ、`\acute{x}` x́、`\vec{x}` x⃗、`\overline{x}` x̅（组合附加符 U+0300–0305 / U+20D7）；
- 分数：`\frac{a}{b}` → `a⁄b`（分数斜线 U+2044）；
- 上下标：`_ { 2 }` → ₂、`x^2` → x²、`^ { n }` → ⁿ（Unicode 上下标映射表；未映射字符回退原字符）；
- OCR 噪声：`{ - }` → `-`、`{ 2 }` → `2`（单字符花括号收拢）；
- 未知命令原样保留；`$$E=mc^2$$` 之类定界符剥离后转换。

### 5. 实施步骤与验证方法

#### Phase 0 —— 图例彩色语义 + 轻量公式渲染（纯 client 变更）
1. **`client/render-body.js`（纯函数，新增）**：
   - `MATH_SYMBOLS` / `SUP_MAP` / `SUB_MAP`（符号表）+ `mapScript` / `supScript` / `subScript` / `boldMath`（**注意：数学粗体必须用 `String.fromCodePoint`，`fromCharCode` 会 16 位截断 → U+1D41F 变 Hangul，测试捕获此 bug**）；
   - `mathClean`（递归转换）→ `mathConvert`（先剥离定界符再转换）；
   - `matchMathDelim`（`$$`/`\[…\]`/`$…$`/`\(…\)`）+ `matchMathToken`（命令 / `_ { }` / `^ { }` / OCR 花括号）+ `splitMathPieces(text)` → `[{start,end,math,display,block?}]` 覆盖整个文本；
   - `mathPieceEl`（一个数学片段的 React 元素：`className:'phl-math'[ + ' phl-math-display']` + `title`=原始 LaTeX（悬停可见）+ `data-phl-seg`/`data-phl-dlen`）。
2. **`renderText` 改造**：普通文本段按 `splitMathPieces` 细分逐段输出（无数学 → 单文本节点，输出与 v0.5.0 逐字节一致）；`!spans` 分支与 gap/tail 分支统一走 `emitPlain`。
3. **`buildBlockSegments` 改造**：普通段同样按 `splitMathPieces` 细分（`pushPlainSegs`），保证 segment map 与 renderText 节点**一一对齐**。
4. **`nodeOffsetToSeg` 改造**：数学 span 的 `data-phl-dlen < 原始长度` 时，显示偏移 ≥ dlen → 原始末；部分偏移按原始范围夹取（非数学段行为不变）。
5. **图例改造**：`legend` 中语义标签从纯文本改为 `<span className="phl-legend-label" style={{color:l.color}}>`（文字 = 对应高亮色）+ CSS `.phl-legend-label{white-space:nowrap;font-weight:600}`。
6. **CSS**：`.phl-math{font-family:Georgia,serif;font-style:italic;…浅蓝底}`、`.phl-math-display{display:block;text-align:center;…}`。
7. **`scripts/gen-client.js`**：bundle 导出新增 `exports.MATH_SYMBOLS / supScript / subScript / boldMath / mathClean / mathConvert / splitMathPieces`（供无头测试）；**重跑生成 bundle**。

#### 验收方法（M1）
- ✅ `test/run-render.js` 扩展 PASS：Unicode 转换器（supScript/subScript/boldMath/MATH_SYMBOLS）+ `mathConvert` 矩阵（`\times`/`\mathbf`/`\bar`/`\frac`/`\sqrt`/上下标/OCR `{ - }`/未知命令保留/定界符剥离）+ `splitMathPieces`（连续覆盖、math 标志、`$$` 块公式、无数学透传）+ `renderText` 数学 span（seg/dlen）+ segment 对齐（含 mark 覆盖数学 token 的情形）+ `nodeOffsetToSeg` 原始末映射 + **非数学锚点 segment 布局与 v0.5.0 一致回归守卫**。
- ✅ `node scripts/gen-client.js` 重新生成 bundle（client.js / client-half.js），`node --check` 语法 OK；bundle 内含 `phl-math` / `phl-legend-label` / `data-phl-dlen`。
- ✅ **live 3081 bundle 验证（2026-08-31）**：`GET /plugins/paper-highlight/client.js` → 200，内容含 `phl-math` / `phl-legend-label`（**刷新页面即生效**）。
- ✅ **真实数据只读探针（p-mikolov 正文）**：`splitMathPieces` 在真实锚点上检出并转换：`1 { - } 0 \mathbf { f } { - } V coding` → `- | 𝐟 - | ×`；`N \times D \times H` → `× … ×`；`l o g _ { 2 } ( V )` → `₂`；`\bar { U }` → `Ū`；未知 `\bf` 保留（OCR 打散的 `{ \bf g 0 }` 不动）。
- ✅ 离线回归：`test/run-tools.js` / `test/run-format.js` PASS（host 未改动）。

> ⚠️ **已知（非本版本回归）**：v0.5 用户实跑格式化后，三篇论文高亮已清空（0 spans）+ 画像回到冷启动默认 —— 依赖**演示数据非空**的 `scripts/simulate-render.js`（断言 `expectedSpans > 0`）与 `test/run-plugin.js` 第 2 步（断言原始 5 条演示 span `s-001…s-005` 仍在）当前会失败；重新 propose 出新高亮后自动恢复。这不是代码缺陷，是格式化清空数据的预期结果。

#### 5.1 热修复（2026-08-31，同日内）：空白页 → `pushPlainSegs is not defined`
- **现象**：v0.5.1 首次归档后 web 页面渲染**空白**（PaperView 崩溃）。
- **根因**：`buildBlockSegments` 改造后调用 `pushPlainSegs`，但 BODY 嵌入清单漏嵌 `${pushPlainSegs.toString()}` —— 模块级 require 测试能过（模块作用域有该函数），**bundle 里没有** → 渲染时 `ReferenceError` → 整个论文视图崩溃 → 空白页。`scripts/simulate-render.js` 运行到 `buildSegmentMap` 渲染时当场复现 `pushPlainSegs is not defined`。
- **修复**：把 `${pushPlainSegs.toString()}` 加入 BODY 嵌入；重跑 `gen-client.js`（bundle 含 `function pushPlainSegs`）→ live 3081 按请求从磁盘读到修复 bundle，**刷新页面即恢复**。
- **回归守卫（防止再犯）**：
  - `test/run-render.js` 新增 **bundle 嵌入完备性守卫**：逐一断言 38 个纯函数 helper 的 `function <name>(` 都出现在 `BODY` 中（任何缺失 toString 嵌入 → 离线测试直接失败）；
  - `scripts/simulate-render.js` 新增 **v0.5.1 bundle 静态守卫**（`splitMathPieces`/`mathConvert`/`mathClean`/`MATH_SYMBOLS`/`mathPieceEl`/`data-phl-dlen`/`phl-math`/`phl-legend-label`/`phl-math-display`）—— 渲染前对 bundle 源码做包含检查，**不依赖演示数据非空**也能抓到同类缺失；P2-d 静态检查清单补充 `pushPlainSegs`。
- **验证**：`run-render.js` PASS（含嵌入完备性守卫）；`simulate-render.js` 越过该点直到唯一的空数据断言（`spans got 0`，已知）；293 个真实锚点 `renderText` 全渲染成功（0 错误、407 个数学 span）；live bundle 含 `pushPlainSegs` → **空白页修复**。v0.5.1 标签移到修复提交。

### 6. 风险

| # | 风险 | 缓解 |
|---|---|---|
| 1 | 数学转换破坏选区映射（新增/改范围偏移错位） | D3：数学片段独立 segment + `data-phl-dlen` 显示末→原始末映射；非数学段行为零变化（回归守卫测试断言 v0.5.0 布局）；无数学的锚点逐字节一致 |
| 2 | 引入外部渲染库 / 网络资源 | D2：零依赖纯函数 + Unicode + CSS；不引入 KaTeX/MathJax，无网络请求 |
| 3 | 误伤普通英文文本（`_`、`{…}`、`\` 等） | 仅匹配 `\command` / `_ { }` / `^ { }` / 单字符花括号（OCR 噪声特征）；未知命令原样保留；`$…$` 需含 LaTeX 线索才转换 |
| 4 | `String.fromCharCode` 16 位截断（粗体字母变 Hangul） | 改用 `String.fromCodePoint`；测试断言 codepoint |
| 5 | 导出与 GUI 公式显示不一致 | D6：导出保留原始文本（可复制 LaTeX）；用户指南 FAQ 说明差异 |
| 6 | bundle 与单一来源不一致 | 环境纪律 §3.3：改 render-body/gen-client 后必须重跑 `gen-client.js`；已重跑 + `node --check` |

### 7. 命令速查（v0.5.1）

```powershell
$env:NODE_PATH = 'C:\Users\eyx\.dsh\profiles\node_modules'   # fflate 解析
node scripts/gen-client.js       # 改 render-body.js / gen-client.js 后必须重跑
node --check client/client.js    # bundle 语法检查
node test/run-render.js          # v0.5.1 数学渲染 + 图例/选区回归（PASS）
node test/run-tools.js && node test/run-format.js   # host 回归（PASS）
node scripts/verify-http.js      # 路由自检（含 format 安全探针）
node scripts/simulate-render.js  # live 3081 —— 当前需演示数据非空（格式化后待重新 propose）
```

### 8. 交付记录（v0.5.1 已归档）

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 | 图例彩色语义 + 轻量公式渲染完成 + 离线测试 PASS + live bundle 验证 | ✅ `render-body.js`（`MATH_SYMBOLS`/`supScript`/`subScript`/`boldMath`/`mathClean`/`mathConvert`/`matchMathDelim`/`matchMathToken`/`splitMathPieces`/`mathPieceEl` 纯函数 + `renderText`/`buildBlockSegments`/`nodeOffsetToSeg` 改造 + 图例标签彩色 + `.phl-math*` CSS）+ `gen-client.js`（新 exports）+ `run-render.js`（v0.5.1 数学矩阵 + 选区/布局回归守卫）PASS + gen-client 重跑 + `node --check` OK + **live 3081 bundle 验证 PASS（`/plugins/paper-highlight/client.js` 含 `phl-math`/`phl-legend-label`，刷新即生效）** + 真实数据只读探针 PASS（`\times`→×、`_ { 2 }`→₂、`\bar{U}`→Ū、OCR `{ - }`→-、未知命令保留）→ **归档 `v0.5.1`（2026-08-31）** |
| M1-FIX | **空白页热修复（`pushPlainSegs is not defined`）** | ✅ 根因 = `pushPlainSegs` 未嵌入 BODY（模块测试覆盖不到、bundle 运行才暴露的 ReferenceError → 空白页）；修复 = BODY 补嵌 `${pushPlainSegs.toString()}` + gen-client 重跑 + live bundle 验证（含 `pushPlainSegs`，刷新即恢复）；回归守卫 = run-render 嵌入完备性断言（38 个 helper 逐一检查 `function <name>(` 在 BODY）+ simulate-render v0.5.1 静态守卫（不依赖演示数据）；**v0.5.1 标签移到修复提交** |


---

## v0.5.2 · 章节目录一键审批


> 版本：v0.5.2（新交互：点击章节目录审批通过该节全部高亮，含「无高亮」情形）· 状态：**Phase 0 完成 + 离线测试 PASS + live client bundle 验证（已归档 `v0.5.2`）** · 创建：2026-08-31 · 最近更新：2026-08-31
> **⚠️ 已被 v0.5.3 继承**：章节目录一键审批在 v0.5.3 **保留**并新增「反选」（Shift+点击 = `revert_section`，**批量恢复待审**：该节 accepted → proposed + 节 → pending，撤销一键审批；**不是批量否决**）；本版本 §5.1 的公式灰块热修复随数学渲染移除而**不再适用**（v0.5.3 已彻底移除公式渲染，正文按原文显示）。
> **v0.5.2 热修复（同日，§5.1）**：公式渲染空 display 片段 → 空心灰色色块覆盖内容 —— 已修复（`splitMathPieces` 空 display 折叠回普通文本）。

---

### 1. 项目定位与 v0.5.2 目标

- **项目一句话**：在 DeepSeek Harness（DSH）之上构建单论文多色高亮 Agent —— 用户提供论文 PDF → MinerU 云 API 解析为结构化 Markdown → `dsh web`（paper profile, 3081）GUI 整体渲染 → Agent 依据「论文整体认识 + 领域发展线 + 用户画像」逐节提出语义高亮 → 用户审查修改 → 画像持续学习 → **导出**。
- **v0.1–v0.5.1（已完成，归档 `v0.5.1`）**：管线打通 → 审查闭环 → 画像收敛 → 打磨导出 → 一键格式化（工厂重置）→ 图例彩色语义 + 轻量公式渲染。
- **v0.5.2 目标（新交互，用户提出）**：
  > 允许用户通过点击章节目录（例如点击 Abstract 标签）来**审批通过该部分的所有高亮**，这应当包括 agent 在该部分**没有提出高亮**的情况。
  - 即：点击章节芯片（TOC 条）→ **批量接受该节全部 proposed 高亮** + **标记该节审查完毕**；该节 agent 没提任何高亮时，点击同样「通过」该节（标记审查完毕）。

### 3. v0.5.1 继承状态（独立使用必需）

#### 3.1 运行环境
- Windows；harness `dsh web`（port 3080，profile `web`）；**paper profile 独立跑 3081**
- paper profile 启动：`dsh --profile paper --port 3081 --no-open`（后台 job；`prepareProfile` 会重写 profile/cordis.yml，启动需 danger-full-access）
- 沙箱：`D:\aa` 内写入免授权；工作区外需 danger-full-access 一次性升级 + 用户批准

#### 3.2 关键路径与交付物（v0.5.1 已就绪，勿重复造）
- git：**tag `v0.5.1`**（图例/公式 + 空白页热修复），工作区 clean（本版本改动前）
- 插件包 `D:\aa\packages\paper-highlight/`：
  - `host/`：`schema.js` / `store.js` / `mineru.js` / `normalize.js` / `pipeline.js` / `plugin.js`（`/paper-hl` 路由矩阵，含 `POST /write` / `POST /format`）/ `sections.js` / **`actions.js`（v0.5.2 新增 `approve_section`）** / `diff.js` / `profile.js` / `export.js` / `reflection.js` / `format.js` / `tools.js` + `tools-plugin.mjs`
  - `client/`：`render-body.js`（渲染逻辑单一来源）、`client.js`（durable bundle）、`dynamic/client-half.js`
  - `scripts/`：`gen-client.js` / `simulate-render.js` / `verify-http.js` / `check-host.js` / `check-utf8.js` 等
  - `test/`：`run-mock.js` / `run-tools.js` / `run-actions.js` / `run-plugin.js` / `run-render.js` / `run-profile.js` / `run-export.js` / `run-reflect-paper.js` / `run-format.js`
- 画像存储：`D:\aa\highlight-profile/`（v0.5 格式化后为**冷启动默认**：2 条默认规则 + 0 示例 + 0 统计）
- 论文数据：`D:\aa\data/<paper_id>/`（v0.5 格式化后高亮已清空：0 spans / 0 plan / 0 duplicates；`paper.md`/`anchors.json`/`meta.json` 保留）

#### 3.3 环境纪律（沿用 §3.3，勿破坏）
1. **3081 = 会话 Web**：Agent **不得自行 kill/restart**；需要重启时由用户操作。
2. **host 代码变更后 live 3081 需用户手动重启才生效**；client 变更（render-body/gen-client → 重新生成 bundle）刷新页面即生效（bundle 按请求从磁盘读取）。
   - ⚠️ **v0.5.2 同时改了 host（actions.js / plugin.js）与 client**：客户端刷新即见新 UI，但「点击审批」要真正落盘，**必须重启 3081**（否则旧 host 对 `approve_section` 返回 400 unsupported action，页面会提示「审批失败（已回读校准）」）。
3. 工单纪律：修改 `client/render-body.js` / `scripts/gen-client.js` 后**必须重跑** `node scripts/gen-client.js`。

### 4. v0.5.2 目标与已锁定决策

#### 4.1 目标（D1）
点击**章节目录芯片**（顶部 `.phl-section` 条，如 `Abstract`）→ **批量接受该节全部 proposed 高亮**（status=accepted，逐条追加用户 decision 审计）+ **标记该节审查完毕**（plan.sections 状态 reviewed + reviewed_at）。**agent 未在该节提出任何高亮时，点击同样「通过」该节**（接受 0 处 + 仍标记已审），并给出明确反馈文案。

#### 4.2 已锁定决策（D2–D4）
- **D2（原子 host 动作 `approve_section`）**：不逐条发 N+1 次 `/paper-hl/write`，新增**单个原子动作** `POST /paper-hl/write {action:'approve_section', section:<id>}` —— 一次读取 + 一次校验 + 一次落盘；节内 `proposed` spans 全部 `accepted`（每条追加 `{action:'accepted', by:'user'}` decision），再标记节 reviewed。已 `accepted` / `user_added` / `rejected` 的 span 一律不动。
- **D3（归属判定用构建的节索引）**：哪些 span 属于该节，按 `buildSections` 的 `anchor_ids`（节标题锚点 + 节内正文锚点）判定；节 id 未知 / 无 sections 索引时**接受 0 处 + 仍标记 reviewed**（「无高亮」与「未知节」都优雅通过，绝不报错拒绝）。
- **D4（client 乐观 + 回读校准）**：点击芯片 → 本地乐观批量接受（`localApproveSectionSpans`，仅翻转 status）+ 乐观标记节已审（✓）→ 发 `approve_section` → 成功：用返回的 `accepted` spans 逐条 `reconcileSpan`、合并节 entry（不整页回读）；失败：提示 + 整页 `/read` 回读校准（回滚乐观状态）。响应携带 `accepted`（接受的 span 列表）+ `accepted_count`（`plugin.js` 扩展）。

#### 4.3 与既有「标记本节审查完毕」的关系
- 保留既有 `review_section`（工具栏按钮 / Ctrl+Enter）：只标记当前节已审，**不动任何 span**。
- 新增 `approve_section`（点击节芯片）：**批量接受 + 标记已审**。二者语义互补、互不影响。

### 5. 实施步骤与验证方法

#### Phase 0 —— 章节目录一键审批（host + client 变更）
1. **`host/actions.js`**：
   - `ACTIONS` 加入 `'approve_section'`；
   - 抽出共享 `resolveReviewEntry(doc, section, opts)`（找 plan 条目或新建 + 标 reviewed），`applyReviewSection` 复用；
   - 新增 `applyApproveSection(doc, action, opts)`：校验 section 非空 → 从 `opts.sections`（buildSections 产物）取该节 `anchor_ids` → 遍历 `doc.spans`，`status==='proposed' && anchor∈anchor_ids` 的全部 `accepted` + 追加 decision → `resolveReviewEntry` 标节 reviewed → 返回 `{section, accepted, accepted_count}`。
2. **`host/plugin.js`**：`handleWrite` 响应新增 `accepted: result.accepted ?? null` 与 `accepted_count: result.accepted_count ?? null`（write 路由已把 `{sections: buildSections(...)}` 作为 opts 传入，无需改动调用方）。
3. **`client/render-body.js`**：
   - 新增纯函数 `localApproveSectionSpans(spans, sectionAnchors)`：节内 `proposed` → `accepted`（已接受/用户新增/拒绝/节外不动；已接受保持对象同一性，新接受返回拷贝）；
   - PaperView 新增 `approveSection(id)` 闭包：算节 anchors → 乐观接受 + 乐观标记已审 + flash（有高亮「已审批通过 X 处」，无高亮「无待审批高亮，已标记审查」）→ `callWrite({action:'approve_section', section:id})` → 成功：逐条 `reconcileSpan` + 合并节 entry + 用服务端 `accepted_count` 刷新 flash；失败：错误 flash + 整页 `/read` 回读校准；
   - 节芯片 `.phl-section` 加 `onClick: () => approveSection(s.id)` + title 提示「（点击审批通过本节全部高亮）」；CSS `cursor:pointer` + `.phl-section:hover` 高亮；
   - BODY 嵌入 `${localApproveSectionSpans.toString()}`；模块导出 `localApproveSectionSpans`。
4. **`scripts/gen-client.js`**：bundle 导出新增 `exports.localApproveSectionSpans`；**重跑生成 bundle**。

#### 验收方法（M1）
- ✅ `test/run-actions.js` PASS（新增）：`approve_section` 接受节内全部 proposed span（`s-002` 被接受、节外 `s-001` 不动）、`accepted_count` 正确、逐条追加用户 decision、已 accepted/user_added/rejected 不动；**0 proposed 的节 / 未知节 id / 无 sections 索引 → 接受 0 + 仍标 reviewed**；空/非字符串 section → 抛错；文档 schema 仍有效。
- ✅ `test/run-render.js` PASS（新增）：`localApproveSectionSpans`（节内 proposed→accepted；已接受/用户新增/拒绝/节外不动；已接受保持同一性；空集合 / null 安全）；**嵌入完备性守卫更新为 39 个 helper**（含 `localApproveSectionSpans`）。
- ✅ **`approve_section` 路由探针 PASS（一次性，throwaway fixture）**：`POST /paper-hl/write {action:'approve_section',section:'s2'}` → 200、`accepted_count=2`、`section.status=reviewed`、磁盘 2 accepted + References 的 `s-003` 不动；再审批 References → 1；重复审批 Abstract → 0（幂等）；空 section → 400。`test/run-plugin.js` 已加入对应用例（11b–11f，fixture `seedFixtureApprove`），待演示数据非空后随全量回归执行。
- ✅ `node scripts/gen-client.js` 重新生成 bundle，`node --check` 语法 OK；bundle 含 `localApproveSectionSpans` / `approve_section` / `已审批通过` / `.phl-section:hover`。
- ✅ `scripts/simulate-render.js`：新增 **P2-f 静态守卫**（`approve_section`/`approveSection`/`localApproveSectionSpans`/`data-phl-sec`/`已审批通过`，渲染前对 bundle 源码检查，**不依赖演示数据非空**）打印并通过；新增 **P2-f 交互测试**（点未审节芯片 → POST `approve_section` 目标节 → mock 返回恰好该节 spans → 芯片 ✓、mock `accepted_count===proposedBefore`、每个接受的 span 都属于该节）——位于 `expectedSpans>0` 之后，**待演示数据非空后随全量回归执行**。
- ✅ **live 3081 client bundle 验证（2026-08-31）**：`GET /plugins/paper-highlight/client.js` → 200，内容含 `localApproveSectionSpans` / `approve_section` / `已审批通过`（**刷新页面即见新 UI**）。
- ⚠️ **host 生效条件**：`approve_section` 需新 host（actions.js/plugin.js 为启动时加载）—— **请用户重启 3081** 后点击章节芯片才能落盘（重启前客户端会提示审批失败并回读校准，不损坏数据）。

> ⚠️ **已知（非本版本回归）**：v0.5 用户实跑格式化后，三篇论文高亮已清空（0 spans）+ 画像回到冷启动默认 —— 依赖**演示数据非空**的 `scripts/simulate-render.js`（断言 `expectedSpans > 0`）与 `test/run-plugin.js` 第 2 步（断言原始 5 条演示 span 仍在）当前会失败；重新 propose 出新高亮后自动恢复。这不是代码缺陷，是格式化清空数据的预期结果。v0.5.2 的新交互测试（P2-f / run-plugin 11b–11f）同样在数据恢复后自动生效。

#### 5.1 热修复（2026-08-31，同日）：公式空 display → 空心灰色色块覆盖内容
- **现象（用户报告）**：部分公式**未正常渲染**，其位置被**灰色色块覆盖**（看不到公式内容）。
- **根因**：`splitMathPieces` 对每个 LaTeX 片段算 `display` 后，一律标记为 `math` 并渲染 `<span className="phl-math">`（带 `background:rgba(96,130,190,.12)` + padding）。当某片段**转换结果为空串**时，该 span 就只剩背景而无文字 —— 在深色主题下就是一块**空心灰色色块**，把公式原始内容「盖住」。全库 407 个数学片段中命中 3 处：裸字体开关 `\bf`（bahdanau a-0002-09-01、mikolov a-0003-08-01，`MATH_SYMBOLS.bf=''` 被吞成空串）与**空上标 `^ { }`**（sutskever a-0003-10-01）。
- **修复**：`splitMathPieces` 引入 `pushMath` —— **`display` 为空时不再生成 math 片段，把该段原始 LaTeX 折叠回前后普通文本**（`{ \bf g 0 }` → 整段按原样显示，绝不丢信息、绝不出现色块）；`display` 非空的转换（`\bf {f}`→` f`、`\times`→× 等）照常渲染。纯 client 变更。
- **验证**：
  - ✅ 真实数据重扫：数学片段 407→404，**EMPTY display = 0**（3 处色块全部消除），53 个含公式锚点渲染不变；
  - ✅ `test/run-render.js` 新增回归（v051c）：裸 `\bf`/`\rm`/`\it`/`\tt`/`\cal`/`\boldsymbol`、空 `^ { }`、空 `$$…$$` 全部折叠回普通文本（**不变量：不存在 `math && display 为空` 的片段**，且原始覆盖连续）；`\bf {f}` 仍渲染；`renderText` 不再为折叠 token 生成 `phl-math` span 且原文逐字保留（带/不带 segment 均验证）→ PASS；
  - ✅ `gen-client.js` 重跑 + `node --check` OK；离线回归（run-actions/run-tools/run-format）PASS；simulate-render P2-f 静态守卫 PASS；
  - ✅ **live client bundle 验证（2026-08-31）**：`/plugins/paper-highlight/client.js` → 200，含 `pushMath` / `display.length === 0`（**刷新页面即生效**，本修复为纯 client 变更，无需重启）。

### 6. 风险

| # | 风险 | 缓解 |
|---|---|---|
| 1 | 批量接受误伤（用户只想标记已审、不想动高亮） | 点击节芯片 = 明确的「审批通过」意图；仅接受 `proposed`，已接受/用户新增/拒绝不动；既有「标记本节审查完毕」（`review_section`）保留，二者语义分离 |
| 2 | 节归属判定错误（span 跨节 / 锚点归属） | D3：用 `buildSections` 的 `anchor_ids`（标题锚点 + 节内锚点）判定；真实数据路径与 propose 同一套节索引 |
| 3 | 未知节 / 空节报错 | 接受 0 + 仍标记已审（「通过空节」是需求本身）；未知节 id 同样优雅通过并创建 reviewed 条目 |
| 4 | 乐观更新与服务端不一致 | D4：成功用返回 spans 逐条 reconcile + 合并节 entry；失败整页 `/read` 回读校准（回滚） |
| 5 | 旧 host 未重启时点击 → 400 | 客户端失败路径提示「审批失败（已回读校准）」并回读，不损坏数据；文档/交付记录明确「需重启 3081」 |
| 6 | bundle 与单一来源不一致 | 环境纪律 §3.3：改 render-body/gen-client 后必须重跑 `gen-client.js`；已重跑 + `node --check`；P2-f 静态守卫纳入 bundle 检查 |

### 7. 命令速查（v0.5.2）

```powershell
$env:NODE_PATH = 'C:\Users\eyx\.dsh\profiles\node_modules'   # fflate 解析
node scripts/gen-client.js       # 改 render-body.js / gen-client.js 后必须重跑
node --check client/client.js    # bundle 语法检查
node test/run-actions.js         # 含 approve_section 单元用例（PASS）
node test/run-render.js          # 含 localApproveSectionSpans + 嵌入完备性守卫（PASS）
node test/run-tools.js && node test/run-format.js   # host 回归（PASS）
node scripts/simulate-render.js  # live 3081 —— P2-f 静态守卫 PASS；交互测试需演示数据非空
```

### 8. 交付记录（v0.5.2 待归档）

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 | 章节目录一键审批 | ✅ `host/actions.js`（`approve_section` 原子动作 + `resolveReviewEntry` 复用）+ `host/plugin.js`（响应携带 `accepted`/`accepted_count`）+ `client/render-body.js`（`localApproveSectionSpans` 纯函数 + `approveSection(id)` + 节芯片 `onClick` + `cursor:pointer`/hover CSS）+ `gen-client.js`（新 export）+ 测试 PASS（run-actions 批量接受/空节/未知节/幂等 + run-render 纯函数/嵌入守卫 39 helper）+ 路由探针 PASS（2 accepted、节外不动、幂等、400）+ live client bundle 验证 PASS（刷新即见新 UI）→ **待用户重启 3081 后落盘生效 → 归档 `v0.5.2`** |
| M1-FIX | **公式空 display → 灰色色块覆盖（热修复，§5.1）** | ✅ 根因 = `splitMathPieces` 对空 display 片段仍渲染 `phl-math` span（背景无文字 → 空心灰色色块）；命中 3 处：裸 `\bf`×2、空 `^ { }`×1。修复 = `pushMath` 折叠：空 display 的原始 LaTeX 折回普通文本（不丢信息、无色块）；验证 = 真实数据 EMPTY display 407→0 + run-render v051c 回归（含「无空 math」不变量 + 原文逐字保留）+ gen-client 重跑 + live bundle 含 `pushMath`（刷新即生效，纯 client 无需重启）→ **v0.5.2 标签移到修复提交** |


---

## v0.5.3 · 放弃数学渲染 + 一键审批反选 + 画像面板修复


> 版本：v0.5.3（①移除 v0.5.1 轻量公式渲染、回滚至 v0.5.0 纯文本渲染（图例彩色语义保留）②一键审批新增「反选」= **批量恢复待审**（Shift+点击，撤销一键审批）③修复画像面板空白/无法返回）· 状态：**Phase 0 完成 + 离线测试 PASS + live client bundle 验证（归档 `v0.5.3`）** · 创建：2026-08-31 · 最近更新：2026-08-31
> **v0.5.3 背景**：用户连续遇到数学渲染相关问题（灰块覆盖公式）后，明确要求「回滚至 v0.5.0，放弃数学渲染」，并同时要求：①图例语义彩色显示保留并重新实现；②修复进入画像页面空白、无法返回的问题。经确认，v0.5.2 的章节目录一键审批**保留**，并**新增一键审批的「反选」功能**。
> **v0.5.3 反选语义澄清（用户修正）**：「反选」**不是批量否决**，而是**批量设置为「待审」状态** —— 即**撤销该节的一键审批**：把该节已接受（accepted）的高亮批量恢复为待审（proposed），并把该节状态恢复为待审查（pending）。

---

### 1. 项目定位与 v0.5.3 目标

- **项目一句话**：在 DeepSeek Harness（DSH）之上构建单论文多色高亮 Agent —— 用户提供论文 PDF → MinerU 云 API 解析为结构化 Markdown → `dsh web`（paper profile, 3081）GUI 整体渲染 → Agent 依据「论文整体认识 + 领域发展线 + 用户画像」逐节提出语义高亮 → 用户审查修改 → 画像持续学习 → **导出**。
- **v0.1–v0.5.2（已完成，归档）**：管线打通 → 审查闭环 → 画像收敛 → 打磨导出 → 一键格式化（工厂重置）→ 图例彩色语义 + 轻量公式渲染 → 章节目录一键审批。
- **v0.5.3 目标（用户提出，原始需求逐字）**：
  > 回滚至 v0.5.0，放弃数学渲染，重新实现 1. 将页面的「核心洞见/贡献 关键定义/方法 局限/风险 可借鉴/启发 待深挖/存疑」这几个高亮语义，用对应的彩色显示。 2. 修复进入画像页面后显示空白，无法返回的问题。
  - 用户自定义补充（反选）：**在保留 v0.5.2 一键审批的基础上，增加一键审批的反选功能**。用户随后明确：**反选 = 批量设置为「待审」状态（不是批量否决）**。
  - 拆解为三个交付物：
    1. **放弃数学渲染**：移除 v0.5.1 的轻量公式渲染（纯 tokenizer + Unicode 转换），`renderText` / `buildBlockSegments` / `nodeOffsetToSeg` / CSS（`.phl-math*`）/ BODY 嵌入 / bundle 导出全部还原为 v0.5.0 纯文本渲染 —— 正文按原文逐字节显示，不再出现公式灰块；**图例五个语义标签彩色显示（`phl-legend-label`）保留**。
    2. **画像面板空白 + 无法返回修复**：`renderProfilePanel` 在「示例库为空」时 `exemplarRows` 是单个 React 元素（非数组），下方 `...exemplarRows` 展开 → `Spread syntax requires ...iterable` 运行时崩溃 → 整个面板渲染失败（空白）+「返回论文」按钮也渲染不出来（无法返回）。该 bug 为 v0.3 遗留潜在 bug，格式化后画像示例=0 才暴露。修复：`exemplarRows` 恒返回数组（空态包裹在数组中）。
    3. **一键审批「反选」= 批量恢复待审**：**Shift+点击**章节芯片 = **撤销该节的一键审批** —— 把该节已接受（accepted）的高亮批量恢复为**待审**（proposed）+ 该节状态恢复为**待审查**（pending）。host 新增原子动作 `revert_section`（镜像 `approve_section`），client 新增 `revertSection(id)`（镜像 `approveSection(id)`）；普通点击仍为一键审批。**注意：不是批量否决（rejected），否决/已拒绝的高亮不受影响。**

### 3. v0.5.2 继承状态（独立使用必需）

#### 3.1 运行环境
- Windows；harness `dsh web`（port 3080，profile `web`）；**paper profile 独立跑 3081**
- paper profile 启动：`dsh --profile paper --port 3081 --no-open`（后台 job；`prepareProfile` 会重写 profile/cordis.yml，启动需 danger-full-access）
- 沙箱：`D:\aa` 内写入免授权；工作区外需 danger-full-access 一次性升级 + 用户批准

#### 3.2 关键路径与交付物（v0.5.2 已就绪，勿重复造）
- git：**tag `v0.5.2`**（章节目录一键审批，含同日公式灰块热修复）
- 插件包 `D:\aa\packages\paper-highlight/`：
  - `host/`：`schema.js` / `store.js` / `mineru.js` / `normalize.js` / `pipeline.js` / `plugin.js`（`/paper-hl` 路由矩阵，含 `POST /write` / `POST /format`）/ `sections.js` / **`actions.js`（v0.5.2 `approve_section`；v0.5.3 新增 `revert_section`）** / `diff.js` / `profile.js` / `export.js` / `reflection.js` / `format.js` / `tools.js` + `tools-plugin.mjs`
  - `client/`：`render-body.js`（渲染逻辑单一来源）、`client.js`（durable bundle）、`dynamic/client-half.js`
  - `scripts/`：`gen-client.js` / `simulate-render.js` / `verify-http.js` / `check-host.js` / `check-utf8.js` 等
  - `test/`：`run-mock.js` / `run-tools.js` / `run-actions.js` / `run-plugin.js` / `run-render.js` / `run-profile.js` / `run-export.js` / `run-reflect-paper.js` / `run-format.js`
- 数据根：`D:\aa\data/<paper_id>/`；画像根：`D:\aa\highlight-profile/`

#### 3.3 环境纪律（每次续作必读）
1. **3081 = 会话 Web，Agent 不得自行 kill/restart**；host 代码变更后由**用户手动重启**；live 验证前先 `GET /paper-hl/read` 确认新代码已加载。
2. **client 变更**：bundle 按请求从磁盘读，刷新页面即生效（无需重启）。
3. **host 变更**：`revert_section` / `approve_section` 动作需重启 3081 后落盘生效；重启前客户端会提示「恢复待审/审批失败（已回读校准）」并回读，不损坏数据。
4. 数据状态（v0.5.0 格式化后）：3 篇论文 0 spans / 0 plan / 0 duplicates；`highlight-profile/` 冷启动默认（2 条规则 + 0 示例）。**不重新灌演示数据。**

### 4. 已锁定决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | **移除 v0.5.1 数学渲染**，`renderText`/`buildBlockSegments`/`nodeOffsetToSeg`/CSS/嵌入/导出还原 v0.5.0 | 用户明确要求「回滚至 v0.5.0，放弃数学渲染」；数学渲染反复出问题（空白页、灰块） |
| D2 | **图例彩色语义保留**（`phl-legend-label` 彩色标签 + CSS） | 用户需求 ①「把高亮语义用对应彩色显示」—— 这是 v0.5.1 的 ① 部分，保留 |
| D3 | **保留 v0.5.2 一键审批**（点击 = approve_section） | 用户确认保留 v0.5.2；只放弃数学渲染 |
| D4 | **新增「反选」= 批量恢复待审**：Shift+点击章节芯片 = `revert_section`（该节 accepted → proposed 待审 + 该节 → pending 待审查） | 用户自定义：在保留一键审批基础上增加反选功能；用户明确反选 = 批量设置待审（非否决）；Shift+点击为最轻量、与普通点击共用一个芯片 |
| D5 | **画像面板修复**：`exemplarRows` 空态恒返回数组（`[<empty div>]`），不再 `...exemplarRows` 展开单个元素 | 根因 = v0.3 遗留潜在 bug，空示例时展开崩溃 → 空白 + 无法返回 |
| D6 | **只回滚数学，不 git revert 整个 v0.5.2**：在当前 v0.5.2 树上手术式剥离数学 | 若 `git revert` 到 v0.5.0 会把一键审批一起丢掉，需重新加回；剥离路径保留全部非数学特性 |

### 5. 实施

#### 5.1 交付物 ①：放弃数学渲染（回滚至 v0.5.0 纯文本渲染）

**方法**：以 `git show f1f0ba6`（v0.5.0 的 render-body.js）为参考，用一次性转换脚本（`test/.tmp/strip-math.js`，gitignored，不提交）在当前 render-body.js 上做手术式剥离：

1. **删除数学纯函数块**：`MATH_SYMBOLS` / `SUP_MAP` / `SUB_MAP` / `mapScript` / `supScript` / `subScript` / `boldMath` / `mathClean` / `mathConvert` / `matchMathDelim` / `matchMathToken` / `splitMathPieces`（含 `pushMath` 空 display 折叠）/ `mathPieceEl`。
2. **`renderText` 还原 v0.5.0**：删除 `emitPlain` / `splitMathPieces` 细分分支 / 无 span 分支的数学处理，恢复「无高亮 → 单文本节点（或裸字符串）；有高亮 → 段间纯文本 + `<mark>`」。
3. **`buildBlockSegments` 还原 v0.5.0**：删除 `pushPlainSegs`（及 `math` 字段），普通段不再按 `splitMathPieces` 细分。
4. **`nodeOffsetToSeg` 还原 v0.5.0**：删除 `data-phl-dlen` 显示长度映射分支。
5. **删除 BODY 嵌入**：`MATH_SYMBOLS`/`SUP_MAP`/`SUB_MAP`/`mapScript`/`supScript`/`subScript`/`boldMath`/`mathClean`/`mathConvert`/`matchMathDelim`/`matchMathToken`/`splitMathPieces`/`mathPieceEl`/`pushPlainSegs` 的 `toString()` 嵌入。
6. **删除 CSS**：`.phl-math{...}` / `.phl-math-display{...}`（保留 `.phl-legend-label{...}`）。
7. **删除 bundle 导出**（`scripts/gen-client.js`）：`exports.MATH_SYMBOLS/supScript/subScript/boldMath/mathClean/mathConvert/splitMathPieces`（保留 `localApproveSectionSpans`，新增 `localRevertSectionSpans`；后由 v0.5.3 反选语义修正替换 reject 为 revert）。
8. **`module.exports` 清理**（render-body.js 尾部）：删除数学条目。

**结果**：`render-body.js` 1932 行（自 2179 行减 247 行）；bundle `client.js` 92249 bytes，**无任何数学标识残留**（`phl-math`/`splitMathPieces`/`mathConvert`/`MATH_SYMBOLS`/`data-phl-dlen`/`pushPlainSegs`/`mathPieceEl` 全部为 0）。

#### 5.2 交付物 ②：画像面板空白 + 无法返回修复

- **现象（用户报告）**：进入「画像」页面后显示空白，且无法返回论文视图。
- **根因定位**（无头探针 `test/.tmp/profile-blank-probe.js`，gitignored，用 React 最小 shim + 真实 bundle + 真实 `/profile` 复现）：点击「画像」按钮 → `setPanelDrafts(profilePanelModel(profile))` + `setPanelView('profile')` → 重渲染 `renderProfilePanel()` 抛出 `Spread syntax requires ...iterable[Symbol.iterator] to be a function`。
  - 具体位置：`renderProfilePanel` 中
    ```js
    const exemplarRows = d.exemplars.length === 0
      ? React.createElement('div', { className: 'phl-pnl-empty' }, '（暂无示例，确认提案后自动入库）')   // ← 单个元素！
      : d.exemplars.map(...)
    ...
    React.createElement('section', {...}, h3, ...exemplarRows)   // ← 对单个元素展开 → 崩溃
    ```
  - 当画像 **示例为空**（v0.5.0 格式化后冷启动画像 = 0 示例）时命中；模拟测试用 MOCK_PROFILE（2 示例）故从未暴露 —— **v0.3 遗留潜在 bug**。
- **修复**：空态分支恒返回数组 `[React.createElement('div', { className: 'phl-pnl-empty' }, ...)]`，`...exemplarRows` 始终展开数组。
- **验证（探针）**：面板渲染出「个性化画像（四层）」+ 5 色行 + 2 规则行 + 示例空态 + 统计 + 反思笔记；「← 返回论文」按钮存在且点击后面板关闭、回到论文视图。

#### 5.3 交付物 ③：一键审批「反选」= 批量恢复待审（撤销一键审批）

- **host**（`host/actions.js` + `host/plugin.js`）：
  - `ACTIONS` 新增 `'revert_section'`。
  - `applyRevertSection(doc, a, opts)`：镜像 `applyApproveSection` 的反向 —— 按 `opts.sections` 的 `anchor_ids` 判定节内 span，**`accepted → proposed`（待审）**逐条追加 `decision('proposed')`（audit log）；`proposed`（本就待审）/用户新增/已拒绝不动；新增 `resolvePendingEntry`（找到/创建 plan 条目，`status='pending'` + 删除 `reviewed_at`）；空/未知节恢复 0 + 节条目仍为 pending；返回 `{ section, reverted, reverted_count }`。
  - `applyAction` 增加 `case 'revert_section'`。
  - `plugin.js` `/write` 响应新增 `reverted` / `reverted_count`。
- **client**（`client/render-body.js` + `scripts/gen-client.js`）：
  - `localRevertSectionSpans(spans, sectionAnchors)`：纯函数，`localApproveSectionSpans` 的逆 —— **accepted → proposed（待审）**，其余状态/锚点不动；嵌入 BODY + `module.exports` + gen-client 导出。
  - `revertSection(id)`：镜像 `approveSection(id)` —— 乐观恢复待审（accepted→proposed）+ 乐观把该节标回 pending + flash「已恢复为待审 …（N 处高亮回到待审）」+ `callWrite({action:'revert_section', section:id})` 回读校准（成功逐条 `reconcileSpan`、失败整页回读 + flash「恢复待审失败（已回读校准）」）。
  - 节芯片 `onClick: (e) => { if (e && e.shiftKey) revertSection(s.id); else approveSection(s.id) }`；`title` 提示「点击 = 审批通过本节全部高亮；Shift+点击 = 恢复本节为待审，撤销审批」。
  - `dispatchRef.current` 增加 `revertSection`（供快捷键 effect 复用）。

### 6. 验证

#### 6.1 离线测试（全部 PASS）
```
node test/run-render.js    # PASS —— 移除数学矩阵；新增 v0.5.3 反选矩阵（localRevertSectionSpans：accepted→proposed 待审）；嵌入完备性守卫 26 helper（含 localApproveSectionSpans + localRevertSectionSpans）
node test/run-actions.js   # PASS —— 新增 revert_section 批量恢复/只动 accepted/空节/未知节/无索引/幂等/approve→revert 往返/400 矩阵
node test/run-plugin.js    # PASS —— 新增 11g–11i revert_section 路由（approve 2 → revert 2 回待审 + pending、持久化、幂等、400）；真实数据断言放宽为「数组形状」（容忍格式化后 0 spans）
```

#### 6.2 无头探针（gitignored，真实 bundle + 真实 3081 数据，写请求 mock）
- `test/.tmp/profile-blank-probe.js`：**画像面板空白修复** —— 面板正常渲染（5 色/2 规则/示例空态/统计/反思笔记）+ 「← 返回论文」可点击返回。PASS。
- `test/.tmp/revert-flow-probe.js`：**反选流程** —— 普通点击芯片 → `approve_section` POST（芯片 done）；Shift+点击同一芯片 → `revert_section` POST（反选 = 恢复待审）+ flash「已恢复为待审」+ 芯片 done 状态清除（回到待审查）；画像面板仍可开/关（回归）。PASS。

#### 6.3 bundle / live 验证
- `node scripts/gen-client.js` 重新生成 `client.js`（92327 bytes）+ `dynamic/client-half.js`；`node --check` 语法全过。
- bundle 内容核查（Node 读 UTF-8）：数学标识 0 处；`phl-legend-label` ✓；**无 `reject_section` 残留**，`revert_section`/`revertSection`/`已恢复为待审` ✓；`approve_section`/`已审批通过` ✓。
- `scripts/simulate-render.js` 静态守卫全部通过（含 v0.5.3 `p2g` 反选守卫 `revert_section`/`revertSection`/`localRevertSectionSpans`/`已恢复为待审`；`p2d` 已移除 `pushPlainSegs`；`v051` 仅保留 `phl-legend-label`）。**注意**：simulate-render 全量 E2E 仍受「演示数据为空」阻塞（`expectedSpans > 0`，v0.5.0 格式化后的既有依赖；重新 propose 出高亮后自动恢复）。
- live 3081：client bundle 按请求从磁盘读，**刷新页面即生效**；`/paper-hl/read`、`/paper-hl/profile` 健康。**host 变更（`revert_section`/`approve_section`）需用户重启 3081 后落盘生效**。

### 7. 风险 / 遗留

| # | 风险/遗留 | 状态 |
|---|---|---|
| 1 | simulate-render / run-plugin 第 2 步依赖演示数据非空（格式化后 0 spans） | 既有依赖；run-plugin 已放宽为数组形状；simulate-render 全量需重新 propose 出高亮后自动恢复 |
| 2 | host 变更未落盘：重启 3081 前点击/Shift+点击会提示「审批/恢复待审失败（已回读校准）」并回读，不损坏数据 | 需用户重启 3081 |
| 3 | 画像面板修复覆盖的是「示例为空」崩溃路径；示例非空路径此前模拟测试已覆盖 | ✅ |
| 4 | 数学移除是**有意回滚**（用户要求），本合并文档 v0.5.1 节的公式渲染记录属历史归档，不再作为当前能力 | ✅（文档已注明） |

### 8. 复现命令

```powershell
# 离线回归
$env:NODE_PATH='C:\Users\eyx\.dsh\profiles\node_modules'   # fflate 依赖
node test/run-render.js
node test/run-actions.js
node test/run-plugin.js
# bundle 重建 + 语法
node scripts/gen-client.js && node --check client/client.js
# 无头探针（真实 bundle + 真实 3081 数据；写请求 mock，真实数据零改动）
node test/.tmp/profile-blank-probe.js
node test/.tmp/revert-flow-probe.js
# 全量 E2E（依赖演示数据非空，需重新 propose 后恢复）
node scripts/simulate-render.js
```

### 9. 里程碑

| 里程碑 | 验收 | 达成 |
|---|---|---|
| M1 | 数学渲染彻底移除（renderText/buildBlockSegments/nodeOffsetToSeg/CSS/嵌入/导出还原 v0.5.0），bundle 无数学残留；图例彩色语义保留 | ✅ |
| M2 | 画像面板空白 + 无法返回修复（空示例 `...exemplarRows` 展开崩溃 → 恒返回数组），探针验证面板可开可关 | ✅ |
| M3 | 一键审批「反选」= 批量恢复待审（`revert_section` + `revertSection` + Shift+点击，accepted→proposed + 节→pending，非否决），离线矩阵 + 路由 + 探针 PASS | ✅ |
| M4 | 文档同步（one-pager / README / user-guide）+ git 提交 + tag `v0.5.3` | ✅ |

---

*归档记录：v0.5.1（图例彩色语义 + 轻量公式渲染 + 空白页热修复）→ v0.5.2（章节目录一键审批 + 公式灰块热修复）→ **v0.5.3（放弃数学渲染 + 一键审批反选 + 画像面板修复）**。*


---

## v0.5.4 · 格式化后「重新提出高亮」按钮（含 v0.5.4.1 顶栏固定 / v0.5.4.3 按钮下线）


> 版本：v0.5.4（格式化后给用户一个「重新提出高亮」按钮 —— 记录请求 + 复制指令，让 Agent 再次提出高亮）· 状态：**离线测试 PASS + 真实 bundle 探针 PASS + live client bundle 验证（归档 `v0.5.4`）** · 创建：2026-09-01
> **v0.5.4 背景**：用户提出「在用户格式化后，需要给用户一个按钮，使 agent 再次提出高亮」。经架构调研确认：**GUI 按钮（浏览器插件）无法直接调用 LLM Agent** —— 提出高亮必须由 Agent 在会话对话里通过 `paper-hl-global-read` → `paper-hl-propose` 技能执行。已向用户解释最初高亮的提出机制并确认交互方式：**记录请求 + 复制指令（推荐）**。

---

### 1. 项目定位与 v0.5.4 目标

- **项目一句话**：在 DeepSeek Harness（DSH）之上构建单论文多色高亮 Agent —— 用户提供论文 PDF → MinerU 云 API 解析为结构化 Markdown → `dsh web`（paper profile, 3081）GUI 整体渲染 → Agent 依据「论文整体认识 + 领域发展线 + 用户画像」逐节提出语义高亮 → 用户审查修改 → 画像持续学习 → **导出**。
- **v0.1–v0.5.3（已完成，归档）**：管线打通 → 审查闭环 → 画像收敛 → 打磨导出 → 一键格式化（工厂重置）→ 图例彩色语义 → 章节目录一键审批 + 反选（批量恢复待审）→ 放弃数学渲染。
- **v0.5.4 目标（用户提出）**：
  > 在用户格式化后，需要给用户一个按钮，使 agent 再次提出高亮。
  - **交互确认（用户选定「记录请求 + 复制指令（推荐）」）**：点击「重新提出高亮」按钮后 —— ①host 落盘一条 `propose-request` 请求记录（`data/<paper_id>/propose-request.json`，`status:'pending'`）；②自动复制一段指令「请为《论文》重新提出高亮」到剪贴板并提示。用户把它粘贴到对话（或直接说「重新提出高亮」），Agent 即执行 global-read + 逐节 propose。
  - 拆解为三个交付物：
    1. **host 路由 `POST /paper-hl/propose-request`**（+ `GET` 回读）：解析 paper_id（query → body → 首篇回退，与 `/read` 一致），落盘 `data/<paper_id>/propose-request.json`（`paper_id`/`title`/`requested_at`/`status:'pending'`），返回 `{ok, paper_id, title, requested_at, status}`。
    2. **client 数据函数 `callProposeRequest(paperId)`**：POST `/paper-hl/propose-request?paperId=…` `{paper_id}`，ok 判定 + 无 transport 干净拒绝（与 `callWrite`/`callProfile`/`callFormat` 同构）。
    3. **client「重新提出高亮」按钮 + 空态 CTA**：工具栏新增 `重新提出高亮` 按钮（`phl-repropose-btn`）；当论文高亮数为 0（格式化后）时正文上方显示空态横幅 `phl-empty-cta`（提示 + 同款按钮）。点击 → `requestRepropose()`：POST 请求 → 成功则 `copyInstruction()` 复制「请为《title》重新提出高亮（paper_id: …）：先执行 global-read 重建逐节计划，再逐节 propose」+ flash「已记录请求（pending）并复制指令。请对 Agent 说/粘贴：『请为《title》重新提出高亮』」。

### 3. v0.5.3 继承状态（独立使用必需）

#### 3.1 运行环境
- Windows；harness `dsh web`（port 3080，profile `web`）；**paper profile 独立跑 3081**
- paper profile 启动：`dsh --profile paper --port 3081 --no-open`（后台 job；`prepareProfile` 会重写 profile/cordis.yml，启动需 danger-full-access）
- 沙箱：`D:\aa` 内写入免授权；工作区外需 danger-full-access 一次性升级 + 用户批准

#### 3.2 关键路径与交付物（v0.5.3 已就绪，勿重复造）
- git：**tag `v0.5.3`**（放弃数学渲染 + 反选 = 批量恢复待审 + 画像面板修复）
- 插件包 `D:\aa\packages\paper-highlight/`：
  - `host/`：`schema.js` / `store.js` / `mineru.js` / `normalize.js` / `pipeline.js` / `plugin.js`（`/paper-hl` 路由矩阵，含 `POST /write` / `POST /format` / **`POST+GET /propose-request`（v0.5.4）**）/ `sections.js` / **`actions.js`（v0.5.2 `approve_section`；v0.5.3 `revert_section`）** / `diff.js` / `profile.js` / `export.js` / `reflection.js` / `format.js` / `tools.js` + `tools-plugin.mjs`
  - `client/`：`render-body.js`（渲染逻辑单一来源）、`client.js`（durable bundle）、`dynamic/client-half.js`
  - `scripts/`：`gen-client.js` / `simulate-render.js` / `verify-http.js` / `check-host.js` / `check-utf8.js` 等
  - `test/`：`run-mock.js` / `run-tools.js` / `run-actions.js` / `run-plugin.js` / `run-render.js` / `run-profile.js` / `run-export.js` / `run-reflect-paper.js` / `run-format.js`
  - `test/.tmp/`（gitignored 探针）：`profile-blank-probe.js` / `revert-flow-probe.js` / **`propose-request-probe.js`（v0.5.4）**
- 数据根：`D:\aa\data/<paper_id>/`；画像根：`D:\aa\highlight-profile/`

#### 3.3 环境纪律（每次续作必读）
1. **3081 = 会话 Web，Agent 不得自行 kill/restart**；host 代码变更后由**用户手动重启**；live 验证前先 `GET /paper-hl/read` 确认新代码已加载。
2. **client 变更**：bundle 按请求从磁盘读，刷新页面即生效（无需重启）。
3. **host 变更**：`propose-request` 路由需重启 3081 后生效；重启前客户端会提示「请求重新提出高亮失败（已回读校准）」并回读，不损坏数据。
4. 数据状态（v0.5.0 格式化后）：3 篇论文 0 spans / 0 plan / 0 duplicates；`highlight-profile/` 冷启动默认（2 条规则 + 0 示例）。**不重新灌演示数据。**（simulate-render 全量 E2E 仍受 `expectedSpans > 0` 阻塞，静态 bundle 守卫全部通过，重提后恢复。）

### 4. 已锁定决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | **新增 host 路由 `POST/GET /paper-hl/propose-request`**：落盘 `data/<paper_id>/propose-request.json`（`status:'pending'` 审计标记），返回请求体 | 格式化清空了所有高亮记录；按钮需要一个持久的「重新提出高亮」请求标记，供 Agent 处理时追溯 |
| D2 | **「重新提出高亮」按钮 = 记录请求 + 复制指令**（不做全自动一键触发） | 架构边界：浏览器按钮无法直接调用 LLM；DSH 无公开的「注入会话消息/自动调度 Agent 轮次」接口（已调研 `dsh-client-runtime`/`dsh-web-frontend`/`dsh-session`）。复制指令 + 粘贴/说一句是最可靠、零侵入的触发方式 |
| D3 | **按钮出现在两处**：工具栏恒有 + 高亮数为 0 时正文上方空态横幅（`phl-empty-cta`） | 格式化后 0 高亮的场景最需要引导；空态横幅把「重新提出高亮」放在显眼位置 |
| D4 | **`callProposeRequest` 与 `callWrite`/`callProfile`/`callFormat` 同构**（transport 注入、ok 判定、无 transport 干净拒绝） | 保持 client 数据函数单一模式，gen-client 可测试性一致 |
| D5 | **不改写用户数据**：按钮只写 `propose-request.json`（新文件），不动 spans/plan/画像 | 请求记录是独立审计文件，与既有高亮状态解耦 |

### 5. 实施

#### 5.1 交付物 ①：host 路由（`host/plugin.js`）

1. **`resolvePaperId(root, requested)`**：解析目标论文（query → body → 首篇回退，与 `/read` 一致）。
2. **`paperTitle(root, paperId)`**：从 `paper.md` 首个非标题行取标题（尽力而为，失败回退 paper_id）。
3. **`handleProposeRequest(root, url, req, res, send)`**：POST 落盘 `data/<paper_id>/propose-request.json` = `{paper_id, title, requested_at: ISO, status:'pending'}`，返回 `{ok:true, ...}`。
4. **`handleProposeRequestGet(root, url, res, send)`**：GET 回读（200）或 404。
5. **路由矩阵**新增两条（POST / GET），`module.exports` 导出两个 handler。

#### 5.2 交付物 ②：client 数据函数 + 按钮 + 空态（`client/render-body.js`）

1. **`callProposeRequest(paperId, transport)`**：POST `/paper-hl/propose-request?paperId=…`（body `{paper_id}`），ok 判定 + 无 transport 干净拒绝。
2. **`copyInstruction(text)`**：优先 `navigator.clipboard.writeText`，回退临时 textarea + `execCommand('copy')`，再失败则指令仍在 flash 中可见（不崩溃）。
3. **`requestRepropose()`**（组件闭包）：调 `callProposeRequest(paperId)` → 成功复制指令「请为《title》重新提出高亮（paper_id: …）：先执行 global-read 重建逐节计划，再逐节 propose」+ flash「已记录请求（pending）并复制指令。请对 Agent 说/粘贴：『请为《title》重新提出高亮』」；失败 flash「请求重新提出高亮失败：…」。
4. **工具栏按钮**（`phl-repropose-btn`，位于「格式化」之后）+ **空态 CTA**（`phl-empty-cta`，当 `spans.length === 0` 时渲染，含提示 + 同款按钮）。
5. **`dispatchRef.current`** 暴露 `requestRepropose`；`module.exports` 导出 `callProposeRequest`；BODY 嵌入 `${callProposeRequest.toString()}`。
6. **CSS**：`.phl-repropose-btn` / `.phl-empty-cta` / `.phl-empty-text` / `.phl-empty-hint`。

#### 5.3 交付物 ③：bundle 生成（`scripts/gen-client.js`）

1. **`proposeData` transport**：POST `/paper-hl/propose-request?paperId=…`（durable bundle 接线；dynamic half 只读 → `callProposeRequest` 干净拒绝）。
2. **`exports.callProposeRequest = callProposeRequest;`**。

#### 5.4 验证方法

- **离线**：`node test/run-render.js`（`v054`：`callProposeRequest` ok/ok:false/no-transport + URL/body 断言；EMBED_HELPERS 加 `callProposeRequest`）· `node test/run-actions.js` · `node test/run-plugin.js`（propose-request 路由：POST 200+pending / 落盘文件字段 / GET 回读 / 无 paperId 回退首篇）。
- **bundle 守卫**：`node scripts/simulate-render.js`（新增 `p2h` 静态守卫：`callProposeRequest`/`proposeData`/`/paper-hl/propose-request`/`phl-repropose-btn`/`重新提出高亮`/`请为《`/`phl-empty-cta`/`requestRepropose`；E2E `P2-h` 在恢复数据后：工具栏按钮点击 → POST {paper_id} + flash「已记录请求」+「请为《…》重新提出高亮」）。当前 live 0 高亮仍受 `expectedSpans > 0` 阻塞，守卫通过即可。
- **真实探针**：`node test/.tmp/propose-request-probe.js`（真实 bundle + 真实 `/read` + `/profile`，`/propose-request` mock）—— 断言：h1 渲染、**工具栏 + 空态 CTA 两个按钮都在**（0 高亮数据）、点击 → 恰好一次 POST、body `{paper_id}`、flash 含「已记录请求」+「请为《」+「重新提出高亮」。**PASS**。
- **bundle 残留检查**（Node `readFileSync utf8`，勿用 PowerShell）：`phl-math/MathJax` 引用 = 0；`reject_section/rejectSection` 残留 = false；`revert_section/revertSection/已恢复为待审/localRevertSectionSpans` = true；`callProposeRequest/proposeData//paper-hl/propose-request/重新提出高亮/phl-empty-cta/requestRepropose` = true。

#### 5.5 风险与边界

- **按钮不直接触发 Agent**：点击后需要用户粘贴指令（或说「重新提出高亮」）到会话，Agent 才执行 global-read → propose。这是 DSH 插件/Agent 边界的硬约束（已向用户解释并确认）。
- **`propose-request.json` 是审计标记**：Agent 处理时按需读取/更新（`status:'running'/'done'` 或删除），本版本只落 pending 标记。
- **不污染数据**：只新增 `propose-request.json` 文件，不改 spans/plan/画像。

### 6. 命令速查

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

### 7. v0.5.4.1（追加：顶端导航栏固定）

> 版本：v0.5.4.1（**纯 client**：顶端导航栏/控制条组固定，滚动论文时保持在顶端）· 状态：**bundle 守卫 PASS + 探针 PASS + 离线三件套 PASS（归档 `v0.5.4.1`）** · 2026-09-01

**需求**：滚动鼠标时论文内容滑动、顶端导航栏保持在顶端。

**难度评估**：低，纯 CSS（不动 host、不碰数据）。

**根因**：`.phl-wrap{height:100%;overflow:hidden}` 的设计意图是「顶部固定 + `.phl-body` 内部滚动」，但 `height:100%` 依赖挂载槽位给受限高度；当 DSH 会话视图为自动高度时整块随页面滚动、顶栏被带走。

**实现**（`client/render-body.js` + `scripts/gen-client.js`）：
1. **结构**：主 return 中 `header + legend + progressBar + sectionBar`（正文上方全部控制区）包进 `<div className="phl-top">`；`body`/`emptyCta`/对话框/提示在条外、随滚动。
2. **CSS**：
   - `.phl-wrap` `overflow:hidden` → **`overflow:visible`**（关键：`overflow:hidden` 祖先会成为不可滚动的滚动容器，**静默禁用 `position:sticky`**）。
   - `.phl-top{position:sticky;top:0;z-index:20;margin:-16px -20px 8px;padding:16px 20px 0;background:rgba(18,18,22,.97);box-shadow:0 2px 8px rgba(0,0,0,.25)}` —— 负 margin 抵消 wrap 内边距做通栏；不透明底 + 阴影盖住滚过的正文；`z-index:20` 在正文 `<mark>` 之上、对话框(23)/flash(30) 之下。
3. **两种场景都稳**：槽位受限（内部滚动）时条本来就不动；槽位自动高度（页面滚动）时 sticky 钉到最近滚动祖先（会话视图）顶端。

**验证**：simulate-render 新增 `p2i` 静态守卫（`.phl-top/position:sticky/top:0/z-index:20/overflow:visible`）PASS；propose-request 探针更新断言（空态 CTA 仅 0 高亮时显示、工具栏按钮恒在）PASS；revert-flow 探针 PASS（`.phl-top` 包裹未破坏节芯片/画像按钮点击）；离线三件套 PASS。**纯 client → 刷新页面即生效，无需重启 3081。**

> 说明：simulate-render E2E 仍受 `expectedSpans > 0` 阻塞（simulate 固定测首篇 p-mikolov，该篇仍 0 高亮）；sticky 静态守卫已覆盖。

### 8. v0.5.4.3（移除「标记本节审查完毕」按钮 + Ctrl+Enter 快捷键）

> 版本：v0.5.4.3（**纯 client**：下线与节列表功能重叠且滚动定位不稳的旧按钮）· 状态：**bundle 负向守卫 + 离线三件套 + 探针全 PASS** · 2026-09-01

**需求**：有了章节目录按钮（点=一键审批+标记已审，Shift+点=反选），导航栏里的「标记本节审查完毕」按钮功能完全被取代，应移除；且该按钮依赖 `currentSection` 滚动定位（`getBoundingClientRect` 需真实布局），未滚动/定位失败时回退到 `sectionItems[0]`（会误标记第一节 ABSTRACT）——这就是它「无法正常工作」的根因。

**移除范围**（`client/render-body.js`）：
1. 工具栏按钮元素（`phl-review-btn`）。
2. `markCurrentReviewed` 闭包（含 `review_section` 乐观更新 + 失败回读校准）。
3. `dispatchRef` 中的 `markCurrentReviewed` 出口。
4. `keyAction` 的 Ctrl+Enter → `markSectionReviewed` 分支 + 键盘 effect 的对应 dispatch（连同 keyAction 调用点里已死的 `currentSection`/`sectionItems` 传参）。
5. `.phl-review-btn` 三条 CSS。

**保留**：host 侧 `review_section` 动作（`actions.js`/`plugin.js`/`run-actions`/`run-plugin` 契约不动——仅 GUI 不再发送；反选/审批用 `revert_section`/`approve_section`）；`currentSection` 状态（仍驱动节芯片「当前节」高亮）。

**验证**：simulate-render 新增 `p2eRemoved` **负向静态守卫**（`phl-review-btn/标记本节审查完毕/markCurrentReviewed/markSectionReviewed/标记当前节审查完毕/review_section` 均不得出现在 bundle）PASS；P2-e 交互断言改为「树中无该按钮」；run-render keyAction 矩阵改为「Ctrl+Enter 忽略」；离线三件套 PASS；probe PASS。**纯 client → 刷新页面即生效，无需重启 3081。**

