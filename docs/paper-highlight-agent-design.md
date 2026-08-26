# 论文多色高亮 Agent —— 设计文档

> 版本：v0.1（已完成，2026-08-26 验收通过） · 日期：2025 · 状态：v0.1 已交付（验收记录见 `paper-highlight-progress.md` Step 4/5）
> 目标读者：本项目开发与评审

---

## 1. 项目概述

### 1.1 一句话定义

在 **DeepSeek Harness（DSH）** 之上构建一个**单论文多色高亮 Agent**：用户提供论文 PDF → MinerU 云 API 解析为结构化 Markdown → 在 `dsh web` 的 GUI 中整体渲染 → Agent 依据「论文整体认识 + 领域发展线 + 用户个性化画像」逐节提出语义高亮 → 用户审查修改 → 画像持续学习 → 导出带高亮的 Markdown/HTML。

### 1.2 项目目标

- **高亮语义质量高**：能识别语句的价值/局限/引领未来的洞见，而非关键词匹配。
- **符合个人习惯**：密度、粒度、颜色含义均个性化，且随使用持续收敛。
- **克制**：重复内容不重复高亮；只处理正文文字部分。
- **零学习成本**：用户在熟悉的 Web 界面上以"审查"方式参与，而非调 prompt。

### 1.3 非目标（当前版本）

- 不做多论文/多会话批处理、不做论文间对比。
- 不做图表、公式区域的高亮（仅正文文字）。
- 不做多用户账户体系。
- 不导出 PDF 批注（列为未来方向）。

---

## 2. 需求与决策（已锁定）

| 决策点 | 结论 | 备注 |
|---|---|---|
| MinerU 接入 | **云 API**（endpoint + API key 走配置） | `POST /api/v4/extract/task`，轮询，下载 zip |
| 会话范围 | 单次会话聚焦单篇论文 | 状态以文件形式持久化，可恢复 |
| 高亮范围 | 仅正文文字部分 | 跳过图表、公式、页眉页脚 |
| 颜色语义 | **用户固定指定**，Agent 不提议 | 冷启动配置 `colors.yml` |
| 画像范围 | 单用户本机 | 存于 profile 目录 |
| 论文规模 | 会议论文（8–15 页） | 全文可入上下文，循环按「节」进行 |
| 导出 | 带高亮的 Markdown/HTML | HTML 用 `<mark>` + 图例 |
| 交互模式 | 章节循环：Agent propose → 用户审查 | 审查动作为画像学习信号源 |

---

## 3. 总体架构

### 3.1 DSH 的角色

DSH 是**宿主**：提供 agent 运行时（LLM 会话、工具调用）、Web GUI（`dsh web`）、工作区、会话持久化与插件体系。本项目**不 fork DSH**，而是以 **profile + 插件** 方式扩展：

- **Host 插件**（Node 侧）：MinerU 调用、高亮/画像数据读写、导出。对外暴露为 Agent 工具与 HTTP API。
- **Client 插件**（浏览器侧）：论文渲染、高亮标注层、审查交互 UI、画像编辑面板。
- **Agent 层**（技能 + 提示词）：两遍阅读、propose、差异学习、章节反思的工作流定义。
- **Profile**：`paper` profile = `dsh-base` + `dsh-web-app` bundles + 本项目插件，独立端口运行。

```
┌─ client 插件（浏览器，跑在 dsh web 上）────────────────────────┐
│  Markdown 渲染 + 高亮标注层 + 审查工具栏 + 画像编辑面板            │
│            │ 读写 paper.highlights.json（经 host API）          │
├─ host 插件 / 工具（Node 侧）───────────────────────────────────┤
│  parse_pdf（MinerU API） · highlights 读写 · 画像读写 · HTML 导出│
│            ▲                                              │
├─ agent 层（LLM + 技能/提示词）─────────────────────────────────┤
│  全局通读 → 论文地图 → 逐节 propose → 差异学习 → 章节反思          │
└─ DSH 基础设施：profile、会话、工作区（D:\aa）、Web、插件运行时    ┘
```

### 3.2 关键架构决策

