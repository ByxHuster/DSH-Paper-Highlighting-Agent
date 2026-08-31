# Paper Highlight Agent —— 一页纸快照

> **项目**：DSH 单论文多色高亮 Agent · **状态**：**v0.1 ✅ / v0.2 ✅ / v0.3 ✅ / v0.4 ✅（打磨导出，归档 v0.4.0）/ v0.5 ✅（一键格式化，归档 v0.5.0）/ v0.5.1 ✅（图例彩色语义 + 轻量公式渲染，归档 v0.5.1）**
> **定位**：PDF → MinerU 解析 → GUI 渲染 → Agent 逐节 propose 高亮 → 用户审查 → 画像持续学习 → 导出分享


## 📌 一句话

Agent 依据论文地图 + 领域发展线 + 用户画像逐节提出语义高亮（五色），用户在 `dsh web` 上审查/修改（含快捷键），操作即画像学习信号，偏好随使用收敛；成稿可一键导出 HTML/Markdown 分享。

## 🧱 技术架构

| 层 | 内容 |
|---|---|
| **Client**（浏览器） | `conversation.view` 槽位插件，渲染 Markdown + `<mark>` 高亮层，操作条/节列表/**画像面板**/**待确认提案面板**/**导出对话框 + 审查进度条 + 快捷键**/**一键格式化对话框**/**图例彩色语义 + 轻量公式渲染** |
| **Host**（Node） | `/paper-hl/read` + `/write` + `/profile` + `/init` + `/apply` + `/save` + `/export` + `/format` 路由；原子读写 `data/<paper_id>/paper.highlights.json` |
| **Agent**（LLM） | 三技能：`global-read`（论文地图+plan + **`read_field_map` 领域定位**）、`propose`（逐节候选 + **`read_profile` 摘要注入** + 领域地图按需）、`reflect`（差异分析→画像提案 + **论文级反思 `reflect_paper`→`paper-reflection.md`**） |
| **工具**（12个） | `parse_pdf`, `read/write_highlights`, `list_sections`, `read_section`, `summarize_section_diff`, `read_profile`, `confirm_proposal`, `export_paper`, `read_field_map`, `reflect_paper`, `format_all` |

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
| **v0.4** | 打磨导出 | HTML/MD 导出（`export_paper` + `/export` 路由 + GUI 导出对话框）+ 领域地图 `field-map.md` + `read_field_map` + 论文级反思（`reflect_paper`/`paper-reflection.md`）+ UX（快捷键/进度条） | ✅ 已交付（归档 v0.4.0；step8 端到端 PASS） |
| **v0.5** | 一键格式化 | 工厂重置：`format_all` 工具 + `/paper-hl/format` 路由（confirm 门禁 + scope all/highlights/profile）+ GUI「格式化」按钮 + 确认对话框；清空所有论文高亮记录（保留论文正文）+ 删除画像 | ✅ 已交付（归档 v0.5.0；`run-format.js` + simulate-render P5 + **live 3081 冒烟 PASS**，用户实跑格式化后磁盘状态与设计一致） |
| **v0.5.1** | 图例彩色语义 + 轻量公式渲染 | ①图例五个语义标签用对应高亮色显示；②轻量（零依赖，无 KaTeX/MathJax）公式渲染：`$…$`/`$$…$$`/`\(…\)`/`\[…\]` 定界符 + MinerU 裸 LaTeX 片段（`\times`→×、`_ { 2 }`→₂、`\mathbf{f}`→𝐟、OCR `{ - }`→- 等）→ 衬线斜体样式；数学片段独立 segment + `data-phl-dlen`，选区映射保持精确 | ✅ 已交付（归档 v0.5.1；`run-render.js` v0.5.1 矩阵 PASS + 选区/布局回归守卫 + gen-client 重跑 + **live 3081 bundle 验证 PASS**（刷新即生效）+ 真实数据只读探针 PASS + **空白页热修复**：`pushPlainSegs` 未嵌入 BODY → 补嵌 + 嵌入完备性守卫） |

**v0.5 当前实际**：一键格式化已实跑验证并归档 `v0.5.0` —— 三篇论文高亮全部清空（0 spans / 0 plan / 0 duplicates）、衍生文件（reflections/export/paper-reflection）删除、论文正文保留；`highlight-profile/` 经冷启动重建（2 条默认规则 + 0 示例 + 0 统计），可随时重新 propose 从头学起。

**v0.5.1 当前实际**：图例语义标签彩色显示、正文公式轻量渲染均已上线（client 变更，刷新页面即生效）；`run-render.js` v0.5.1 矩阵 + 选区/布局回归守卫 PASS；live 3081 bundle 已验证含新特性。**注意**：格式化后演示数据为空，`simulate-render.js` / `run-plugin.js` 第 2 步等「依赖演示数据非空」的回归需重新 propose 出高亮后自动恢复。

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
node test/run-export.js && node test/run-reflect-paper.js && node test/run-format.js
node scripts/simulate-render.js   # live 3081，POST/format 走 mock，真实数据零改动
node scripts/step8-export-e2e.js  # v0.4 导出端到端（离线，无需 3081）
node scripts/verify-http.js       # 路由自检（含 format 安全探针：无 confirm → 400）
node scripts/step6-e2e.js         # v0.2 端到端（需 LLM 会话，按需）
```

## 🚧 下一步（未来扩展）

| 项 | 内容 | 依赖 |
|---|---|---|
| 未来 | PDF 批注导出、多用户、批处理；领域地图空白区（Transformer/预训练/LLM）随论文收录扩展 | v0.4 已全部完成；v0.5 一键格式化已交付并归档 `v0.5.0`（live 验证 PASS）；v0.5.1 图例彩色语义 + 轻量公式渲染已交付并归档 `v0.5.1` |

**当前数据状态**：三篇论文正文齐备（mikolov / sutskever / bahdanau），高亮已按格式化验证清空；`highlight-profile/` 为冷启动默认（2 条默认规则）；后续 propose 将从零开始重建画像与高亮（重建后 `simulate-render.js` 等依赖演示数据的回归自动恢复）。