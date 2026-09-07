# Paper Highlight Agent — v0.6.x 项目计划（数学公式渲染重建）

> 版本：v0.6.x（计划文档）· 状态：**v0.6.1 行内公式已实现并验收 PASS（2026-09-01）；KaTeX 渲染升级已实现（v0.6.1+，方框根治）—— v0.6.2 行间公式待实现** · 创建：2026-09-01
> **v0.6.x 系列唯一目标：重新完成数学公式渲染（行内 + 行间）**。其余功能不新增、不修改。

---

## 1. 目标与背景

- **目标（只做一件事）**：在当前 v0.5.4.3 代码树上重建数学公式渲染，覆盖**行内公式**与**行间公式**两类；不改数据、不改导出、不引入外部依赖。
- **背景**：v0.5.1 首次实现（零依赖 Unicode + CSS），因连续问题被 v0.5.3 整体移除（回滚至 v0.5.0 纯文本渲染）：
  1. **v0.5.1 空白页**：`pushPlainSegs` 未嵌入 BODY → 渲染时 ReferenceError → 论文视图空白；
  2. **v0.5.2 灰块**：`splitMathPieces` 对空 display 片段仍渲染 `.phl-math` span → 空心灰色色块盖住内容。
- **本次重建的改进点**：
  1. 新增 **OCR 修复层**（处理 MinerU 空格污染，见 §4.1）；
  2. **行间公式**纳入设计（见 §5）；
  3. 两道历史 bug 各加**回归闸门**（见 §6）；
  4. 架构沿用 v0.5.1 已验证的 `data-phl-dlen` 偏移桥接，**数据零改动**。

---

## 2. 现状勘察：当前文本中 LaTeX 的存在形式（对 3 篇 paper.md 实测）

**核心事实：三篇论文里没有任何显式定界符**（`$…$` / `$$…$$` / `\(…\)` / `\[…\]` 全部为 0）——数学全部是 MinerU 归一化后嵌在正文里的**裸行内 LaTeX 片段**，且带 OCR 空格污染。实测分类：

| 形式 | 样例（原样） | 规模（mikolov / sutskever / bahdanau） |
|---|---|---|
| 紧贴命令（主流，可读） | `\alpha_{ij}`、`\mathbf{y}`、`x_{1}`、`\mathbb{R}^n` | 20 / 88 / 162 处 |
| 命令 + 空格 + 花括号 | `\mathbf { x }`、`\bar { N }`、`h _ { t }` | 6 / 35 / 63 处 |
| 花括号内 OCR 空格 | `{ 2 }`、`{ - }`、`{ U }`、嵌套 `{ T _ { x } }` | 短片段 11 / 31 / 183 个 |
| 空格打散的命令名（罕见） | `\ a r g \ m a x`（`\mathrm { i . e . , \ a r g \ m a x }`） | 0 / 1 / 11 处 |
| 空格打散的标识符 | `l o g _ { 2 } ( V )`、`x _ { 1 } , \cdot \cdot \cdot , x _ { T }` | 14 / 42 / 157 处 |
| OCR 句点代替空格 | `i . e . ,`（在 `\mathrm{…}` 内） | 少量 |
| 旧式字体命令 / 字面符号 | `\bf`、`\rm`、`\it`、`\tiny`、`\ :`、字面 `~` | `\bf` 1/4/1、`\tiny`×18（sutskever） |
| 强调 / 箭头 / 点 | `\bar`、`\hat`、`\vec`、`\dot`、`\overline`、`\overrightarrow`、`\overleftarrow` | bahdanau 注意力论文大量 |
| 特殊残留 | `. ^ { 2 }`（句点后悬空上标）、`} ), into`（零散括号）、`\left( \right)`、`\mid`、`\cdot\cdot\cdot` | 少量 |
| **无（当前数据）** | matrix / 对齐 / 显示公式环境、`$$` 块 | 0 |

**结论：需要格式修复，且为「有界修复」**（详见 §3、§4）。

---

## 3. 核心架构决策（已锁定）

