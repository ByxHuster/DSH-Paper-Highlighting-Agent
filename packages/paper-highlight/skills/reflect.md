---
name: paper-hl-reflect
description: 论文审查后反思（章节反思）——重读 paper.highlights.json，对已审查节做差异分析（proposed→final），推断改色规律/删除模式/粒度偏好，产出「画像更新提案」（规则修正 + 示例入库 + 统计雏形）落盘 data/<paper_id>/reflections.json。只产出提案，用户确认后才生效，防画像污染。
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
8. **呈报并等待确认**：把「画像更新提案」摘要呈给用户（改了什么规则、要入库哪些示例、统计数字）。**用户明确确认后**才把 L2 规则并入正式画像（v0.3 highlight-profile/rules.json）；**未确认前只落盘提案**，绝不自动改写颜色语义或密度规则（防污染）。

## 完成标志

- 已审查节的差异分析已落盘 `reflections.json`（含计数 + inferred + profile_proposal）。
- 已向用户呈报提案并等待确认。

## 输出

该节差异摘要（接受/删除/改色/新增计数 + 接受率）、推断出的模式、画像更新提案要点；等待用户「确认 / 否决」。
