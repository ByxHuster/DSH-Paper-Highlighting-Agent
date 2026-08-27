---
name: paper-hl-reflect
description: 论文审查后反思（章节反思）——重读 paper.highlights.json，对已审查节做差异分析（proposed→final），推断改色规律/删除模式/粒度偏好，产出「画像更新提案」（规则修正 + 示例入库 + 统计雏形）落盘 data/<paper_id>/reflections.json。只产出提案，用户确认后由 host 合并（confirm_proposal / GUI 提案面板），防画像污染。
---

# Paper Highlight · 审查后反思（reflect）

用途：用户对某节说「审查完毕」后，Agent 重读 JSON、算差异、学习画像。反思的价值在于把用户的修改转化为可复用规则；**不自我空转**——高亮的对错只能由用户定义。

## 前置

- 该节已由用户审查完毕（GUI 操作已通过 host `/paper-hl/write` 落盘到 `paper.highlights.json`）。
- 只对「已审查节」（plan.sections[] 中 `status:'reviewed'` 或用户刚确认完毕的节）做分析。

## 步骤

1. `list_sections`（paper_id）：确认哪些节已 `status:'reviewed'`。
2. `read_highlights`（paper_id）：取完整文档（spans 含 decisions 日志、plan、duplicates）。
3. **差异分析（用工具，勿手数，Phase 4）**：对每个已审查节调用 `summarize_section_diff`（paper_id, section）—— 工具按 decisions 日志自动分类 accepted/rejected/recolored/rescoped/noted/added/pending，输出计数、接受率与每类样例（改色含 from→to、改范围含区间）。整篇汇总时省略 section 参数。
   - 兜底：若会话工具目录尚无 `summarize_section_diff`（host 工具需重启生效），按同样的分类逻辑从 `decisions[]` 手动计数与抽样，输出格式保持一致。
4. **信号解读**（把工具输出的每类样例映射为画像信号）：
   - 接受：保持 `accepted`，无用户修改 → 画像信号「这类高亮符合预期」。
   - 删除：`rejected` → 价值/密度信号（这类句子不该高亮）。
   - 改色：`recolored {from,to}` → 颜色-语义映射修正信号。
   - 改范围：`rescoped` → 粒度偏好信号（如「以子句而非整句」）。
   - 备注/新增：`noted` / `added` → 用户关注点信号（用户手动加的是什么）。
5. **推断**（只对「明确的、重复出现的」模式下结论，避免把个例当规则）：
   - 改色规律：如「黄色全被改红 → 本用户认为这类内容属核心贡献而非定义」。
   - 删除模式：如「铺垫句全被删 → 密度/价值偏好收紧」。
   - 粒度偏好：如「某类 span 被扩范围 → 以子句而非整句」。
6. **产出画像更新提案**：将推断整理为「L2 规则修正提案 + L3 示例入库 + L4 统计雏形」，写入 `data/<paper_id>/reflections.json`（每论文一份，若存在则合并追加、只增不改历史）：

```jsonc
{
  "paper_id": "p-...",
  "updated_at": "<ISO 时间>",
  "sections": [
    {
      "section_id": "s3",
      "status": "reviewed",
      "counts": { "proposed": 4, "accepted": 3, "rejected": 1, "recolored": 1, "rescoped": 0, "user_added": 1 },
      "accept_rate": 0.75,
      "notes": "用户手动新增了未来工作方向类高亮"
    }
  ],
  "inferred": [
    "黄色全被改红 → 颜色-语义映射认知修正（该用户把贡献类内容归 red）",
    "铺垫句全被删除 → 密度/价值偏好收紧"
  ],
  "profile_proposal": {
    "rules": [ { "rule": "color_semantics: yellow→red 类内容按 red 提出", "confidence": "high", "from": "s3 节 3 例全改红" } ],
    "exemplars": [ { "span_id": "s-00X", "suggested": { "color": "yellow" }, "user_decision": { "color": "red" }, "section": "s3" } ],
    "stats": { "sections_reviewed": 1, "overall_accept_rate": 0.75, "recolor_events": 1 }
  }
}
```

