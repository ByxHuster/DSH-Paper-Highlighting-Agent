# Paper Highlight Agent — v0.5 项目进度（一键格式化 / 工厂重置）

> 版本：v0.5（一键格式化）· 状态：**Phase 0 完成 + live 验证 PASS（已归档 `v0.5.0`）** · 创建：2026-08-27 · 最近更新：2026-08-31
> **独立使用说明**：本文件含 v0.4 继承状态、v0.5 目标/已锁定决策/实施步骤（含验证方法）/风险/命令，可脱离旧文件单独续作；旧版记录见 `paper-highlight-progress-v0.4.md`（归档，v0.4.0）。

---

## 1. 项目定位与 v0.5 目标

- **项目一句话**：在 DeepSeek Harness（DSH）之上构建单论文多色高亮 Agent —— 用户提供论文 PDF → MinerU 云 API 解析为结构化 Markdown → `dsh web`（paper profile, 3081）GUI 整体渲染 → Agent 依据「论文整体认识 + 领域发展线 + 用户画像」逐节提出语义高亮 → 用户审查修改 → 画像持续学习 → **导出**。
- **v0.1（已完成，归档）**：管线打通 —— PDF → MinerU → `data/<paper_id>/` 归一化产物 → Agent 工具读写高亮 JSON → GUI 渲染正文 + 显示 spans。
- **v0.2（已完成，归档 `v0.2.0`）**：审查闭环 —— 「全局通读 → 逐节 propose → GUI 审查 → 差异分析/章节反思（reflections.json 提案）→ 下一节」核心循环全链路跑通。
- **v0.3（已完成，归档 `v0.3.0`）**：个性化画像收敛 —— 四层画像 + 冷启动 + 摘要注入 + 确认生效机制，三篇同领域论文收敛验收 PASS。
- **v0.4（已完成，归档 `v0.4.0`）**：打磨导出 —— HTML/MD 导出 + 领域地图 `field-map.md` + 论文级反思 + UX（快捷键/进度条/导出对话框）。
- **v0.5 目标**：一键格式化（工厂重置）—— 一个动作清空「所有论文高亮记录 + 个性化画像」，让整个工作区回到开箱即用的初始状态，用于换新课题 / 转交他人 / 重新开始学习。

## 2. 关联文档

| 文档 | 路径 | 用途 |
|---|---|---|
| 设计文档 | `D:\aa\docs\paper-highlight-agent-design.md` | §4 数据模型、§6 画像防污染、§8 范围、§9 目录结构 |
| v0.4 进度归档 | `D:\aa\docs\paper-highlight-progress-v0.4.md` | 导出/领域地图/论文级反思交付记录、验收矩阵、环境纪律 |
| v0.3 进度归档 | `D:\aa\docs\paper-highlight-progress-v0.3.md` | 四层画像/确认机制/收敛验收 |
| 一页纸快照 | `D:\aa\docs\paper-highlight-one-pager.md` | 项目状态速览（v0.5 完成后同步更新） |
| 用户指南 | `D:\aa\docs\paper-highlight-user-guide.md` | 面向使用者的「格式化」章节与 FAQ |
| 本文件 | `D:\aa\docs\paper-highlight-progress-v0.5.md` | v0.5 进度（当前） |

## 3. v0.4 继承状态（独立使用必需）