| # | 决策 | 理由 |
|---|---|---|
| D1 | **渲染端修复，数据零改动**：`paper.md` / `anchors.json` / 高亮 span 的字符偏移全部保持原文；修复 = 渲染管线里的纯函数「视图变换」，浏览器渲染时对文本拷贝做 修复→分段→转换→DOM | 高亮 span 用原文偏移引用锚点；改数据 = 偏移失效 + 导出丢失 LaTeX 原文。正在 re-propose 的 bahdanau 数据直接受保护 |
| D2 | **有界修复**：只修可确认的 OCR 噪声；必修 / 应修 / 尽力三档；**修不掉的污染原样显示，绝不丢字符** | 启发式不完美，但保守 = 零信息损失 |
| D3 | **零 CDN 依赖 + 本地 KaTeX**（v0.6.1+ 修订原「零依赖」）：渲染引擎 = 本地打包的 KaTeX（`katex.min.js` 内联 + 20 个数学字体 base64 内联进 bundle），无任何外部网络/CDN；KaTeX 缺失或抛错时降级回 Unicode+CSS 近似（保底不白屏） | 原「零依赖 Unicode+CSS」有硬天花板：分数/求和/矩阵不排版 + **数学字符依赖系统字体 → 大量 □ 方框**（3.2 节 `\vec`/`\bar`/`\boldsymbol` 最密集）。KaTeX 自带完整数学字体集，一箭双雕：LaTeX 级排版 + 无方框。本地打包不违反「无 CDN」 |
| D4 | **`data-phl-dlen` 偏移桥接**：数学区记录原文 start/end + 显示长度 dlen；选区 / 改范围 / 新增高亮经映射**始终回到原文偏移** | v0.5.1 已验证；是「显示端变换 + 数据层不动」共存的关键 |
| D5 | **导出保持原文**：`export.js` 输出原始文本（可复制 LaTeX），GUI 与导出的差异写入用户指南 FAQ | 分享产物保留可粘贴的 LaTeX 源 |
| D6 | **防复犯闸门**：BODY 嵌入完备性断言 + 「空 display 不生成 span」不变量 + 非数学布局逐字节回归 | 直接封堵 v0.5.1 / v0.5.2 两个历史 bug |

---

## 4. 渲染方案（行内公式）

### 4.1 修复层 `repairMath(text)` —— 只动数学区，不碰散文

**A. 必修（零风险，纯空格规整）**

| 规则 | 原文 | 修复后 |
|---|---|---|
| 花括号内单 token 空格收拢 | `{ 2 }` `{ x }` `{ - }` | `{2}` `{x}` `{-}` |
| 命令与参数间空格消除 | `\mathbf { y }` `h _ { t }` | `\mathbf{y}` `h_{t}` |
| 空格打散的命令名合并 | `\ a r g \ m a x` | `\arg\max` |
| 字面 `~` → 空格 | `\mathrm { \tiny ~ 6 6 }` | `\mathrm{\tiny 66}` |

**B. 应修（启发式，仅当可确认为 OCR 噪声）**：数学区内「单字母 + 句点」的断字噪声 `i . e . ,` → `i.e.,`。
> ⚠️ 护栏：**绝不碰小数点和正常句号** —— 判定 = 句点两侧为单字母且无数字（`H \times V .` 的句点不修，`4 \cdot 5` 不修）。

**C. 尽力（残留归位）**：`} ), into`、`. ^ { 2 }` 等能安全折叠则折叠，否则原样保留显示。

### 4.2 分段层 `splitMathPieces(text)`

