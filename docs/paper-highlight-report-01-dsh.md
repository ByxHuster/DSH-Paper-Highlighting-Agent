# 方案汇报 01 —— DeepSeek Harness (DSH) 生态与 Paper Highlight 插件集成架构

## 概述

**DeepSeek Harness (DSH)** 是一个基于 Cordis 架构的现代化 Agent 运行时与人机协同平台。该平台将底层大语言模型的**工具调用（Tools）**与**流程技能（Skills）**，与浏览器端的**富交互图形界面（Web GUI）**深度整合。

本项目以 **DSH 原生全栈插件**的形式挂载于 DSH 平台之上，通过共享数据层与事件回环，实现 Agent 自动化标注与人工专业审查的高效协同。

---

## 一、系统集成架构拓扑

整个系统分为三层架构：**表示层（GUI）、调度与运行时层（Host / DSH Core）、持久化工作区（Workspace）**。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. 表示层 (DSH Web GUI · 127.0.0.1:3081)                                    │
│    └─ dsh.client.inject 注入:                                               │
│       • client/client.js (高亮正文渲染器 / 内联 KaTeX / 交互决策面板 / 偏好审查) │
└───────────────────────────────▲─────────────────────────────────────────────┘
                                │ HTTP REST API (/paper-hl/*)
┌───────────────────────────────▼─────────────────────────────────────────────┐
│ 2. 调度与运行时层 (DSH Host Runtime)                                        │
│    ├─ host/plugin.js (路由分发器 · 暴露读写、提案、导出及静态图服务)            │
│    ├─ cordis.patch.yml (Bundle 运行时补丁注入)                                │
│    ├─ tools-plugin.mjs (向 ctx.tools 注册 12 个核心原子工具)                │
│    └─ skills/*.md (为会话 Agent 注入 3 个顶层工作流技能)                     │
└───────────────────────────────▲─────────────────────────────────────────────┘
                                │ 文件系统 I/O
┌───────────────────────────────▼─────────────────────────────────────────────┐
│ 3. 数据与工作区层 (DSH Workspace · D:\aa)                                   │
│    ├─ data/<paper_id>/ (核心真理源: paper.md / anchors.json / highlights.json)│
│    └─ highlight-profile/ (持久化自适应四层画像: colors / rules / exemplars / stats)│
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 二、插件集成机制（四大扩展挂载点）

本项目充分复用 DSH 提供的微内核扩展能力，通过四个挂载点实现全栈能力的平滑嵌入：

| 扩展通道 | 平台注入机制 | 本项目工程落地 | 职能定义 |
| :--- | :--- | :--- | :--- |
| **Host Bundle** | `package.json` 中的 `dsh.bundle.patch`<br>依托 `cordis.patch.yml` | `host/plugin.js` | 扩展 DSH 运行时，在 `/paper-hl/*` 命名空间下挂载 RESTful API 与静态静态图床资源。 |
| **Client Plugin** | `dsh.client.inject` | `client/client.js` | 向浏览器界面动态注入前端脚本，提供基于 KaTeX 的数学公式渲染与多色高亮交互 UI。 |
| **Tools Plugin** | `host/tools-plugin.mjs`<br>调用 `defineTool` | 注册 **12 个原子工具** | 将底层文件读写、差异比对及云端 API 调用封装为 Agent 可感知的标准工具集。 |
| **Skills** | `skills/*.md` 技能描述库 | 注册 **3 个协同技能** | 固化论文阅读、逐节提出与画像反思的标准协作 SOP，供 Agent 在会话中按需加载。 |

### 标准三步嵌入规范

1. **包声明（Declaration）**：在 `package.json` 中配置 `dsh.bundle.patch` 和 `dsh.client.inject`，将本模块作为独立 Bundle 声明至 DSH 服务注册表。
2. **挂载注册（Registration）**：利用 `cordis.patch.yml` 将 Host 服务注入运行时上下文；通过 `tools-plugin.mjs` 挂载 `ctx.tools`；暴露 `skills/` 目录供会话动态调度。
3. **接口分发（Routing）**：由 `host/plugin.js` 提供 `/paper-hl` 作用域下的全部服务（高亮读写、画像维护、格式刷处理、反思合并等）。

---

## 三、能力矩阵：工具与技能库

### 1. 核心工作流技能（Skills）

| 技能名称 | 对应阶段 | 职责定义 |
| :--- | :--- | :--- |
| `paper-hl-global-read` | 规划期 | 全文泛读，评估各章节论述权重，生成章节级计划（颜色配比、密度预估、跳过策略）。 |
| `paper-hl-propose` | 交互期 | 结合画像与上下文，针对**单一章节**提出高亮候选集，写入后自动挂起等待人工决策。 |
| `paper-hl-reflect` | 反思期 | 对比单节内的 `proposed` 与用户 `final` 决策，提炼偏好规律并生成画像更新提案。 |

### 2. 原子工具清单（12 Tools，按职责解耦）

```
[文档解析与预处理]
  ├─ parse_pdf                 # 调用 MinerU 云端 API 解析多模态 PDF 并生成基础语料
  └─ format_all                # 全文文本与标记的一致性格式化整理
[章节与文本切片读写]
  ├─ list_sections             # 读取全文目录索引与章节状态
  ├─ read_section              # 精确读取特定章节正文及锚点上下文
[高亮数据流驱动]
  ├─ read_highlights           # 读取当前论文的标注状态 (paper.highlights.json)
  ├─ write_highlights          # 增量写入 Agent 生成的候选标注 spans
  └─ summarize_section_diff    # 针对特定节计算 proposed 与 final 的结构化差异
[画像演进与持久化]
  ├─ read_profile              # 提取当前 highlight-profile/ 最新四层画像摘要
  ├─ confirm_proposal          # 幂等合并经由用户审阅确认的画像偏好提案
  └─ reflect_paper             # 论文级全局经验提炼与知识收尾
[领域拓展与导出]
  ├─ read_field_map            # 调取并关联研究方向的领域演进图谱
  └─ export_paper              # 导出包含高亮元数据的结构化 Markdown / PDF 成果
```

---

## 四、系统数据流与人机协同闭环

### 1. 单一真理源（Single Source of Truth）数据机制

Agent 与浏览器 GUI 之间**不直接进行私有状态通信**，而是完全围绕持久化文件解耦运作：

* **数据实体**：`data/<paper_id>/paper.highlights.json`。
* **Agent 侧**：通过 `read_highlights` / `write_highlights` 工具实现原子读写。
* **GUI 交互侧**：通过 `/paper-hl/read` 与 `/paper-hl/write` 接口直接渲染与修改同一实体。
* **优势**：消除了主从同步时序冲突，任何审查微调与 Agent 提议均实时收敛至同一份结构化 JSON，具备天然的可审计性。

### 2. 交互时序链路示例

```
[用户触发]           会话输入：“为 sutskever2014 提出高亮”
                        │
[Agent 规划]         调用技能 paper-hl-global-read ──> 产出全局 plan 并落盘
                        │
[增量推进 (节级)]    Agent 加载 paper-hl-propose ──> read_section 读取当前节
                        │ ──> 基于画像与 plan 写入 proposed spans ──> 挂起会话
                        │
[专家审查 (GUI)]     用户在前端检查高亮标注：
                        ├─ 接受 (Accept) / 改色 (Recolor) / 范围微调 / 否决 (Reject)
                        └─ 操作以 append-only 写入 span.decisions[]
                        │
[偏好反思]           用户驱动或状态流转触发 paper-hl-reflect：
                        │ ──> 比对 proposed vs final ──> 生成 reflections.json 提案
                        │
[偏好合并]           用户在 GUI 审查面板点击确认：
                        └─ confirm_proposal 触发 ──> 安全合入 highlight-profile/
```

> **回环触发辅助**：当用户在 GUI 端点击「重新提出高亮」时，系统通过 `/paper-hl/propose-request` 生成上下文操作指令，用户可直接贴回会话窗口，无缝驱动 Agent 开启下一轮迭代。

---

## 五、部署拓扑与工程基线

* **工作区根目录**：`D:\aa`（DSH Workspace 统一数据基座）。
  * 论文语料库：`data/`（当前已纳管 3 篇重点论文基准测试集）。
  * 偏好知识库：`highlight-profile/`（四层画像配置及统计数据）。
* **服务运行环境**：
  * GUI 访问端点：`http://127.0.0.1:3081`。
  * 源码架构：`packages/paper-highlight/`（模块化分包：`host/`、`client/`、`skills/`、`test/`、`scripts/`）。
* **版本演进**：
  * `v0.6.1 ~ v0.6.4`：完成富文本排版引擎落地，全面支持复杂数学公式（KaTeX）、表格、图片及说明文本渲染。
  * `v0.7.0`（当前演进版本）：建立完备的展示性内容隔离机制，完善偏好自适应防污染闭环，沉淀系统工程交付文档。