### 3.1 运行环境
- Windows；harness `dsh web`（port 3080，profile `web`）；**paper profile 独立跑 3081**
- paper profile 启动：`dsh --profile paper --port 3081 --no-open`（后台 job；`prepareProfile` 会重写 profile/cordis.yml，启动需 danger-full-access）
- DSH 安装：`C:\Users\eyx\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh`；profiles：`C:\Users\eyx\.dsh\profiles\`
- 环境变量：`MINERU_API`（已 setx，len=51）；`MINERU_BASE_URL`、`MINERU_UPLOAD_MODE=file|url`、`MINERU_OCR=1`、`MINERU_FORMULA=1`、`MINERU_LANGUAGE`
- 沙箱：`D:\aa` 内写入免授权；工作区外需 danger-full-access 一次性升级 + 用户批准；npm 用 `npm --cache D:\aa\.npm-cache`

### 3.2 关键路径与交付物（v0.4 已就绪，勿重复造）
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

### 3.3 环境纪律（沿用 §3.4，勿破坏）
1. **3081 = 会话 Web**：Agent **不得自行 kill/restart**；需要重启时由用户操作，重启后刷新页面。
2. host 代码变更（plugin/format/tools）后，live 3081 需**用户手动重启**才生效；client 变更（render-body/gen-client → 重新生成 bundle）刷新页面即生效（bundle 按请求从磁盘读取）。
3. 沙箱：`D:\aa` 内写入免授权；工作区外需 danger-full-access 一次性升级 + 用户批准。
4. npm：`npm --cache D:\aa\.npm-cache`。
5. 工单纪律：`node scripts/gen-client.js` 在修改 `client/render-body.js` / `scripts/gen-client.js` 后**必须重跑**，否则 bundle 与单一来源不一致。

## 4. v0.5 目标与已锁定决策

### 4.1 目标（D1）
一键格式化：在 GUI 顶部工具栏提供「**格式化**」危险按钮 → 弹出确认对话框 → 用户确认后清除：
1. **所有论文高亮记录**（`data/<paper_id>/` 内）：
   - `paper.highlights.json` → 重置为空白骨架（**保留** `paper` 元信息 + `anchors` 锚点，清空 `plan` / `spans` / `duplicates`）；
   - `reflections.json`（逐篇反思提案）、`export/`（导出产物）、`paper-reflection.md`（论文级反思）→ 删除；
   - **保留** `paper.md` / `anchors.json` / `meta.json` —— 已解析论文正文不丢，可立即重新 propose。
2. **个性化画像**（`highlight-profile/`）：整个目录删除 → GUI 回到冷启动引导。

### 4.2 已锁定决策（D1–D4）
- **D1（scope）**：支持 `all`（默认）/ `highlights` / `profile` 三种范围 —— `format_all` 工具与 `/paper-hl/format` 路由均可选；GUI 一键固定走 `all`。
- **D2（确认门禁）**：破坏性操作必须显式 `confirm: true`（路由 body / 工具参数），否则 400 / `ok:false` —— 杜绝 GET 预取或误触导致的清空。
- **D3（保留论文正文）**：`paper.md` / `anchors.json` / `meta.json` 永不删除 ——「格式化」清的是高亮与画像，不是论文本身。
- **D4（审计回报）**：格式化响应返回逐项清空计数（`papers_processed` / `spans_cleared` / `plans_cleared` / `duplicates_cleared` / `reflections_removed` / `exports_removed` / `paper_reflections_removed` / `profile_removed` / `rules_cleared` / `exemplars_cleared`），不额外生成备份文件（用户要的就是清空；响应即审计记录）。

## 5. 实施步骤与验证方法

### Phase 0 —— 一键格式化全链路（`format_all` 工具 + `/paper-hl/format` 路由 + GUI 对话框）
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

### 验收方法（M1）
- ✅ `test/run-format.js` PASS（纯逻辑 + 路由矩阵 + 磁盘断言）
- ✅ `test/run-plugin.js` / `run-tools.js` / `run-render.js` 扩展 PASS
- ✅ `scripts/simulate-render.js` P5 交互 PASS（真实 3081 只读数据通路，POST 全 mock，真实数据零改动）
- ✅ `node scripts/gen-client.js` 重新生成 bundle（client.js / client-half.js），check-utf8 PASS
- ✅ **live 3081 冒烟 PASS（2026-08-31，用户重启后）**：
  - `POST /paper-hl/format`（无 confirm）→ **400** `{ok:false,error:'format requires confirm: true (destructive operation)'}`（confirm 门禁生效）；
  - `POST /paper-hl/format`（confirm:true + 未知 scope 'nuke'）→ **400** `{ok:false,error:'format: unsupported scope "nuke"…'}`（scope 校验生效）；
  - **用户实跑格式化**：三篇论文 `paper.highlights.json` 全部重置（0 spans / 0 plan / 0 duplicates），`reflections.json` / `export/` / `paper-reflection.md` 全部删除，`paper.md` / `anchors.json` / `meta.json` 保留，`highlight-profile/` 被删除后经冷启动 init 重建（2 条默认规则 + 0 示例 + 0 统计）—— 全链路行为与设计完全一致 ✅

## 6. 风险

| # | 风险 | 缓解 |
|---|---|---|
| 1 | **格式化误触清空真实数据** | POST 专属路由（GET 404）+ 必须 `confirm:true` + GUI 二次确认对话框（危险样式 + 不可撤销提示） |
| 2 | 格式化误删论文正文 | D3：`formatAll` 只触碰 `paper.highlights.json`/`reflections.json`/`export/`/`paper-reflection.md` 与 `highlight-profile/`，`paper.md`/`anchors.json`/`meta.json` 永不删除（测试有磁盘断言） |
| 3 | `ensureProfile` 副作用在格式化时重建画像 | `countProfileLayers` 直读 `rules.json`/`exemplars.json` 计数，不调用 `readProfile`（会 ensure 创建缺失层） |
| 4 | host 代码未重启导致 GUI 点「格式化」404 | 环境纪律：host 变更由用户重启 3081；verify-http 用「无 confirm → 400」安全探针区分新旧 host |
| 5 | 测试误删真实数据 | 全部 fixture 在 `test/.tmp/`（gitignored）；simulate-render 的 format POST 走 mock，真实数据零改动 |

## 7. 命令速查（v0.5）

```powershell
$env:NODE_PATH = 'C:\Users\eyx\.dsh\profiles\node_modules'   # fflate 解析
node test/run-format.js          # v0.5 一键格式化纯逻辑 + 路由矩阵
node test/run-plugin.js && node test/run-tools.js && node test/run-render.js   # 扩展回归
node scripts/gen-client.js       # 改 render-body.js / gen-client.js 后必须重跑
node scripts/simulate-render.js  # live 3081，含 P5 格式化交互（POST mock，真实数据零改动）
node scripts/verify-http.js      # 路由自检（含 format 安全探针）
node scripts/check-host.js && node scripts/check-utf8.js
```

## 8. 交付记录（v0.5.0 已归档）

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 | 一键格式化全链路完成 + live 验证 PASS | ✅ `host/format.js`（纯逻辑 + 三 scope + confirm 门禁）+ `POST /paper-hl/format` 路由（GET 404 / 缺 confirm 400 / 未知 scope 400）+ `format_all` 工具（12 工具）+ GUI 格式化按钮 + 确认对话框 + `callFormat` 传输 + `run-format.js` PASS + run-plugin/run-tools/run-render 扩展 PASS + simulate-render P5 交互 PASS + gen-client 重跑 + check-utf8 PASS + **live 3081 冒烟 PASS（用户重启后：无 confirm → 400 / 未知 scope → 400；用户实跑格式化，磁盘状态与设计完全一致）** → **归档 `v0.5.0`（2026-08-31）** |