1. **`.highlights.json` 文件是 Agent 与 UI 之间的唯一契约。**
   Agent propose 后停下；用户在 GUI 中编辑高亮（client 插件经 host API 读写该 JSON，类似本地编辑器）；完成后用户说"审查完毕"，Agent 重读文件、算差异、学习画像。**不做 agent↔GUI 实时双向通信**，系统耦合最小、可断点续作、可审计。

2. **高亮锚定「归一化文本 + 段落锚点」，不锚定 DOM。**
   锚点来自 MinerU 中转 JSON 的 `page/block/par/line` 结构 + 字符偏移。MinerU 重跑、UI 改版不破坏标注。

3. **不另起 Web 服务。** GUI 必须是跑在现有 `dsh web` 之上的 client 插件（apps/web 的 Vite 入口依赖 `window.__DSH_BOOT__` 注入，不是独立应用）。

4. **两遍阅读先全局后局部。** 全局通读产出「论文地图」，它是高亮语义判断与去重的共同基础。

---

## 4. 数据模型

### 4.1 输入归一化（MinerU → anchors）

MinerU 云 API 流程：`上传/提供文件 → POST /api/v4/extract/task（X-Token）→ 返回 task_id → 轮询 GET /api/v4/extract/task/{task_id} → state=done → 下载 full_zip_url`。zip 内含：

- `xxx.md`：Markdown 全文（渲染用）
- `xxx.json` / `middle.json`：中转结构，含 `page_idx / block_idx / par_idx / line` 及坐标
- `images/`：图片资源（当前版本正文渲染可忽略）

**归一化产物**（存于 `data/<paper_id>/`）：

```
data/<paper_id>/
├── paper.md                 # 渲染用 Markdown（正文文字，剔除图表/公式区）
├── anchors.json             # 锚点索引：anchor_id -> {page, block, par, line, text}
├── paper.highlights.json    # 高亮数据（见 4.2）
└── meta.json                # 论文元信息：标题、PDF 源、MinerU task_id、时间戳
```

### 4.2 `paper.highlights.json` schema

```jsonc
{
  "paper": { "id": "p-2025-001", "title": "...", "source_pdf": "...", "mineru_task": "..." },
  "anchors": {
    "a-0007-02-01": { "page": 7, "block": 2, "par": 1, "text": "..." }
  },
  "plan": {
    "summary": "全文高亮策略概述",
    "sections": [
      { "section": "§3 方法", "expected_colors": ["yellow", "red"], "density_hint": "3-5 处", "skip": false }
    ]
  },
  "spans": [
    {
      "id": "s-012",
      "anchor": "a-0007-02-01",
      "char_start": 18, "char_end": 96,
      "color": "red",
      "rationale": "首次提出 scaling 假设，属范式级洞见",
      "status": "accepted",            // proposed | accepted | rejected | user_added
      "decisions": [                    // 画像学习的原始信号，只追加
        { "action": "proposed", "by": "agent", "at": "2025-01-01T10:00:00Z" },
        { "action": "user_recolored", "from": "yellow", "to": "red", "note": "这才是核心" }
      ]
    }
  ],
  "duplicates": [                       // 论文地图维护：重复主张登记，避免重复高亮
    { "claim": "transformer 并行化优势", "highlighted_at": "s-012", "repeats_at": ["a-0002-01-03", "a-0009-04-01"] }
  ]
}
```

要点：
- `status` 区分 Agent 提议与用户手动新增；`decisions[]` 只追加、不可变，是画像学习的原始日志。
- `duplicates` 由论文地图驱动，propose 时对重复主张默认跳过，除非画像规则声明"重复也标"。

### 4.3 画像存储（四层，单用户本机）

存于 profile 目录 `highlight-profile/`：

```
highlight-profile/
├── colors.yml            # L1 颜色语义（用户固定指定）
├── rules.json            # L2 规则层：密度阈值、粒度偏好、去重策略、分节规则
├── exemplars.json        # L3 示例库：{span, 建议, 用户决策, 备注}，按类别索引
├── stats.json            # L4a 统计：每章密度、颜色分布、接受率、修改类型分布
└── reflection-notes.md   # L4b 反思笔记（自然语言画像日志，用户可编辑）
```

