# Paper Highlight Agent — v0.5.3 项目进度（放弃数学渲染 + 一键审批反选 + 画像面板修复）

> 版本：v0.5.3（①移除 v0.5.1 轻量公式渲染、回滚至 v0.5.0 纯文本渲染（图例彩色语义保留）②一键审批新增「反选」= **批量恢复待审**（Shift+点击，撤销一键审批）③修复画像面板空白/无法返回）· 状态：**Phase 0 完成 + 离线测试 PASS + live client bundle 验证（归档 `v0.5.3`）** · 创建：2026-08-31 · 最近更新：2026-08-31
> **独立使用说明**：本文件含 v0.5.2 继承状态、v0.5.3 目标/已锁定决策/实施步骤（含验证方法）/风险/命令，可脱离旧文件单独续作；旧版记录见 `paper-highlight-progress-v0.5.1.md` / `paper-highlight-progress-v0.5.2.md`（归档）。
> **v0.5.3 背景**：用户连续遇到数学渲染相关问题（灰块覆盖公式）后，明确要求「回滚至 v0.5.0，放弃数学渲染」，并同时要求：①图例语义彩色显示保留并重新实现；②修复进入画像页面空白、无法返回的问题。经确认，v0.5.2 的章节目录一键审批**保留**，并**新增一键审批的「反选」功能**。
> **v0.5.3 反选语义澄清（用户修正）**：「反选」**不是批量否决**，而是**批量设置为「待审」状态** —— 即**撤销该节的一键审批**：把该节已接受（accepted）的高亮批量恢复为待审（proposed），并把该节状态恢复为待审查（pending）。

---

## 1. 项目定位与 v0.5.3 目标

- **项目一句话**：在 DeepSeek Harness（DSH）之上构建单论文多色高亮 Agent —— 用户提供论文 PDF → MinerU 云 API 解析为结构化 Markdown → `dsh web`（paper profile, 3081）GUI 整体渲染 → Agent 依据「论文整体认识 + 领域发展线 + 用户画像」逐节提出语义高亮 → 用户审查修改 → 画像持续学习 → **导出**。
- **v0.1–v0.5.2（已完成，归档）**：管线打通 → 审查闭环 → 画像收敛 → 打磨导出 → 一键格式化（工厂重置）→ 图例彩色语义 + 轻量公式渲染 → 章节目录一键审批。
- **v0.5.3 目标（用户提出，原始需求逐字）**：
  > 回滚至 v0.5.0，放弃数学渲染，重新实现 1. 将页面的「核心洞见/贡献 关键定义/方法 局限/风险 可借鉴/启发 待深挖/存疑」这几个高亮语义，用对应的彩色显示。 2. 修复进入画像页面后显示空白，无法返回的问题。
  - 用户自定义补充（反选）：**在保留 v0.5.2 一键审批的基础上，增加一键审批的反选功能**。用户随后明确：**反选 = 批量设置为「待审」状态（不是批量否决）**。
  - 拆解为三个交付物：
    1. **放弃数学渲染**：移除 v0.5.1 的轻量公式渲染（纯 tokenizer + Unicode 转换），`renderText` / `buildBlockSegments` / `nodeOffsetToSeg` / CSS（`.phl-math*`）/ BODY 嵌入 / bundle 导出全部还原为 v0.5.0 纯文本渲染 —— 正文按原文逐字节显示，不再出现公式灰块；**图例五个语义标签彩色显示（`phl-legend-label`）保留**。
    2. **画像面板空白 + 无法返回修复**：`renderProfilePanel` 在「示例库为空」时 `exemplarRows` 是单个 React 元素（非数组），下方 `...exemplarRows` 展开 → `Spread syntax requires ...iterable` 运行时崩溃 → 整个面板渲染失败（空白）+「返回论文」按钮也渲染不出来（无法返回）。该 bug 为 v0.3 遗留潜在 bug，格式化后画像示例=0 才暴露。修复：`exemplarRows` 恒返回数组（空态包裹在数组中）。
    3. **一键审批「反选」= 批量恢复待审**：**Shift+点击**章节芯片 = **撤销该节的一键审批** —— 把该节已接受（accepted）的高亮批量恢复为**待审**（proposed）+ 该节状态恢复为**待审查**（pending）。host 新增原子动作 `revert_section`（镜像 `approve_section`），client 新增 `revertSection(id)`（镜像 `approveSection(id)`）；普通点击仍为一键审批。**注意：不是批量否决（rejected），否决/已拒绝的高亮不受影响。**

## 2. 关联文档

