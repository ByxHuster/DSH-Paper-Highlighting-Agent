# Paper Highlight Agent — v0.5.2 项目进度（章节目录一键审批）

> 版本：v0.5.2（新交互：点击章节目录审批通过该节全部高亮，含「无高亮」情形）· 状态：**Phase 0 完成 + 离线测试 PASS + live client bundle 验证（待归档 `v0.5.2`）** · 创建：2026-08-31 · 最近更新：2026-08-31
> **独立使用说明**：本文件含 v0.5.1 继承状态、v0.5.2 目标/已锁定决策/实施步骤（含验证方法）/风险/命令，可脱离旧文件单独续作；旧版记录见 `paper-highlight-progress-v0.5.1.md`（归档，v0.5.1 + 空白页热修复）。

---

## 1. 项目定位与 v0.5.2 目标

- **项目一句话**：在 DeepSeek Harness（DSH）之上构建单论文多色高亮 Agent —— 用户提供论文 PDF → MinerU 云 API 解析为结构化 Markdown → `dsh web`（paper profile, 3081）GUI 整体渲染 → Agent 依据「论文整体认识 + 领域发展线 + 用户画像」逐节提出语义高亮 → 用户审查修改 → 画像持续学习 → **导出**。
- **v0.1–v0.5.1（已完成，归档 `v0.5.1`）**：管线打通 → 审查闭环 → 画像收敛 → 打磨导出 → 一键格式化（工厂重置）→ 图例彩色语义 + 轻量公式渲染。
- **v0.5.2 目标（新交互，用户提出）**：
  > 允许用户通过点击章节目录（例如点击 Abstract 标签）来**审批通过该部分的所有高亮**，这应当包括 agent 在该部分**没有提出高亮**的情况。
  - 即：点击章节芯片（TOC 条）→ **批量接受该节全部 proposed 高亮** + **标记该节审查完毕**；该节 agent 没提任何高亮时，点击同样「通过」该节（标记审查完毕）。

## 2. 关联文档

| 文档 | 路径 | 用途 |
|---|---|---|
| 设计文档 | `D:\aa\docs\paper-highlight-agent-design.md` | §4 数据模型、§6 画像防污染、§9 目录结构 |
| v0.5.1 进度归档 | `D:\aa\docs\paper-highlight-progress-v0.5.1.md` | 图例/公式 + 空白页热修复交付记录（v0.5.1 已归档）、环境纪律 |
| 一页纸快照 | `D:\aa\docs\paper-highlight-one-pager.md` | 项目状态速览（v0.5.2 完成后同步更新） |
| 用户指南 | `D:\aa\docs\paper-highlight-user-guide.md` | 面向使用者的「章节目录一键审批」说明与 FAQ |
| 本文件 | `D:\aa\docs\paper-highlight-progress-v0.5.2.md` | v0.5.2 进度（当前） |

## 3. v0.5.1 继承状态（独立使用必需）

### 3.1 运行环境
- Windows；harness `dsh web`（port 3080，profile `web`）；**paper profile 独立跑 3081**
- paper profile 启动：`dsh --profile paper --port 3081 --no-open`（后台 job；`prepareProfile` 会重写 profile/cordis.yml，启动需 danger-full-access）
- 沙箱：`D:\aa` 内写入免授权；工作区外需 danger-full-access 一次性升级 + 用户批准

### 3.2 关键路径与交付物（v0.5.1 已就绪，勿重复造）
- git：**tag `v0.5.1`**（图例/公式 + 空白页热修复），工作区 clean（本版本改动前）
- 插件包 `D:\aa\packages\paper-highlight/`：
  - `host/`：`schema.js` / `store.js` / `mineru.js` / `normalize.js` / `pipeline.js` / `plugin.js`（`/paper-hl` 路由矩阵，含 `POST /write` / `POST /format`）/ `sections.js` / **`actions.js`（v0.5.2 新增 `approve_section`）** / `diff.js` / `profile.js` / `export.js` / `reflection.js` / `format.js` / `tools.js` + `tools-plugin.mjs`
  - `client/`：`render-body.js`（渲染逻辑单一来源）、`client.js`（durable bundle）、`dynamic/client-half.js`
  - `scripts/`：`gen-client.js` / `simulate-render.js` / `verify-http.js` / `check-host.js` / `check-utf8.js` 等
  - `test/`：`run-mock.js` / `run-tools.js` / `run-actions.js` / `run-plugin.js` / `run-render.js` / `run-profile.js` / `run-export.js` / `run-reflect-paper.js` / `run-format.js`
- 画像存储：`D:\aa\highlight-profile/`（v0.5 格式化后为**冷启动默认**：2 条默认规则 + 0 示例 + 0 统计）
- 论文数据：`D:\aa\data/<paper_id>/`（v0.5 格式化后高亮已清空：0 spans / 0 plan / 0 duplicates；`paper.md`/`anchors.json`/`meta.json` 保留）