| 层 | 内容示例 | 更新方式 |
|---|---|---|
| L1 颜色语义 | `red: 核心洞见/贡献; yellow: 关键定义/方法; blue: 局限/风险; green: 可借鉴/启发; purple: 待深挖/存疑` | 用户直接编辑（静态） |
| L2 规则层 | `density_per_section: 3-5; granularity: sentence; dedup: first_only` | 章节反思提案 + 用户确认 |
| L3 示例库 | 被改色/被删除的 span 对 | 每次审查自动入库；propose 时注入 top-k |
| L4 统计+笔记 | `accept_rate: 0.72; note: "我对 future work 方向格外关注"` | Agent 维护，用户可编辑 |

**使用方式**：propose 时 Agent 只收到「画像摘要」（L1+L2 规则 + L3 精选 3–5 例 + L4 一句统计），不注入全量历史，控制 token、避免噪音。

---

## 5. Agent 工作流（loop 设计）

### 5.1 冷启动

1. 用户配置 `colors.yml`（固定颜色语义）。
2. 用户声明密度/粒度基线（如"每节 2–4 处、句子级"）→ 生成初始 `rules.json`。
3. 提供论文 PDF（工作区路径或拖拽上传，v0.1 先做路径）→ host 插件调 MinerU API 解析。

### 5.2 全局通读（第一遍）

Agent 通读全文（会议论文 8–15 页，token 充足），产出**论文地图**：

- 章节结构；
- 核心主张清单（贡献、方法、实验、局限的映射）；
- 领域定位（对照领域地图：继承谁、挑战谁、可能引领什么）；
- 逐节高亮计划（预期颜色分布、密度、低价值段落标记 `skip`）→ 写入 `paper.highlights.json.plan`。

计划先行让用户在动手前校准预期，避免"Agent 高亮完一节用户全删"。

### 5.3 逐节循环（核心）

```
for each § in paper:
  1. propose：论文地图 + 该节文本 + 领域地图片段 + 画像摘要 + 已高亮集合
     → 候选 spans（颜色 + 理由 + 建议粒度），status=proposed，写入 JSON
  2. GUI 渲染为半透明标注层；用户审查：
     接受 / 删除 / 改色 / 改范围 / 手动新增 / 备注
  3. 用户说"审查完毕" → Agent 重读 JSON，做差异分析：
     - 黄色全被改红        → L2 规则调整（颜色-语义映射认知修正）
     - 铺垫句全被删除      → 密度/价值偏好收紧
     - 某类 span 被扩范围  → 粒度偏好（如"以子句而非整句"）
  4. 章节反思 → 画像更新提案（规则修正 + 示例入库 + 统计更新）
     → 用户一键确认 / 否决（防止画像被错误推断污染）
  5. 论文地图同步"已高亮主张" → 下一节（天然去重）
```

### 5.4 收尾

- 论文级反思（可选）：总结本论文值得沉淀的偏好与领域地图增补点。
- 导出：带高亮的 HTML（`<mark>` + 图例）/ Markdown。

### 5.5 关于 plan 与 reflexion 的定位

| 机制 | 是否采用 | 定位 |
|---|---|---|
| Plan | ✅ 轻量 | 全局通读后的「章节级高亮策略计划」，校准预期、支撑去重 |
| Reflexion | ✅ 反馈后 | 章节级（简短，更新画像）+ 论文级（收尾可选）。**不自我空转**——高亮的对错只能由用户定义，反思价值在于把用户修改转化为可复用规则 |
| 多轮自省 | ❌ | 每章多轮自我反思是 token 浪费，不采用 |

---

## 6. 个性化画像（学习闭环）

- **信号源**：`paper.highlights.json` 中每次审查的 `decisions[]`（删除/改色/改范围/新增）。
- **学习时机**：每节审查完毕后（章节反思），与论文级反思（收尾）。
- **防污染**：Agent 只产出「画像更新提案」，由用户确认后才写入 L2 规则；L3 示例库自动入库但仅作参考信号，不直接改写规则。
- **收敛度量**：连续处理 N 篇论文后，用户审查修改率应显著下降（v0.3 验收指标）。

---

## 7. 领域知识与论文整体认识

两个独立上下文，分头维护：