| 文档 | 路径 | 用途 |
|---|---|---|
| 设计文档 | `D:\aa\docs\paper-highlight-agent-design.md` | §4 数据模型、§6 画像防污染、§9 目录结构 |
| v0.5.1 进度归档 | `D:\aa\docs\paper-highlight-progress-v0.5.1.md` | 图例/公式 + 空白页热修复交付记录（v0.5.1 已归档；**公式渲染已于 v0.5.3 移除**） |
| v0.5.2 进度归档 | `D:\aa\docs\paper-highlight-progress-v0.5.2.md` | 章节目录一键审批交付记录（v0.5.2 已归档） |
| 一页纸快照 | `D:\aa\docs\paper-highlight-one-pager.md` | 项目状态速览（v0.5.3 已同步） |
| 用户指南 | `D:\aa\docs\paper-highlight-user-guide.md` | 面向使用者的「反选/恢复待审」说明与 FAQ |
| 本文件 | `D:\aa\docs\paper-highlight-progress-v0.5.3.md` | v0.5.3 进度（当前） |

## 3. v0.5.2 继承状态（独立使用必需）

### 3.1 运行环境
- Windows；harness `dsh web`（port 3080，profile `web`）；**paper profile 独立跑 3081**
- paper profile 启动：`dsh --profile paper --port 3081 --no-open`（后台 job；`prepareProfile` 会重写 profile/cordis.yml，启动需 danger-full-access）
- 沙箱：`D:\aa` 内写入免授权；工作区外需 danger-full-access 一次性升级 + 用户批准

### 3.2 关键路径与交付物（v0.5.2 已就绪，勿重复造）
- git：**tag `v0.5.2`**（章节目录一键审批，含同日公式灰块热修复）
- 插件包 `D:\aa\packages\paper-highlight/`：
  - `host/`：`schema.js` / `store.js` / `mineru.js` / `normalize.js` / `pipeline.js` / `plugin.js`（`/paper-hl` 路由矩阵，含 `POST /write` / `POST /format`）/ `sections.js` / **`actions.js`（v0.5.2 `approve_section`；v0.5.3 新增 `revert_section`）** / `diff.js` / `profile.js` / `export.js` / `reflection.js` / `format.js` / `tools.js` + `tools-plugin.mjs`
  - `client/`：`render-body.js`（渲染逻辑单一来源）、`client.js`（durable bundle）、`dynamic/client-half.js`
  - `scripts/`：`gen-client.js` / `simulate-render.js` / `verify-http.js` / `check-host.js` / `check-utf8.js` 等
  - `test/`：`run-mock.js` / `run-tools.js` / `run-actions.js` / `run-plugin.js` / `run-render.js` / `run-profile.js` / `run-export.js` / `run-reflect-paper.js` / `run-format.js`
- 数据根：`D:\aa\data/<paper_id>/`；画像根：`D:\aa\highlight-profile/`

### 3.3 环境纪律（每次续作必读）
1. **3081 = 会话 Web，Agent 不得自行 kill/restart**；host 代码变更后由**用户手动重启**；live 验证前先 `GET /paper-hl/read` 确认新代码已加载。
2. **client 变更**：bundle 按请求从磁盘读，刷新页面即生效（无需重启）。
3. **host 变更**：`revert_section` / `approve_section` 动作需重启 3081 后落盘生效；重启前客户端会提示「恢复待审/审批失败（已回读校准）」并回读，不损坏数据。
4. 数据状态（v0.5.0 格式化后）：3 篇论文 0 spans / 0 plan / 0 duplicates；`highlight-profile/` 冷启动默认（2 条规则 + 0 示例）。**不重新灌演示数据。**

## 4. 已锁定决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | **移除 v0.5.1 数学渲染**，`renderText`/`buildBlockSegments`/`nodeOffsetToSeg`/CSS/嵌入/导出还原 v0.5.0 | 用户明确要求「回滚至 v0.5.0，放弃数学渲染」；数学渲染反复出问题（空白页、灰块） |
| D2 | **图例彩色语义保留**（`phl-legend-label` 彩色标签 + CSS） | 用户需求 ①「把高亮语义用对应彩色显示」—— 这是 v0.5.1 的 ① 部分，保留 |
| D3 | **保留 v0.5.2 一键审批**（点击 = approve_section） | 用户确认保留 v0.5.2；只放弃数学渲染 |
| D4 | **新增「反选」= 批量恢复待审**：Shift+点击章节芯片 = `revert_section`（该节 accepted → proposed 待审 + 该节 → pending 待审查） | 用户自定义：在保留一键审批基础上增加反选功能；用户明确反选 = 批量设置待审（非否决）；Shift+点击为最轻量、与普通点击共用一个芯片 |
| D5 | **画像面板修复**：`exemplarRows` 空态恒返回数组（`[<empty div>]`），不再 `...exemplarRows` 展开单个元素 | 根因 = v0.3 遗留潜在 bug，空示例时展开崩溃 → 空白 + 无法返回 |
| D6 | **只回滚数学，不 git revert 整个 v0.5.2**：在当前 v0.5.2 树上手术式剥离数学 | 若 `git revert` 到 v0.5.0 会把一键审批一起丢掉，需重新加回；剥离路径保留全部非数学特性 |

## 5. 实施