### 3.3 环境纪律（沿用 §3.3，勿破坏）
1. **3081 = 会话 Web**：Agent **不得自行 kill/restart**；需要重启时由用户操作。
2. **host 代码变更后 live 3081 需用户手动重启才生效**；client 变更（render-body/gen-client → 重新生成 bundle）刷新页面即生效（bundle 按请求从磁盘读取）。
   - ⚠️ **v0.5.2 同时改了 host（actions.js / plugin.js）与 client**：客户端刷新即见新 UI，但「点击审批」要真正落盘，**必须重启 3081**（否则旧 host 对 `approve_section` 返回 400 unsupported action，页面会提示「审批失败（已回读校准）」）。
3. 工单纪律：修改 `client/render-body.js` / `scripts/gen-client.js` 后**必须重跑** `node scripts/gen-client.js`。

## 4. v0.5.2 目标与已锁定决策

### 4.1 目标（D1）
点击**章节目录芯片**（顶部 `.phl-section` 条，如 `Abstract`）→ **批量接受该节全部 proposed 高亮**（status=accepted，逐条追加用户 decision 审计）+ **标记该节审查完毕**（plan.sections 状态 reviewed + reviewed_at）。**agent 未在该节提出任何高亮时，点击同样「通过」该节**（接受 0 处 + 仍标记已审），并给出明确反馈文案。

### 4.2 已锁定决策（D2–D4）
- **D2（原子 host 动作 `approve_section`）**：不逐条发 N+1 次 `/paper-hl/write`，新增**单个原子动作** `POST /paper-hl/write {action:'approve_section', section:<id>}` —— 一次读取 + 一次校验 + 一次落盘；节内 `proposed` spans 全部 `accepted`（每条追加 `{action:'accepted', by:'user'}` decision），再标记节 reviewed。已 `accepted` / `user_added` / `rejected` 的 span 一律不动。
- **D3（归属判定用构建的节索引）**：哪些 span 属于该节，按 `buildSections` 的 `anchor_ids`（节标题锚点 + 节内正文锚点）判定；节 id 未知 / 无 sections 索引时**接受 0 处 + 仍标记 reviewed**（「无高亮」与「未知节」都优雅通过，绝不报错拒绝）。
- **D4（client 乐观 + 回读校准）**：点击芯片 → 本地乐观批量接受（`localApproveSectionSpans`，仅翻转 status）+ 乐观标记节已审（✓）→ 发 `approve_section` → 成功：用返回的 `accepted` spans 逐条 `reconcileSpan`、合并节 entry（不整页回读）；失败：提示 + 整页 `/read` 回读校准（回滚乐观状态）。响应携带 `accepted`（接受的 span 列表）+ `accepted_count`（`plugin.js` 扩展）。

### 4.3 与既有「标记本节审查完毕」的关系
- 保留既有 `review_section`（工具栏按钮 / Ctrl+Enter）：只标记当前节已审，**不动任何 span**。
- 新增 `approve_section`（点击节芯片）：**批量接受 + 标记已审**。二者语义互补、互不影响。

## 5. 实施步骤与验证方法

### Phase 0 —— 章节目录一键审批（host + client 变更）
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

### 验收方法（M1）
- ✅ `test/run-actions.js` PASS（新增）：`approve_section` 接受节内全部 proposed span（`s-002` 被接受、节外 `s-001` 不动）、`accepted_count` 正确、逐条追加用户 decision、已 accepted/user_added/rejected 不动；**0 proposed 的节 / 未知节 id / 无 sections 索引 → 接受 0 + 仍标 reviewed**；空/非字符串 section → 抛错；文档 schema 仍有效。
- ✅ `test/run-render.js` PASS（新增）：`localApproveSectionSpans`（节内 proposed→accepted；已接受/用户新增/拒绝/节外不动；已接受保持同一性；空集合 / null 安全）；**嵌入完备性守卫更新为 39 个 helper**（含 `localApproveSectionSpans`）。
- ✅ **`approve_section` 路由探针 PASS（一次性，throwaway fixture）**：`POST /paper-hl/write {action:'approve_section',section:'s2'}` → 200、`accepted_count=2`、`section.status=reviewed`、磁盘 2 accepted + References 的 `s-003` 不动；再审批 References → 1；重复审批 Abstract → 0（幂等）；空 section → 400。`test/run-plugin.js` 已加入对应用例（11b–11f，fixture `seedFixtureApprove`），待演示数据非空后随全量回归执行。
- ✅ `node scripts/gen-client.js` 重新生成 bundle，`node --check` 语法 OK；bundle 含 `localApproveSectionSpans` / `approve_section` / `已审批通过` / `.phl-section:hover`。
- ✅ `scripts/simulate-render.js`：新增 **P2-f 静态守卫**（`approve_section`/`approveSection`/`localApproveSectionSpans`/`data-phl-sec`/`已审批通过`，渲染前对 bundle 源码检查，**不依赖演示数据非空**）打印并通过；新增 **P2-f 交互测试**（点未审节芯片 → POST `approve_section` 目标节 → mock 返回恰好该节 spans → 芯片 ✓、mock `accepted_count===proposedBefore`、每个接受的 span 都属于该节）——位于 `expectedSpans>0` 之后，**待演示数据非空后随全量回归执行**。
- ✅ **live 3081 client bundle 验证（2026-08-31）**：`GET /plugins/paper-highlight/client.js` → 200，内容含 `localApproveSectionSpans` / `approve_section` / `已审批通过`（**刷新页面即见新 UI**）。
- ⚠️ **host 生效条件**：`approve_section` 需新 host（actions.js/plugin.js 为启动时加载）—— **请用户重启 3081** 后点击章节芯片才能落盘（重启前客户端会提示审批失败并回读校准，不损坏数据）。