| 上下文 | 形式 | 注入时机 |
|---|---|---|
| 领域发展线（NLP/LLM/Agent 演进、里程碑、范式转移） | workspace 内 `field-map.md`（Agent 初建 + 使用中累积）；必要时 web_search 补充最新信息 | 全局通读 + 每节 propose 时按需注入，**不常驻 system prompt** |
| 论文整体认识 | 两遍阅读产出的「论文地图」（存于 `meta.json` 或会话内，随循环更新） | 每节 propose 时携带最新版本 |

领域地图的价值：让 Agent 判断语句**分量**——今天看似平淡的句子，若位于范式转移节点（如首次提出 scaling 假设），应高亮为「洞见」。此类判断无法靠单节局部文本做出。

---

## 8. 实现路径（版本规划）

### 总览

| 版本 | 主题 | 核心交付 | 验收标准 |
|---|---|---|---|
| v0.1 | 管线打通 | profile + host 插件（MinerU）+ client 渲染 | PDF → 网页渲染 → Agent 可读写高亮 JSON |
| v0.2 | 审查闭环 | 两遍阅读 + propose + GUI 审查 + 差异学习 | 完整跑通"propose→审查→反思→下一节" |
| v0.3 | 画像收敛 | 四层画像 + 冷启动 + 摘要注入 + 确认机制 | 连续 3 篇论文后修改率显著下降 |
| v0.4 | 打磨导出 | HTML/MD 导出 + 领域地图 + 论文级反思 + UX | 端到端稳定，导出可分享 |
| 未来 | 扩展 | PDF 批注导出、多用户、批处理 | — |

### v0.1 管线打通（基础设施）✅ 已完成（2026-08-26）

**范围**
- 创建 `paper` profile（bundles：`dsh-base` + `dsh-web-app` + 本项目插件包）；配置 MinerU endpoint/API key（`MINERU_API` 环境变量）。
- Host 插件工具：`parse_pdf(path)`（上传 → 任务 → 轮询 → 解包 → 归一化为 `paper.md` + `anchors.json`）、`read_highlights()` / `write_highlights()`。
- Client 插件：最小 Markdown 渲染（正文文字部分）+ 高亮层渲染框架（能按 spans 显示色块）。
- 数据模型落地：4.1 / 4.2 的 schema 与读写工具。

**验收（两项均通过，2026-08-26）**
- ① 输入真实会议论文 PDF → GUI 渲染出正文 Markdown：✅ 真实 MinerU 解析 `p-mikolov-2013-2013-1-word2vec`（11 页 / 80 锚点 / 28,880 字符），3081 GUI「论文」tab 目视确认渲染正常。
- ② Agent 可通过工具读取/写入 `paper.highlights.json`，GUI 能显示已写入的 spans：✅ Step 4 端到端（默认 paper preset 会话 → Agent parse_pdf → write_highlights 5 spans 五色 → read_highlights 回读逐项一致），GUI 目视确认 5 处色块 + 悬浮 rationale 正常。

**风险/依赖（均已化解，详见进度文档 §2 校准条目）**
- MinerU API 对本地上传的承载方式：`POST /api/v4/file-urls/batch` 预签名 PUT（须 Content-Length）。
- DSH client 插件注册：`conversation.view` 槽位 + ModuleLoader bundle 格式；host 数据通路走 `/paper-hl/read` webserver 路由。
- 正文文字过滤准确度：`scripts/step5-acceptance.js` 真实数据抽样校验（无表格/公式/图片/参考文献正文残留，仅 text/title 保留，跳过统计一致）。

### v0.2 审查闭环（核心 loop）

**范围**
- Agent 技能：全局通读（产出论文地图与章节计划）、逐节 propose（候选 spans + 理由）。
- GUI 审查交互：接受 / 删除 / 改色 / 改范围 / 手动新增 / 备注；审查完成后提交信号。
- 差异分析 + 章节反思：产出画像更新提案。
- 去重：论文地图「已高亮主张」清单驱动。

**验收**
- 完整跑通循环，人工评估 propose 质量可接受（高亮处确有语义价值、密度合理）。
- 用户删除/改色操作后，Agent 能给出合理的画像更新提案。

**风险/依赖**
- span 锚定在渲染后的稳定性（文本归一化、跨行处理）。
- 审查交互 UX 的舒适度（标注层与原文的视觉区分）。