### 5.1 交付物 ①：放弃数学渲染（回滚至 v0.5.0 纯文本渲染）

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

### 5.2 交付物 ②：画像面板空白 + 无法返回修复

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

### 5.3 交付物 ③：一键审批「反选」= 批量恢复待审（撤销一键审批）

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

## 6. 验证

### 6.1 离线测试（全部 PASS）
```
node test/run-render.js    # PASS —— 移除数学矩阵；新增 v0.5.3 反选矩阵（localRevertSectionSpans：accepted→proposed 待审）；嵌入完备性守卫 26 helper（含 localApproveSectionSpans + localRevertSectionSpans）
node test/run-actions.js   # PASS —— 新增 revert_section 批量恢复/只动 accepted/空节/未知节/无索引/幂等/approve→revert 往返/400 矩阵
node test/run-plugin.js    # PASS —— 新增 11g–11i revert_section 路由（approve 2 → revert 2 回待审 + pending、持久化、幂等、400）；真实数据断言放宽为「数组形状」（容忍格式化后 0 spans）
```

### 6.2 无头探针（gitignored，真实 bundle + 真实 3081 数据，写请求 mock）
- `test/.tmp/profile-blank-probe.js`：**画像面板空白修复** —— 面板正常渲染（5 色/2 规则/示例空态/统计/反思笔记）+ 「← 返回论文」可点击返回。PASS。
- `test/.tmp/revert-flow-probe.js`：**反选流程** —— 普通点击芯片 → `approve_section` POST（芯片 done）；Shift+点击同一芯片 → `revert_section` POST（反选 = 恢复待审）+ flash「已恢复为待审」+ 芯片 done 状态清除（回到待审查）；画像面板仍可开/关（回归）。PASS。

### 6.3 bundle / live 验证
- `node scripts/gen-client.js` 重新生成 `client.js`（92327 bytes）+ `dynamic/client-half.js`；`node --check` 语法全过。
- bundle 内容核查（Node 读 UTF-8）：数学标识 0 处；`phl-legend-label` ✓；**无 `reject_section` 残留**，`revert_section`/`revertSection`/`已恢复为待审` ✓；`approve_section`/`已审批通过` ✓。
- `scripts/simulate-render.js` 静态守卫全部通过（含 v0.5.3 `p2g` 反选守卫 `revert_section`/`revertSection`/`localRevertSectionSpans`/`已恢复为待审`；`p2d` 已移除 `pushPlainSegs`；`v051` 仅保留 `phl-legend-label`）。**注意**：simulate-render 全量 E2E 仍受「演示数据为空」阻塞（`expectedSpans > 0`，v0.5.0 格式化后的既有依赖；重新 propose 出高亮后自动恢复）。
- live 3081：client bundle 按请求从磁盘读，**刷新页面即生效**；`/paper-hl/read`、`/paper-hl/profile` 健康。**host 变更（`revert_section`/`approve_section`）需用户重启 3081 后落盘生效**。

## 7. 风险 / 遗留

| # | 风险/遗留 | 状态 |
|---|---|---|
| 1 | simulate-render / run-plugin 第 2 步依赖演示数据非空（格式化后 0 spans） | 既有依赖；run-plugin 已放宽为数组形状；simulate-render 全量需重新 propose 出高亮后自动恢复 |
| 2 | host 变更未落盘：重启 3081 前点击/Shift+点击会提示「审批/恢复待审失败（已回读校准）」并回读，不损坏数据 | 需用户重启 3081 |
| 3 | 画像面板修复覆盖的是「示例为空」崩溃路径；示例非空路径此前模拟测试已覆盖 | ✅ |
| 4 | 数学移除是**有意回滚**（用户要求），`progress-v0.5.1.md` 中的公式渲染记录属历史归档，不再作为当前能力 | ✅（文档已注明） |

## 8. 复现命令

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

## 9. 里程碑

| 里程碑 | 验收 | 达成 |
|---|---|---|
| M1 | 数学渲染彻底移除（renderText/buildBlockSegments/nodeOffsetToSeg/CSS/嵌入/导出还原 v0.5.0），bundle 无数学残留；图例彩色语义保留 | ✅ |
| M2 | 画像面板空白 + 无法返回修复（空示例 `...exemplarRows` 展开崩溃 → 恒返回数组），探针验证面板可开可关 | ✅ |
| M3 | 一键审批「反选」= 批量恢复待审（`revert_section` + `revertSection` + Shift+点击，accepted→proposed + 节→pending，非否决），离线矩阵 + 路由 + 探针 PASS | ✅ |
| M4 | 文档同步（one-pager / README / user-guide）+ git 提交 + tag `v0.5.3` | ✅ |

---

*归档记录：v0.5.1（图例彩色语义 + 轻量公式渲染 + 空白页热修复）→ v0.5.2（章节目录一键审批 + 公式灰块热修复）→ **v0.5.3（放弃数学渲染 + 一键审批反选 + 画像面板修复）**。*
