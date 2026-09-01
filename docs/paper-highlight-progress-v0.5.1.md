# Paper Highlight Agent — v0.5.1 项目进度（图例彩色语义 + 轻量公式渲染）

> 版本：v0.5.1（两个小改动：①图例高亮语义彩色显示 ②内联/行间公式轻量渲染）· 状态：**Phase 0 完成 + 离线测试 PASS + live bundle 验证（已归档 `v0.5.1`）** · 创建：2026-08-31 · 最近更新：2026-08-31
> **⚠️ 已被 v0.5.3 取代**：本版本②的**轻量公式渲染已于 v0.5.3 移除**（回滚至 v0.5.0 纯文本渲染，正文按原文显示）；**①图例彩色语义保留**。本文件仅作历史归档。
> **独立使用说明**：本文件含 v0.5 继承状态、v0.5.1 目标/已锁定决策/实施步骤（含验证方法）/风险/命令，可脱离旧文件单独续作；旧版记录见 `paper-highlight-progress-v0.5.md`（归档，v0.5.0）。

---

## 1. 项目定位与 v0.5.1 目标

- **项目一句话**：在 DeepSeek Harness（DSH）之上构建单论文多色高亮 Agent —— 用户提供论文 PDF → MinerU 云 API 解析为结构化 Markdown → `dsh web`（paper profile, 3081）GUI 整体渲染 → Agent 依据「论文整体认识 + 领域发展线 + 用户画像」逐节提出语义高亮 → 用户审查修改 → 画像持续学习 → **导出**。
- **v0.1–v0.5（已完成，归档 `v0.5.0`）**：管线打通 → 审查闭环 → 画像收敛 → 打磨导出 → 一键格式化（工厂重置）。
- **v0.5.1 目标（两个小改动）**：
  1. **图例高亮语义彩色显示**：把页面上「核心洞见/贡献 / 关键定义/方法 / 局限/风险 / 可借鉴/启发 / 待深挖/存疑」这几个高亮语义标签，用**对应的彩色**显示（原来只显示色块、文字是灰色）。
  2. **轻量公式渲染**：用**轻量化方法**（无外部依赖，不引入 KaTeX/MathJax）在 web 中渲染**内联/行间公式** —— 兼容 `$…$` / `$$…$$` / `\(…\)` / `\[…\]` 定界符，也处理 MinerU 归一化留下的**裸 LaTeX 片段**（如 `N \times D`、`l o g _ { 2 } ( V )`、`\mathbf { f }`、`{ - }`）。

## 2. 关联文档

| 文档 | 路径 | 用途 |
|---|---|---|
| 设计文档 | `D:\aa\docs\paper-highlight-agent-design.md` | §4 数据模型、§6 画像防污染、§9 目录结构 |
| v0.5 进度归档 | `D:\aa\docs\paper-highlight-progress-v0.5.md` | 一键格式化交付记录（v0.5.0 已归档）、环境纪律 |
| 一页纸快照 | `D:\aa\docs\paper-highlight-one-pager.md` | 项目状态速览（v0.5.1 完成后同步更新） |
| 用户指南 | `D:\aa\docs\paper-highlight-user-guide.md` | 面向使用者的「图例/公式」说明与 FAQ |
| 本文件 | `D:\aa\docs\paper-highlight-progress-v0.5.1.md` | v0.5.1 进度（当前） |

## 3. v0.5 继承状态（独立使用必需）

### 3.1 运行环境
- Windows；harness `dsh web`（port 3080，profile `web`）；**paper profile 独立跑 3081**
- paper profile 启动：`dsh --profile paper --port 3081 --no-open`（后台 job；`prepareProfile` 会重写 profile/cordis.yml，启动需 danger-full-access）
- 沙箱：`D:\aa` 内写入免授权；工作区外需 danger-full-access 一次性升级 + 用户批准

### 3.2 关键路径与交付物（v0.5 已就绪，勿重复造）
- git：**tag `v0.5.0`**（一键格式化交付），工作区 clean（本版本改动前）
- 插件包 `D:\aa\packages\paper-highlight/`：
  - `host/`：`schema.js` / `store.js` / `mineru.js` / `normalize.js` / `pipeline.js` / `plugin.js`（`/paper-hl` 路由矩阵，含 `POST /format`）/ `sections.js` / `actions.js` / `diff.js` / `profile.js` / `export.js` / `reflection.js` / **`format.js`（v0.5）** / `tools.js` + `tools-plugin.mjs`（**12 工具**）
  - `client/`：`render-body.js`（渲染逻辑单一来源）、`client.js`（durable bundle）、`dynamic/client-half.js`
  - `scripts/`：`gen-client.js` / `simulate-render.js` / `verify-http.js` / `check-host.js` / `check-utf8.js` 等
  - `test/`：`run-mock.js` / `run-tools.js` / `run-actions.js` / `run-plugin.js` / `run-render.js` / `run-profile.js` / `run-export.js` / `run-reflect-paper.js` / **`run-format.js`（v0.5）**