### v0.3 个性化画像（收敛）

**范围**
- 冷启动配置流程（`colors.yml` + 密度/粒度基线声明）。
- 四层画像落地（4.3）：规则层 / 示例库 / 统计 / 反思笔记。
- 「画像摘要」注入 propose；画像更新提案的用户确认机制。
- 画像编辑面板（GUI）。

**验收**
- 同一用户连续处理 3 篇同领域论文后，审查修改率显著下降（示例：propose 接受率 ≥ 70%）。
- 画像文件结构稳定、可审计、可手工修正。

**风险/依赖**
- 差异分析推断质量（误推断需靠用户确认兜底）。
- 示例库规模过小时的 few-shot 效果。

### v0.4 打磨与导出

**范围**
- 导出带高亮 HTML（`<mark>` + 图例）/ Markdown。
- 领域地图 `field-map.md` 初建与注入机制完善。
- 论文级反思与收尾总结。
- UX 打磨：键盘操作、图例、快捷键、会话恢复（重开会话续读 JSON）。

**验收**
- 端到端稳定：完整流程无人工介入可交付导出文件。
- 导出 HTML 在浏览器/笔记软件中打开正常，图例完整。

---

## 9. 目录结构规划

```
D:\aa\                               # workspace 根（DSH 工作区）
├── docs\paper-highlight-agent-design.md
├── field-map.md                     # 领域发展线（NLP/LLM/Agent）
├── packages\
│   └── paper-highlight\             # 插件包（host + client + agent 技能）
│       ├── host\                    #   host 插件：MinerU 工具、JSON 读写、导出
│       ├── client\                  #   client 插件：渲染、高亮层、审查 UI
│       └── skills\                  #   agent 技能：propose / 反思工作流
├── data\
│   └── <paper_id>\                  # 每篇论文：paper.md / anchors.json / highlights.json / meta.json
└── highlight-profile\               # 画像四层（或放 profile 目录，见 4.3）
```

> 注：画像目录最终位置取决于 DSH profile 的数据目录约定，落地时确认；`data/` 亦可纳入工作区以便 Agent 直接访问。

---

## 10. 风险与未决问题

| # | 问题 | 影响 | 处理 |
|---|---|---|---|
| 1 | DSH client 插件注册/HMR 的精确 API（npm 包为 bundle） | ~~v0.1 阻塞~~ ✅ | 已解决：`conversation.view` 槽位 + `window.__ModuleLoader__` bundle 格式；host 数据通路走 `/paper-hl/read` webserver 路由（Step 3 实测） |
| 2 | MinerU API 对本地上传的承载方式 | ~~v0.1~~ ✅ | 已解决：`POST /api/v4/file-urls/batch` 预签名 PUT（须 Content-Length），系统自动提交任务（Step 0/2 真实冒烟校准） |
| 3 | 正文/非正文过滤准确度（公式、图表说明文字） | ~~v0.1~~ ✅ | 已解决：保留 text/title/content，SKIP_TYPES 扩充（ref_text/aside_text/page_number 等）；`scripts/step5-acceptance.js` 真实数据抽样校验通过（Step 5） |
| 4 | span 跨行/表格内锚定稳定性 | v0.2 | 锚定到 par 级 + 字符偏移；渲染端容错（就近匹配） |
| 5 | 差异推断质量 | v0.3 | 用户确认机制兜底；示例库积累 |
| 6 | 长论文（未来）的上下文管理 | 未来 | 论文地图压缩表示 + 分块注入 |
| 7 | 颜色数量与语义的表达力上限 | 全周期 | 冷启动时引导 ≤6 色；colors.yml 可自由编辑 |

---

## 11. 参考

- DeepSeek Harness：`@deepseek-ai/dsh`（本机安装于 `C:\Users\eyx\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh`；profile 位于 `C:\Users\eyx\.dsh\profiles\`）
- [MinerU 官方接口文档](https://mineru.net/apiManage/docs)
- [MinerU API 参考（Nebutra/MinerU-Skill）](https://github.com/Nebutra/MinerU-Skill/blob/main/references/api_reference.md)
- [mineru-mcp-server 文档](https://github.com/neosun100/mineru-mcp-server)