> ⚠️ **已知（非本版本回归）**：v0.5 用户实跑格式化后，三篇论文高亮已清空（0 spans）+ 画像回到冷启动默认 —— 依赖**演示数据非空**的 `scripts/simulate-render.js`（断言 `expectedSpans > 0`）与 `test/run-plugin.js` 第 2 步（断言原始 5 条演示 span 仍在）当前会失败；重新 propose 出新高亮后自动恢复。这不是代码缺陷，是格式化清空数据的预期结果。v0.5.2 的新交互测试（P2-f / run-plugin 11b–11f）同样在数据恢复后自动生效。

## 6. 风险

| # | 风险 | 缓解 |
|---|---|---|
| 1 | 批量接受误伤（用户只想标记已审、不想动高亮） | 点击节芯片 = 明确的「审批通过」意图；仅接受 `proposed`，已接受/用户新增/拒绝不动；既有「标记本节审查完毕」（`review_section`）保留，二者语义分离 |
| 2 | 节归属判定错误（span 跨节 / 锚点归属） | D3：用 `buildSections` 的 `anchor_ids`（标题锚点 + 节内锚点）判定；真实数据路径与 propose 同一套节索引 |
| 3 | 未知节 / 空节报错 | 接受 0 + 仍标记已审（「通过空节」是需求本身）；未知节 id 同样优雅通过并创建 reviewed 条目 |
| 4 | 乐观更新与服务端不一致 | D4：成功用返回 spans 逐条 reconcile + 合并节 entry；失败整页 `/read` 回读校准（回滚） |
| 5 | 旧 host 未重启时点击 → 400 | 客户端失败路径提示「审批失败（已回读校准）」并回读，不损坏数据；文档/交付记录明确「需重启 3081」 |
| 6 | bundle 与单一来源不一致 | 环境纪律 §3.3：改 render-body/gen-client 后必须重跑 `gen-client.js`；已重跑 + `node --check`；P2-f 静态守卫纳入 bundle 检查 |

## 7. 命令速查（v0.5.2）

```powershell
$env:NODE_PATH = 'C:\Users\eyx\.dsh\profiles\node_modules'   # fflate 解析
node scripts/gen-client.js       # 改 render-body.js / gen-client.js 后必须重跑
node --check client/client.js    # bundle 语法检查
node test/run-actions.js         # 含 approve_section 单元用例（PASS）
node test/run-render.js          # 含 localApproveSectionSpans + 嵌入完备性守卫（PASS）
node test/run-tools.js && node test/run-format.js   # host 回归（PASS）
node scripts/simulate-render.js  # live 3081 —— P2-f 静态守卫 PASS；交互测试需演示数据非空
```

## 8. 交付记录（v0.5.2 待归档）

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 | 章节目录一键审批 | ✅ `host/actions.js`（`approve_section` 原子动作 + `resolveReviewEntry` 复用）+ `host/plugin.js`（响应携带 `accepted`/`accepted_count`）+ `client/render-body.js`（`localApproveSectionSpans` 纯函数 + `approveSection(id)` + 节芯片 `onClick` + `cursor:pointer`/hover CSS）+ `gen-client.js`（新 export）+ 测试 PASS（run-actions 批量接受/空节/未知节/幂等 + run-render 纯函数/嵌入守卫 39 helper）+ 路由探针 PASS（2 accepted、节外不动、幂等、400）+ live client bundle 验证 PASS（刷新即见新 UI）→ **待用户重启 3081 后落盘生效 → 归档 `v0.5.2`** |
