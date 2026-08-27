# Paper Highlight Agent —— 一页纸快照

> **项目**：DSH 单论文多色高亮 Agent · **状态**：**v0.1 ✅ / v0.2 ✅ / v0.3 ✅（画像收敛，归档 v0.3.0）**
> **定位**：PDF → MinerU 解析 → GUI 渲染 → Agent 逐节 propose 高亮 → 用户审查 → 画像持续学习


## 📌 一句话

Agent 依据论文地图 + 用户画像逐节提出语义高亮（五色），用户在 `dsh web` 上审查/修改，操作即画像学习信号，偏好随使用收敛。

## 🧱 技术架构

| 层 | 内容 |
|---|---|
| **Client**（浏览器） | `conversation.view` 槽位插件，渲染 Markdown + `<mark>` 高亮层，操作条/节列表/**画像面板**/**待确认提案面板** |
| **Host**（Node） | `/paper-hl/read` + `/write` + `/profile` + `/init` + `/apply` + `/save` 路由；原子读写 `data/<paper_id>/paper.highlights.json` |
| **Agent**（LLM） | 三技能：`global-read`（论文地图+plan，参考画像摘要）、`propose`（逐节候选 + **`read_profile` 摘要注入**）、`reflect`（差异分析→画像提案→等待确认） |
| **工具**（8个） | `parse_pdf`, `read/write_highlights`, `list_sections`, `read_section`, `summarize_section_diff`, `read_profile`, `confirm_proposal` |

## 📁 关键路径

- 插件包：`D:\aa\packages\paper-highlight\`
- 论文数据：`D:\aa\data/<paper_id>/` → `paper.md` + `anchors.json` + `paper.highlights.json`
- 画像存储：`D:\aa\highlight-profile/` → `colors.yml` + `rules.json` + `exemplars.json` + `stats.json` + `reflection-notes.md`
- 运行：`dsh --profile paper --port 3081 --no-open`（**paper profile 独立端口 3081，Agent 不得自行 kill/restart**）

## 📦 数据契约（不可变）

```
paper.highlights.json:
  - plan: { summary, sections: [{ id, expected_colors, density_hint, skip, status }] }
  - spans: [{ id, anchor, char_start/end, color, rationale, status, decisions:[] }]
  - duplicates: [{ claim, repeats_at }]   # 去重登记，propose 默认跳过

reflections.json:
  - profile_proposal: { rules:[], exemplars:[], stats:{} }  # 画像更新提案
  - confirmation: null | { accepted, at }                    # 确认后一次性写入

highlight-profile/ 四层（设计 §4.3）:
  - L1 colors.yml（五色语义，用户可编辑）
  - L2 rules.json（密度/粒度/去重规则）
  - L3 exemplars.json（参考示例库）
  - L4 stats.json + reflection-notes.md（统计 + 笔记）
```

## ✅ v0.1 / v0.2 / v0.3 交付状态

| 版本 | 主题 | 交付物 | 状态 |
|---|---|---|---|
| **v0.1** | 管线打通 | PDF → MinerU → `data/` 归一化 → Agent 读写高亮 → GUI 渲染 | ✅ 已交付 |
| **v0.2** | 审查闭环 | 全局通读→逐节 propose→GUI 审查（接受/删除/改色/改范围/新增/备注）→差异分析→`reflections.json` 提案 | ✅ 已交付（含 step6-e2e PASS） |
| **v0.3** | 画像收敛 | 四层画像 + 冷启动 + colors.yml 驱动图例 + 画像/提案面板 + propose 摘要注入 + 确认闭环 + **三篇收敛验收（step7：认可率 50%→67%→100%，PASS）** | ✅ 已交付（归档 v0.3.0） |
| **v0.4** | 打磨导出 | HTML/MD 导出 + 领域地图 + 论文级反思 + UX | 规划中 |

**v0.3 当前实际**：`highlight-profile/` 积累 **9 规则 + 13 示例 + 2 篇统计**（overall 认可率 80%）；三篇同领域论文（Mikolov 2013 / Sutskever 2014 / Bahdanau 2016）全闭环跑通，收敛指标达标（模拟用户逐篇收敛成分已如实记录，真人曲线待真实使用验证）。

## ⚙️ 关键约束（每次续作必读）

1. **数据根目录**：`config.root` → `PAPER_HL_ROOT` → `process.cwd()` 兜底；paper profile 已钉 `root: D:\aa`
2. **MinerU**：`POST /api/v4/file-urls/batch`（须 Content-Length）→ 预签名 PUT → 轮询 `/extract-results/batch/{batch_id}` → 下载 `full_zip_url`；zip 内是 `layout.json`，用 `para_blocks`（原始数组序，**禁 bbox y 排序**）
3. **工具输出**：必须 lossless JSON（`undefined`/`NaN`/`Infinity`/`BigInt` 会报错 → 显式 `?? null`）
4. **工具注册**：`defineTool` 的 `parameters` 需显式 `additionalProperties: true`
5. **client 插件**：`window.__ModuleLoader__.load({id, factory})` bundle；数据走同源 `fetch('/paper-hl/read')`
6. **profile 启动**：`dsh --profile paper --port 3081 --no-open`（`prepareProfile` 重写 cordis.yml → 需 danger-full-access）
7. **环境纪律**：**3081 = 会话 Web，Agent 不得自行 kill/restart**；host 代码变更后由**用户手动重启**；live 验证前先 `GET /paper-hl/read` 确认新代码已加载

## 🧪 回归测试

```powershell
node test/run-mock.js && node test/run-tools.js && node test/run-actions.js
node test/run-plugin.js && node test/run-render.js && node test/run-profile.js
node scripts/simulate-render.js   # live 3081，POST 走 mock，真实数据零改动
node scripts/verify-http.js       # 路由自检
node scripts/step6-e2e.js         # v0.2 端到端（需 LLM 会话，按需）
```

## 🚧 下一步（v0.4）

| 项 | 内容 | 依赖 |
|---|---|---|
| **v0.4** | 导出带高亮 HTML/MD + 领域地图 `field-map.md` + 论文级反思 + UX 打磨 | v0.3 已全部完成（无遗留待办） |

**当前数据状态**：三篇论文（mikolov 12+ spans / sutskever 9 spans / bahdanau 6 spans，各含 plan + reviewed 节 + reflections）；`highlight-profile/` **9 规则 + 13 示例 + 2 篇统计**；`p-mikolov` 的 `reflections.json` 提案仍待确认（可在 GUI「提案」面板演示确认流程）。