- 画像存储：`D:\aa\highlight-profile/`（v0.5 格式化后为**冷启动默认**：2 条默认规则 + 0 示例 + 0 统计）
- 论文数据：`D:\aa\data/<paper_id>/`（v0.5 格式化后高亮已清空：0 spans / 0 plan / 0 duplicates；`paper.md`/`anchors.json`/`meta.json` 保留）

### 3.3 环境纪律（沿用 §3.3，勿破坏）
1. **3081 = 会话 Web**：Agent **不得自行 kill/restart**；需要重启时由用户操作。
2. host 代码变更后 live 3081 需**用户手动重启**才生效；client 变更（render-body/gen-client → 重新生成 bundle）刷新页面即生效（bundle 按请求从磁盘读取）。
3. 工单纪律：修改 `client/render-body.js` / `scripts/gen-client.js` 后**必须重跑** `node scripts/gen-client.js`。

## 4. v0.5.1 目标与已锁定决策

### 4.1 目标（D1）
1. **图例彩色语义**：论文视图顶部图例的五个语义标签文字，直接渲染为各自高亮色（红色标签文字 = 红色高亮色等），视觉上一眼对应；保留原有色块。
2. **轻量公式渲染**：正文中的公式片段渲染为「衬线斜体 + 浅蓝底」的公式样式；支持显式定界符（内联 `$…$` / `\(…\)`，行间 `$$…$$` / `\[…\]`）与裸 LaTeX 片段（命令 / 上下标 / OCR 花括号噪声）。

