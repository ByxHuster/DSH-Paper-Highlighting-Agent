# 汇报文档 02 —— Paper Highlight Agent：主流程与画像系统

## 一、主流程

一个**人机协作的论文多色高亮 Agent**：Agent 提出候选，人在 GUI 审查，Agent 从审查结果中学习画像。核心是下面这条三轮协作链路：

```
① 解析      parse_pdf → MinerU 云 API → 归一化（正文/公式/表格/图片）
② 计划      paper-hl-global-read：通读全文 → 逐节高亮计划 plan
③ 提出      paper-hl-propose：逐节读正文 → 写 proposed spans → 停下
④ 审查      你：GUI 接受/否决/改色/改范围/加备注（决策写入 append-only 日志）
⑤ 反思      paper-hl-reflect：重读 JSON、差异分析 → 画像更新提案
⑥ 合并      你在 GUI 提案面板确认 → confirm_proposal 由 host 合并进画像
⑦ 收尾      论文完毕 → reflect_paper（论文级反思 + 领域发展线增强）
```

### 各阶段要点

- **① 解析**：PDF → MinerU 云 API（`host/mineru.js`）→ 归一化（`normalize.js`）保留正文、行内/行间公式、表格、图/表标题与图片栅格，全部落盘为 `paper.md` + `anchors.json`。
- **② 计划先行**：`global-read` 产出**章节级高亮策略计划**（每节 `expected_colors` / `density_hint` / `skip`），你先在 GUI 校准预期再动手——避免"Agent 高亮完一节你全删"。
- **③ 一次只做一节**：`propose` 只针对当前节提出候选（颜色 + rationale + 粒度，`status: proposed` 追加写入），**然后停下**等审查；审查完毕才进入下一节。
- **④ 人审**：接受/否决/改色/改范围/加备注，全部操作写入 span 的 `decisions[]`（**append-only 决策日志**，供反思与审计）。
- **⑤ 反思学习**：`reflect` 对该节做 proposed→final 差异分析（改色规律 / 删除模式 / 粒度偏好），产出**画像更新提案**。
- **⑥ 用户确认才合并**：提案在 GUI 提案面板展示，你逐条确认后由 host 合并进画像——**Agent 从不直接改写画像**（防污染）。
- **⑦ 收尾**：论文全部节审查完毕后，论文级反思汇总经验，并按需增补领域发展线（field-map）。

### 展示性内容治理（v0.7.0）

表格/图片主体是展示性内容（真实渲染、无可选区文本），**不参与高亮**：propose/plan 技能显式跳过（仅作阅读上下文，标题 `*_caption` 可正常高亮），schema 硬兜底拒绝违规 spans。

## 二、画像系统

画像（`highlight-profile/`）是 Agent"越用越懂你"的机制：把你在审查中的每一次修改，转化为可复用的偏好。

### 四层结构

| 层 | 文件 | 内容 |
|---|---|---|
| L1 颜色 | `colors.yml` | 颜色语义（默认：red=核心洞见/贡献、yellow=关键定义/方法、blue=局限/风险、green=可借鉴/启发、purple=待深挖/存疑；可自定义） |
| L2 规则 | `rules.json` | 偏好规则，如密度基线（每节 3-5 处）、粒度（句子级/短语级）；**低置信规则以"禁用候选"入库**，待未来证据启用 |
| L3 示例 | `exemplars.json` | 高亮示例库（suggested + 用户决策方向）——参考信号，不直接改写规则 |
| L4 统计 | `stats.json` | 累计认可率等统计（如"2 篇论文 · 认可率 70%"），衡量偏好稳定性 |

### 如何学习（防污染闭环）

```
审查操作（decisions[] 日志）
      ↓ reflect 差异分析（proposed → final）
      ↓ 产出 reflections.json 提案（规则修正 + 示例入库 + 统计雏形）
      ↓ 你在 GUI 提案面板确认（confirm_proposal）
      ↓ host 合并进四层画像
```

关键设计：

- **只产出提案，不直接写入**：Agent 任何学习都先落 `reflections.json` 提案，你确认后 host 合并——**防画像污染**，任何学习可回溯、可拒绝。
- **确认一次性**：提案确认是 append-only 的一次性操作，防止重复合并。
- **示例是信号不是规则**：候选主张与某示例的模式匹配时按"用户决策方向"提候选，但示例不直接生成规则。
- **冷启动**：无画像时用内置默认（五色 + 通用基线）也能工作，随审查逐步个性化；propose 时**每节新鲜取一次**画像摘要（你可能刚确认过更新）。

### 画像如何驱动 propose

propose 每节的判断顺序（优先级从高到低）：

```
画像规则（你已确认的偏好） > 通读期 plan 估计 > 内置默认
```

- 颜色：取自 L1 颜色语义（改过语义以画像为准）；
- 密度/粒度：取自 L2 启用规则（只参考 `enabled: true`），缺省回退该节 plan 的 `density_hint`；
- 参考：L3 示例的方向 + L4 统计（认可率高=偏好稳，放心按画像提；认可率低=保守按基线）。