扫描含 `\` / `_` / `^` / `{}` 信号的**连续区域**为数学片段（裸 LaTeX 自动识别，无需定界符）；纯文本段原样输出。每片段记录**原文 start/end**（供选区映射）+ **dlen**（显示长度，供 `data-phl-dlen`）。

```
[普通文本] [数学区 start..end, dlen] [普通文本] ...
```

### 4.3 转换层 `mathConvert(tex)`（递归）

- **符号表**：希腊字母；运算符/关系符（`\times`×、`\cdot`·、`\pm`±、`\le/ge/ne/approx/in/mid/ldots/cdots/prime/partial/infty/rightarrow`…）；`\mathbb{R}`→ℝ。
- **字体命令**：`\mathbf`/`\boldsymbol`/`\bf`→Unicode 粗体；`\mathbb`→黑板体；`\mathrm`/`\text`/`\rm`→正体；`\it`/`\mathit`→斜体；`\mathcal`→花体；`\mathfrak`→哥特；`\mathtt`→等宽（未映射命令原样保留）。
- **强调符**：`\bar`/`\hat`/`\tilde`/`\vec`/`\dot`/`\acute`/`\overline`/`\overrightarrow`/`\overleftarrow`（组合附加符或 CSS 叠字）。
- **上下标**：单字符用 Unicode（`x_1`→x₁、`^2`→²、`^{n}`→ⁿ）；多字符/嵌套（`x _ { T _ { x } }`）用 CSS `vertical-align`。
- **分数**：`\frac{a}{b}` → a⁄b。
- **括号**：`\left( \right)` → 普通括号。
- **省略号**：`\cdot\cdot\cdot`→`⋯`、`\ldots`/`\dots`→`…`。
- **字号命令**：`\tiny`/`\small`/`\large` 等 → 忽略（保内容）。
- **未知命令** → 原样显示（不丢信息）。

### 4.4 渲染集成 + 偏移映射

在当前 v0.5.4.3 代码树上重新接入（复用 v0.5.1 已验证路线）：
- `renderText` / `buildBlockSegments` / `nodeOffsetToSeg`：数学区渲染为 `<span class="phl-math" data-phl-dlen="N" data-phl-seg="start:end">…</span>`；**非数学锚点的 segment 布局与 v0.5.4.3 逐字节一致**。
- 用户选中 / 改范围 / 新增高亮跨越该 span 时，`nodeOffsetToSeg` 用 `dlen` 把显示偏移映射回原文 start:end → 写回数据的偏移**始终是原文偏移**。

### 4.5 CSS

- `.phl-math`：衬线斜体 + 浅底；**仅当 display 非空才生成**（封堵 v0.5.2 灰块）。
- `.phl-math-script`：上下标竖排。
- `.phl-math-frac`：分数。

---

## 5. 行间公式处理（思考结论）

> 当前三篇论文**没有**行间公式（无 `$$` / 无环境块）。此节为**前向设计**：未来 MinerU 解析含显示公式的 PDF 时直接可用；v0.6.x 内用**合成 fixture** 验证，真实数据通路为未来论文预留。

### 5.1 检测（优先级）

1. **显式定界符**：`$$…$$`（可多行）、`\[…\]` → 块。
2. **环境块**：`\begin{env}…\end{env}`（`equation` / `align` / `gather` / `cases` / `matrix` / `bmatrix` / `pmatrix` / `array`）→ 块，`env` 类型决定结构解析。
3. **启发式段落**（整段数学密度高、无散文、空行分隔）：**默认关闭** —— 当前数据无行间公式，避免对散文段误触发；留作未来可选项。

> 说明：`splitMathPieces` 对行内识别不受影响；行间检测仅在「显式标记或环境块」命中时启动，与行内路径正交。

### 5.2 修复

同一套 `repairMath` + **环境感知**：剥除 `\begin{env}` / `\end{env}` 标记并记录 `env` 类型；`\\` 切分为**行**、`&` 切分为**列**。

### 5.3 渲染

- `.phl-math-display`：`display:block`、居中、独立成行、衬线斜体、字号略大、上下留白。
- **多行**：`\\` 切行，行内继续走转换层（flex 列堆叠）。
- **matrix / cases / align**：`&` 列结构 → CSS `grid`（`grid-template-columns: repeat(列数, auto)`，居中）；对齐环境简化为「行内居中 + 列格」，**不求 LaTeX 级排版精度**。
- 行间公式内部同样适用 §4.1 修复与 §4.3 转换。

### 5.4 偏移映射

- **整块一个 segment**：`dlen` = 块的总显示长度；**整块 / 前缀选择**线性映射回原文范围。
- **块内逐单元精确选择**（多行块内精确到某一格）：列作 v0.6.x 的**已知边界**（不支持逐格精确映射），UI 上整块可整选/整删。

### 5.5 范围边界

- 行间公式是**次要路径**：当前无真实数据，以合成 fixture + 单元测试 + 静态守卫验证；不阻塞行内主路径。
- 若未来论文的行间公式暴露出结构缺陷，单独迭代修复，不扩大到 v0.6.x 其它功能。

---

## 6. 防复犯回归闸门

| # | 闸门 | 内容 | 封堵 |
|---|---|---|---|
| G1 | BODY 嵌入完备性 | run-render 逐一断言每个 helper 的 `function <name>(` 出现在 BODY | v0.5.1 空白页 |
| G2 | 空 display 不变量 | 不存在「`math && display` 为空」的片段；空片段折叠回普通文本 | v0.5.2 灰块 |
| G3 | 非数学布局回归 | 无数学锚点的 segment 布局与 v0.5.4.3 逐字节一致 | 渲染主干回归 |
| G4 | 真实数据全量渲染 | 3 篇论文全锚点渲染 0 错误 + 0 灰块 + 转换前后 diff 抽样 + **KaTeX 引擎接管率与 katex-error 计数** | 端到端质量 |

---

## 7. 验证矩阵

| 层 | 手段 |
|---|---|
| 单元 | `run-render`：`repairMath` 矩阵（A/B/C 各规则 + 护栏反例）+ `mathConvert` 矩阵（符号/字体/强调/上下标/分数/未知保留）+ `splitMathPieces`（连续覆盖、行内区、环境块、`$$` 块）+ 偏移映射（`data-phl-dlen` 回原文）+ 非数学布局回归 + G1/G2 |
| host 不动 | `run-actions` / `run-plugin` 不改（数学渲染纯 client） |
| bundle | `simulate-render` 静态守卫（修复层/分段层/转换层/行间标识，渲染前对 bundle 源码检查，不依赖演示数据） |
| 探针 | 无头探针（真实 bundle + 真实 `/read`）：3 篇全锚点渲染，0 错误 + 0 灰块 + 抽查转换正确性；合成行间 fixture（`$$…$$` / `matrix`）渲染 + 偏移 |
| live | client bundle 按请求从磁盘读，刷新即生效（纯 client，无需重启 3081） |

---

## 8. 里程碑（版本规划）

| 版本 | 内容 | 验收 |
|---|---|---|
| v0.6.1 | 行内公式：修复层 + 分段层 + 转换层 + 渲染集成 + 回归闸门 | ✅ **已实现并 PASS**：`run-render` 离线矩阵全绿（repair/split/convert/dlen/选区映射/G2/G3/G1-32 helpers + KaTeX 分支矩阵）+ 全回归套件绿 + `simulate-render` 数学/KaTeX 静态守卫绿（E2E 数据断言受演示数据 0 spans 阻塞为 v0.6.0 既有状态）+ `run-math-g4` 真实 bundle × 3 篇全锚点审计 PASS（293 锚点 / 148 数学段 / 0 崩溃 / 0 空显示 / **KaTeX 引擎 148/148 接管 / 0 katex-error**） |
| v0.6.1+ | **KaTeX 渲染升级**（D3 修订：零 CDN + 本地 KaTeX）：`katex.min.js` + 20 个数学字体 base64 内联进 bundle（117KB→759KB，本地加载无网络）；`katexRender` 三态（KaTeX 优先 / 抛错降级近似 / 空显示 G2 折叠）；方框（tofu）因 KaTeX 自带字体根治；client.js 759KB | ✅ **已实现并 PASS**（见 v0.6.1 验收行：g4 证明 148 段全部 KaTeX 渲染、0 错误标记）—— 纯 client，刷新即生效，无需重启 3081 |
| v0.6.1.2 | **修复数学区误吞散文括注**：`parseMathRight` i++ 双增 bug（`))` 相邻时跳过第二个 `)` → depth 泄漏吞到句尾）+ 括号内散文括注被吞（`(just before emitting …)`）+ 命令参数豁免（`\end{array}` 的 `{array}`） | ✅ **已实现并 PASS**：run-render 新增 aside 分割 / 嵌套 `))` 回归断言；G4 回到 293 锚点 / 151 数学段 / **0 katex-error**（修复前 1）；全回归套件绿；bundle 760KB 纯 client 刷新即生效 |
| v0.6.2 | 行间公式：检测 + 环境感知修复 + 块级渲染（多行 / matrix grid）+ 合成 fixture 验证 | 合成 fixture 渲染 + 偏移 PASS |
| v0.6.3 | 文档同步（one-pager / user-guide / README / 本计划转交付记录）+ git 提交 + tag | 全量回归 + 验收 |

> 版本粒度可按用户验收节奏合并；**只做数学渲染一件事**贯穿始终。

---

## 9. 命令速查（实现期占位）

```powershell
$env:NODE_PATH='C:\Users\eyx\.dsh\profiles\node_modules'
node scripts/gen-client.js            # 改 render-body.js 后必须重跑
node test/run-render.js               # repair/mathConvert/splitMathPieces/偏移映射/回归闸门
node test/run-math-g4.js              # G4 真实 bundle × 真实数据全锚点审计（293 锚点 / 148 数学段，离线可跑）
node scripts/simulate-render.js       # bundle 静态守卫（E2E 受演示数据非空阻塞属预期）
```

---

## 10. 风险与边界

| # | 风险 / 边界 | 缓解 |
|---|---|---|
| 1 | 修复启发式不完美：部分污染原样显示 | D2：保守、零信息损失；可迭代收紧规则 |
| 2 | 行间检测误触发（散文段被当公式） | 显式标记/环境块才触发；启发式段落默认关 |
| 3 | 多行块内逐单元精确选择不支持 | §5.4 明确为已知边界，整块可整选/整删 |
| 4 | v0.5.1/v0.5.2 bug 复现 | G1/G2 回归闸门 + G3 非数学布局逐字节回归 |
| 5 | 数学渲染曾因连续问题被回滚 | 本次含修复层 + 闸门；实现以「真实数据可读性」为准，宁可保守不可失控 |
| 6 | 与高亮偏移冲突 | D1 数据零改动 + D4 `data-phl-dlen` 桥接（v0.5.1 已验证） |

---

*v0.6.x 规划：只完成「重新完成数学公式渲染（行内 + 行间）」一件事。v0.6.1（行内）已实现交付；v0.6.2（行间）待实现。*