### 4.2 已锁定决策（D2–D6）
- **D2（轻量零依赖）**：**不引入 KaTeX / MathJax / 任何外部资源** —— 用纯函数分词器 + Unicode 符号 / 组合附加符 / CSS 样式实现；未知命令原样保留（绝不丢信息）。
- **D3（选区精确性优先）**：每个数学片段独立成一个 segment（`buildBlockSegments` / `renderText` 同步细分），数学 span 携带 `data-phl-dlen`（显示长度），`nodeOffsetToSeg` 把「显示偏移 ≥ 显示末」映射回原始 LaTeX 范围 —— 整段选中的数学 token 范围**精确**；部分选中按原始范围夹取。**非数学锚点的 segment 布局与 v0.5.0 完全一致**（回归守卫测试）。
- **D4（不破坏渲染主干）**：数学转换只发生在「普通文本段」（非 `<mark>` 高亮内）—— 高亮 span 仍是单一 segment、内容为原始文本，mark 的映射与渲染逻辑零改动；无数学的文本段仍输出单个文本节点。
- **D5（公式定界符兼容）**：`$$…$$` / `\[…\]` 渲染为块级（`.phl-math-display`，居中）；`$…$` 要求内容含 LaTeX 线索（`\` / `_` / `^` / `{`）才当作公式，避免吞掉美元金额之类的普通文本。
- **D6（导出保持原始文本）**：本版本公式渲染仅作用于 **GUI web 渲染**；`export.js` 导出 HTML/MD 仍输出原始文本（避免把 Unicode 转换写进分享产物，影响复制 LaTeX）。导出与 GUI 的差异记录在用户指南 FAQ。

### 4.3 覆盖的转换（`mathConvert`）
- 希腊字母：`\alpha` α … `\Omega` Ω（大小写全表）；
- 运算符/关系符：`\times` ×、`\cdot` ·、`\pm` ±、`\le/ge/ne/approx/equiv/in/subset/cup/cap/forall/exists/infty/partial/nabla/to/rightarrow/sum/prod/int/ldots/prime/degree/sqrt/perp` 等；
- 加粗/正体/斜体：`\mathbf{x}` → **𝐱**（Unicode 数学粗体）、`\mathrm{...}` / `\mathit{...}` / `\text{...}` 去命令保留内容；旧式字体开关 `\bf/\rm/\it/\tt/\cal` 静默消失；
- 附加符：`\bar{x}` x̄、`\hat{x}` x̂、`\tilde{x}` x̃、`\dot{x}` ẋ、`\acute{x}` x́、`\vec{x}` x⃗、`\overline{x}` x̅（组合附加符 U+0300–0305 / U+20D7）；
- 分数：`\frac{a}{b}` → `a⁄b`（分数斜线 U+2044）；
- 上下标：`_ { 2 }` → ₂、`x^2` → x²、`^ { n }` → ⁿ（Unicode 上下标映射表；未映射字符回退原字符）；
- OCR 噪声：`{ - }` → `-`、`{ 2 }` → `2`（单字符花括号收拢）；
- 未知命令原样保留；`$$E=mc^2$$` 之类定界符剥离后转换。

## 5. 实施步骤与验证方法

### Phase 0 —— 图例彩色语义 + 轻量公式渲染（纯 client 变更）
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

### 验收方法（M1）
- ✅ `test/run-render.js` 扩展 PASS：Unicode 转换器（supScript/subScript/boldMath/MATH_SYMBOLS）+ `mathConvert` 矩阵（`\times`/`\mathbf`/`\bar`/`\frac`/`\sqrt`/上下标/OCR `{ - }`/未知命令保留/定界符剥离）+ `splitMathPieces`（连续覆盖、math 标志、`$$` 块公式、无数学透传）+ `renderText` 数学 span（seg/dlen）+ segment 对齐（含 mark 覆盖数学 token 的情形）+ `nodeOffsetToSeg` 原始末映射 + **非数学锚点 segment 布局与 v0.5.0 一致回归守卫**。
- ✅ `node scripts/gen-client.js` 重新生成 bundle（client.js / client-half.js），`node --check` 语法 OK；bundle 内含 `phl-math` / `phl-legend-label` / `data-phl-dlen`。
- ✅ **live 3081 bundle 验证（2026-08-31）**：`GET /plugins/paper-highlight/client.js` → 200，内容含 `phl-math` / `phl-legend-label`（**刷新页面即生效**）。
- ✅ **真实数据只读探针（p-mikolov 正文）**：`splitMathPieces` 在真实锚点上检出并转换：`1 { - } 0 \mathbf { f } { - } V coding` → `- | 𝐟 - | ×`；`N \times D \times H` → `× … ×`；`l o g _ { 2 } ( V )` → `₂`；`\bar { U }` → `Ū`；未知 `\bf` 保留（OCR 打散的 `{ \bf g 0 }` 不动）。
- ✅ 离线回归：`test/run-tools.js` / `test/run-format.js` PASS（host 未改动）。

> ⚠️ **已知（非本版本回归）**：v0.5 用户实跑格式化后，三篇论文高亮已清空（0 spans）+ 画像回到冷启动默认 —— 依赖**演示数据非空**的 `scripts/simulate-render.js`（断言 `expectedSpans > 0`）与 `test/run-plugin.js` 第 2 步（断言原始 5 条演示 span `s-001…s-005` 仍在）当前会失败；重新 propose 出新高亮后自动恢复。这不是代码缺陷，是格式化清空数据的预期结果。

### 5.1 热修复（2026-08-31，同日内）：空白页 → `pushPlainSegs is not defined`
- **现象**：v0.5.1 首次归档后 web 页面渲染**空白**（PaperView 崩溃）。
- **根因**：`buildBlockSegments` 改造后调用 `pushPlainSegs`，但 BODY 嵌入清单漏嵌 `${pushPlainSegs.toString()}` —— 模块级 require 测试能过（模块作用域有该函数），**bundle 里没有** → 渲染时 `ReferenceError` → 整个论文视图崩溃 → 空白页。`scripts/simulate-render.js` 运行到 `buildSegmentMap` 渲染时当场复现 `pushPlainSegs is not defined`。
- **修复**：把 `${pushPlainSegs.toString()}` 加入 BODY 嵌入；重跑 `gen-client.js`（bundle 含 `function pushPlainSegs`）→ live 3081 按请求从磁盘读到修复 bundle，**刷新页面即恢复**。
- **回归守卫（防止再犯）**：
  - `test/run-render.js` 新增 **bundle 嵌入完备性守卫**：逐一断言 38 个纯函数 helper 的 `function <name>(` 都出现在 `BODY` 中（任何缺失 toString 嵌入 → 离线测试直接失败）；
  - `scripts/simulate-render.js` 新增 **v0.5.1 bundle 静态守卫**（`splitMathPieces`/`mathConvert`/`mathClean`/`MATH_SYMBOLS`/`mathPieceEl`/`data-phl-dlen`/`phl-math`/`phl-legend-label`/`phl-math-display`）—— 渲染前对 bundle 源码做包含检查，**不依赖演示数据非空**也能抓到同类缺失；P2-d 静态检查清单补充 `pushPlainSegs`。
- **验证**：`run-render.js` PASS（含嵌入完备性守卫）；`simulate-render.js` 越过该点直到唯一的空数据断言（`spans got 0`，已知）；293 个真实锚点 `renderText` 全渲染成功（0 错误、407 个数学 span）；live bundle 含 `pushPlainSegs` → **空白页修复**。v0.5.1 标签移到修复提交。

## 6. 风险

| # | 风险 | 缓解 |
|---|---|---|
| 1 | 数学转换破坏选区映射（新增/改范围偏移错位） | D3：数学片段独立 segment + `data-phl-dlen` 显示末→原始末映射；非数学段行为零变化（回归守卫测试断言 v0.5.0 布局）；无数学的锚点逐字节一致 |
| 2 | 引入外部渲染库 / 网络资源 | D2：零依赖纯函数 + Unicode + CSS；不引入 KaTeX/MathJax，无网络请求 |
| 3 | 误伤普通英文文本（`_`、`{…}`、`\` 等） | 仅匹配 `\command` / `_ { }` / `^ { }` / 单字符花括号（OCR 噪声特征）；未知命令原样保留；`$…$` 需含 LaTeX 线索才转换 |
| 4 | `String.fromCharCode` 16 位截断（粗体字母变 Hangul） | 改用 `String.fromCodePoint`；测试断言 codepoint |
| 5 | 导出与 GUI 公式显示不一致 | D6：导出保留原始文本（可复制 LaTeX）；用户指南 FAQ 说明差异 |
| 6 | bundle 与单一来源不一致 | 环境纪律 §3.3：改 render-body/gen-client 后必须重跑 `gen-client.js`；已重跑 + `node --check` |

## 7. 命令速查（v0.5.1）

```powershell
$env:NODE_PATH = 'C:\Users\eyx\.dsh\profiles\node_modules'   # fflate 解析
node scripts/gen-client.js       # 改 render-body.js / gen-client.js 后必须重跑
node --check client/client.js    # bundle 语法检查
node test/run-render.js          # v0.5.1 数学渲染 + 图例/选区回归（PASS）
node test/run-tools.js && node test/run-format.js   # host 回归（PASS）
node scripts/verify-http.js      # 路由自检（含 format 安全探针）
node scripts/simulate-render.js  # live 3081 —— 当前需演示数据非空（格式化后待重新 propose）
```

## 8. 交付记录（v0.5.1 已归档）

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 | 图例彩色语义 + 轻量公式渲染完成 + 离线测试 PASS + live bundle 验证 | ✅ `render-body.js`（`MATH_SYMBOLS`/`supScript`/`subScript`/`boldMath`/`mathClean`/`mathConvert`/`matchMathDelim`/`matchMathToken`/`splitMathPieces`/`mathPieceEl` 纯函数 + `renderText`/`buildBlockSegments`/`nodeOffsetToSeg` 改造 + 图例标签彩色 + `.phl-math*` CSS）+ `gen-client.js`（新 exports）+ `run-render.js`（v0.5.1 数学矩阵 + 选区/布局回归守卫）PASS + gen-client 重跑 + `node --check` OK + **live 3081 bundle 验证 PASS（`/plugins/paper-highlight/client.js` 含 `phl-math`/`phl-legend-label`，刷新即生效）** + 真实数据只读探针 PASS（`\times`→×、`_ { 2 }`→₂、`\bar{U}`→Ū、OCR `{ - }`→-、未知命令保留）→ **归档 `v0.5.1`（2026-08-31）** |
| M1-FIX | **空白页热修复（`pushPlainSegs is not defined`）** | ✅ 根因 = `pushPlainSegs` 未嵌入 BODY（模块测试覆盖不到、bundle 运行才暴露的 ReferenceError → 空白页）；修复 = BODY 补嵌 `${pushPlainSegs.toString()}` + gen-client 重跑 + live bundle 验证（含 `pushPlainSegs`，刷新即恢复）；回归守卫 = run-render 嵌入完备性断言（38 个 helper 逐一检查 `function <name>(` 在 BODY）+ simulate-render v0.5.1 静态守卫（不依赖演示数据）；**v0.5.1 标签移到修复提交** |