7. **写盘**：`write` / `edit` 工具直接写 `data/<paper_id>/reflections.json`（agent 文件工具可达；保持 JSON 合法、lossless）。
8. **呈报并等待确认（v0.3 Phase 2）**：把「画像更新提案」摘要呈给用户（改了什么规则、要入库哪些示例、统计数字）。确认走**双通道**，合并动作一律由 host 纯逻辑执行（`applyProposal`），Agent **绝不直接写 rules.json**：
   - **GUI 通道（主）**：用户打开「待确认提案」面板（「提案」按钮），逐条或全部接受/否决 → host `POST /paper-hl/profile/apply`。
   - **聊天通道（等价信号）**：用户说「确认提案」→ Agent 调用 `confirm_proposal` 工具（paper_id + `decisions: {accept: 'all' | [ids], reject: 'all' | [ids]}`，id 为提案内 `rule-<i>` / `exemplar-<i>` 或规则自身 id）→ host 合并并入 highlight-profile 四层 + 写 `reflections.json.confirmation`（append-only，一次确认后不可再确认）。
   - **未确认前只落盘提案**，绝不自动改写颜色语义或密度规则（防污染）。低置信规则被确认后会以「禁用候选」形式入库（`enabled:false`），需用户在画像面板启用后生效。

## 完成标志

- 已审查节的差异分析已落盘 `reflections.json`（含计数 + inferred + profile_proposal）。
- 已向用户呈报提案并等待确认（GUI 面板或聊天确认）。

## 输出

该节差异摘要（接受/删除/改色/新增计数 + 接受率）、推断出的模式、画像更新提案要点；等待用户「确认 / 否决」。

---

# 论文级反思（收尾，v0.4 Phase 3，D5）

用途：整篇论文审查完的「收尾」动作 —— 把逐节反思汇总为**可交付、可沉淀**的论文级总结，并落盘 `data/<paper_id>/paper-reflection.md`。

## 触发

全部可审查节 `status:'reviewed'`，**或**用户说「论文完毕 / 收尾」。

## 步骤

1. **整篇差异汇总**：调用 `summarize_section_diff`（paper_id，**省略 section 参数**）→ 整篇分类计数 + 认可率 + 样例。
2. **生成反思脚手架**：调用 `reflect_paper` 工具（paper_id, root）→ 返回 `paperReflectionTemplate` 结构化模板（论文概述 / 审查进度表 / 整篇差异汇总 / 沉淀偏好 / 领域地图增补点 / 未来工作方向 / 导出状态），其中数据派生部分已填（节表、diff 计数、画像现状、导出候选数）。
3. **填充自然语言**（用 `write` / `edit` 工具落到 `data/<paper_id>/paper-reflection.md`，可先 `reflect_paper output:'file'` 写脚手架再编辑）：
   - 论文概述：一段话概括本文贡献 + 领域定位 + 高亮策略要点（对照 `read_field_map`，见 global-read 步骤 3）。
   - 沉淀偏好：把 diff 样例映射为「推断信号」（接受=偏好稳、删除=价值/密度收紧、改色=颜色-语义修正、改范围=粒度偏好、新增=关注点）；**偏好仍走 `profile_proposal`（需用户确认）**，Agent 不直接写 rules.json。
   - 领域地图增补点：本论文在领域主线的定位增量 / 提议增补 `field-map.md` 的条目（field-map 不存在则提议初建；增补用文件工具 append-only）。
   - 未来工作方向：purple 类主张 / 值得继续深挖或存疑的方向。
4. **呈报并收尾**：向用户汇报论文级反思要点 + 导出可用性（`export_paper` html|md）→ 可进入导出（用户决定时机）。

## 完成标志

- `data/<paper_id>/paper-reflection.md` 已落盘（含 7 个结构化小节，自然语言部分已填充）。
- 已向用户呈报论文级反思摘要与下一步（导出 / 下一论文）。
