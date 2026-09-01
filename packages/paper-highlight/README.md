# paper-highlight (v0.5.2 ✅)

论文多色高亮 Agent 的宿主插件包（host 逻辑 + client bundle + agent 工具 + 技能）。

> **用户手册**：安装 / 启动 / 使用 / 快捷键 / 导出 / 格式化 / FAQ 见 [`docs/paper-highlight-user-guide.md`](../../../docs/paper-highlight-user-guide.md)（面向使用者；本文件为开发者说明）。

> v0.1（管线打通）2026-08-26 验收通过；v0.2（审查闭环）2026-08-27 验收通过；**v0.3（画像收敛）2026-08-27 验收 PASS**：四层画像（`highlight-profile/`）+ 冷启动引导 + colors.yml 驱动图例/色板 + GUI 画像编辑面板 + propose 摘要注入（`read_profile`）+ 待确认提案面板 + 确认闭环（`confirm_proposal` / `/profile/apply`，append-only）+ 三篇同领域论文收敛验收（`step7-multi-paper.js`：认可率 50%→67%→100%，修改率 50%→33%→0%，PASS）。验收记录见 `D:\aa\docs\paper-highlight-progress-v0.3.md`。
> **v0.4（打磨导出）2026-08-27 验收 PASS（归档 `v0.4.0`）**：HTML/MD 导出（`export_paper` 工具 + `/paper-hl/export` 路由 + GUI 导出对话框）+ 领域地图 `field-map.md` + `read_field_map` 只读注入 + 论文级反思（`reflect_paper` / `paper-reflection.md`）+ UX 打磨（`keyAction` 快捷键 / 审查进度条）。验收记录见 `D:\aa\docs\paper-highlight-progress-v0.4.md`（M0–M5 全达标）。
> **v0.5（一键格式化）2026-08-27 Phase 0 完成（`v0.5.0` 待验收）**：工厂重置 —— 清空所有论文高亮记录（`paper.highlights.json` 重置 + `reflections.json`/`export/`/`paper-reflection.md` 删除，保留论文正文）+ 删除个性化画像（`highlight-profile/`，回到冷启动）。GUI「格式化」按钮 + 确认对话框（`callFormat` → `POST /paper-hl/format`）+ `format_all` 工具（confirm 门禁，scope all/highlights/profile）。进度见 `D:\aa\docs\paper-highlight-progress-v0.5.md`。
> **v0.5.1（图例彩色语义 + 轻量公式渲染）2026-08-31 验收 PASS（归档 `v0.5.1`）**：①图例五个语义标签用对应高亮色显示（`phl-legend-label`）；②轻量（零依赖，无 KaTeX/MathJax）公式渲染 —— `render-body.js` 纯函数 `MATH_SYMBOLS`/`supScript`/`subScript`/`boldMath`/`mathClean`/`mathConvert`/`matchMathDelim`/`matchMathToken`/`splitMathPieces`/`mathPieceEl` 支持 `$…$`/`$$…$$`/`\(…\)`/`\[…\]` 定界符与 MinerU 裸 LaTeX 片段（`\times`→×、`_ { 2 }`→₂、`\mathbf{f}`→𝐟、`\bar{U}`→Ū、OCR `{ - }`→-、未知命令保留）。**⚠️ 数学渲染已于 v0.5.3 移除（回滚至 v0.5.0 纯文本渲染），仅图例彩色语义保留**。进度见 `D:\aa\docs\paper-highlight-progress-v0.5.1.md`。
> **v0.5.2（章节目录一键审批）2026-08-31 Phase 0 完成（归档 `v0.5.2`）**：点击章节目录芯片（如 Abstract）→ 批量接受该节全部 proposed 高亮 + 标记该节审查完毕；**agent 未在该节提出高亮时同样「通过」**（接受 0 + 标记已审）。host 新增**原子动作** `POST /paper-hl/write {action:'approve_section', section:<id>}`（`host/actions.js` `applyApproveSection`：按 `buildSections.anchor_ids` 判定节内 span，proposed→accepted 逐条追加用户 decision，已接受/用户新增/拒绝不动；空/未知节接受 0 + 仍标 reviewed；`plugin.js` 响应新增 `accepted`/`accepted_count`）；client 节芯片 `onClick` → `approveSection(id)`（`localApproveSectionSpans` 乐观接受 + 乐观 ✓ + `callWrite` 回读校准，成功逐条 `reconcileSpan`、失败整页回读）。既有「标记本节审查完毕」（`review_section`）保留、语义分离。进度见 `D:\aa\docs\paper-highlight-progress-v0.5.2.md`。
> **v0.5.3（放弃数学渲染 + 一键审批反选 + 画像面板修复）2026-08-31 Phase 0 完成（归档 `v0.5.3`）**：①**移除 v0.5.1 轻量公式渲染**（回滚至 v0.5.0 纯文本渲染：`renderText`/`buildBlockSegments`/`nodeOffsetToSeg`/CSS/嵌入/导出全部还原 v0.5.0，正文按原文逐字节渲染，不再出现公式灰块）——**图例彩色语义保留**；②**一键审批「反选」= 批量恢复待审**：**Shift+点击**章节芯片 = **撤销该节的一键审批** —— 该节已接受（accepted）高亮批量恢复为**待审**（proposed）+ 该节状态恢复为**待审查**（pending）（host 新增原子动作 `revert_section`：`applyRevertSection` 为 `applyApproveSection` 的逆，accepted→proposed 逐条追加用户 decision + `resolvePendingEntry` 清 reviewed_at；`plugin.js` 响应新增 `reverted`/`reverted_count`；client `revertSection(id)` 镜像 `approveSection`，普通点击仍为审批；**不是批量否决**）；③**修复画像面板空白 + 无法返回**（v0.3 遗留潜在 bug：空示例时 `exemplarRows` 为单个元素被 `...exemplarRows` 展开 → 运行时崩溃，格式化后示例=0 才暴露；改为恒返回数组）。验证：`run-render.js`/`run-actions.js`/`run-plugin.js` PASS + profile-blank 探针 PASS（面板渲染 5 色/2 规则/示例空态/返回论文）+ revert-flow 探针 PASS（普通点击→approve_section POST + 芯片 done、Shift+点击→revert_section POST + 已恢复为待审反馈 + 芯片回待审查）+ live client bundle 验证 PASS。⚠️ **host 变更（`revert_section`/`approve_section`）需重启 3081 后落盘生效**（重启前客户端提示「审批/恢复待审失败（已回读校准）」并回读，不损坏数据）。进度见 `D:\aa\docs\paper-highlight-progress-v0.5.3.md`。

## 布局

```
host/
  schema.js     # anchors / paper.highlights.json 数据模型与校验（设计 §4.1/§4.2）+ reflections.confirmation
  store.js      # data/<paper_id> 读写（paper.md / anchors.json / meta.json / highlights）
  mineru.js     # MinerU 云 API 客户端：上传 → 建任务 → 轮询 → 下载 zip
  normalize.js  # MinerU zip → paper.md + anchors.json + meta.json（正文过滤 + 锚点）
  pipeline.js   # 端到端管线：parsePdf → normalize → writePaper
  plugin.js     # (Step 3) durable host 插件：/paper-hl/read + /write + /profile + /init + /apply + /save + /export + /format 路由
  profile.js    # (v0.3) 画像四层：ensureProfile / buildProfileSummary / applyProposal / applyProfileUpdate 纯逻辑
  export.js     # (v0.4 Phase 0) 导出纯逻辑：buildExportSpans / renderHtml / renderMarkdown / 图例 / 自包含 HTML（设计 §4.4）
  reflection.js # (v0.4 Phase 3) 论文级反思模板：paperReflectionTemplate / writePaperReflection（设计 §5.5）
  format.js     # (v0.5) 一键格式化纯逻辑：formatHighlights / normalizeScope / formatAll（confirm 门禁 + 三 scope + 审计统计）
  tools.js      # (Step 2 + Phase 1/2/3 + v0.5) agent 工具：parse_pdf / read_highlights / write_highlights / list_sections / read_section / summarize_section_diff / read_profile / confirm_proposal / export_paper / read_field_map / reflect_paper / format_all（12 工具）
  tools-plugin.mjs # (Step 2) 工具行 ESM 包装（allTools() 自动注册全部工具）
  diff.js       # (Phase 4) 审查差异分析纯函数：classifySpanChange / summarizeDiff（计数+接受率+样例）
client/
  client.js     # (Step 3) durable client bundle：conversation.view「论文」tab 渲染 + 高亮层 + 画像/提案面板 + 导出对话框 + 格式化对话框 + 快捷键 + 进度条
  render-body.js# 渲染逻辑单一来源（gen-client.js 由它生成 bundle 与动态半；keyAction/reviewProgress/buildExportUrl/callFormat + v0.5.1 图例彩色语义 + 轻量公式渲染：MATH_SYMBOLS/supScript/subScript/boldMath/mathClean/mathConvert/splitMathPieces 纯函数，renderText/buildBlockSegments/nodeOffsetToSeg 数学片段支持）
scripts/
  gen-client.js # 生成 client/client.js 与 dynamic/client-half.js
  seed-demo.js  # 种子演示 spans（幂等，store 同路径）
  verify-http.js # 三条通路自检（首页 / client bundle / /paper-hl/read）+ /export live 探针
  simulate-render.js # 无浏览器渲染模拟：React/DOM shim 执行已发布 bundle，走真实 3081 数据通路断言渲染树（含冷启动引导 / 画像面板 / 提案面板 / 导出对话框 / 快捷键分派 / 进度条交互）
  step4-e2e.js  # Step 4 端到端验收驱动：3081 上 session.create(默认 paper preset) → prompt Agent 跑真实管线 → 轮询至空闲 → 汇总 + /paper-hl/read 判定
  step5-acceptance.js # Step 5 收尾抽样：真实数据锚点契约(md_offset/阅读序) + highlights 校验 + 正文过滤抽查 + v0.1 验收判定
  step6-e2e.js  # v0.2 端到端：global-read → propose → GUI 模拟审查 → reflect → reflections.json（PASS）
  step7-multi-paper.js # (v0.3 Phase 4) 三篇同领域论文收敛验收驱动：propose→审查→reflect→确认全闭环
  step8-export-e2e.js # (v0.4 Phase 5) 导出端到端验收：真实论文 export_paper html+md 产物校验 + include_pending + 论文级反思结构断言（PASS）
  profile-stats.js     # (v0.3 Phase 4) 逐篇收敛指标（认可率/修改率曲线 + 判定，--baseline/--final）
  check-host.js # 动态双半体校验（解析门控 + 插件形状）
dynamic/
  host-half.js  # 动态双半插件 host 半（harness.handle 数据源，备用）
  client-half.js# 动态双半插件浏览器半（host.call 数据源，备用）
skills/         # (Phase 3/4) agent 技能：global-read（论文地图+plan + read_field_map 领域定位）/ propose（逐节 + read_profile 摘要注入 + read_field_map 按需 + 去重硬规则）/ reflect（summarize_section_diff 差异分析→画像提案→等待确认 + 论文级反思 reflect_paper→paper-reflection.md）
                #   运行时接线：<projectRoot>/.agents/skills → junction → 本目录（DSH skill-filesystem 按 cwd 自动发现）
test/
  run-mock.js   # 离线 mock 验证（无网络）
  run-tools.js  # 工具定义 + 读写往返 + 非法 span 拒绝 + lossless JSON 回归 + append 模式 + list_sections/read_section + summarize_section_diff + duplicates 契约 + read_profile/confirm_proposal + export_paper + read_field_map + reflect_paper + format_all（v0.3 + v0.4 + v0.5）
  run-plugin.js # host 插件 /paper-hl 路由回归（read/write/profile/init/apply/save/export/format + 负例矩阵）
  run-render.js # 渲染纯函数矩阵（P2-a…e + v0.3 colorLegend/callProfile/面板模型/提案模型 + v0.4 keyAction/reviewProgress/buildExportUrl + v0.5 callFormat + v0.5.1 数学转换器/splitMathPieces/renderText 数学 span/选区映射/非数学布局回归守卫）
  run-profile.js# (v0.3) 画像层单测：冷启动/校验/摘要/applyProposal/applyProfileUpdate/confirm 工具矩阵
  run-export.js # (v0.4 Phase 0) 导出层单测：渲染矩阵 + 自包含断言 + 模板矩阵
  run-reflect-paper.js # (v0.4 Phase 3) 论文级反思模板单测：空/全接受/混合 diff/画像行/逐节表
  run-format.js # (v0.5) 一键格式化单测：normalizeScope/formatHighlights/formatAll 三 scope + confirm 门禁 + 路由矩阵（GET 404 / 缺 confirm 400 / 坏 JSON 400 / 未知 scope 400 / confirm:true 200 + 审计 + 磁盘断言）
  run-real.js   # 真实 MinerU 端到端验证（需 MINERU_API）
```

> 领域地图：`D:\aa\field-map.md`（workspace 根，git 跟踪，设计 §7）—— 领域发展线 + 论文定位 + 里程碑/范式转移标注 + 空白区；`read_field_map` 只读注入、Agent 用文件工具 append-only 增补。

## 配置

- `MINERU_API`（或 `MinerU_API`）：MinerU API key
- `MINERU_BASE_URL`：默认 `https://mineru.net`
- `MINERU_UPLOAD_MODE=file|url`：上传方式（file = `POST /api/v4/file-urls/batch` 预签名上传，默认；url = `POST /api/v4/extract/task` 公开 URL）
- `MINERU_OCR=1`：强制 OCR；`MINERU_FORMULA=1`：启用公式识别；`MINERU_LANGUAGE=en`
- 数据根目录解析顺序（host/plugin.js）：组合 config `root`（paper profile patch 已钉 `D:\aa`）→ 环境变量 `PAPER_HL_ROOT` → `process.cwd()`（仅兜底；曾因从用户主目录重启 3081 导致 `scandir C:\Users\eyx\data` → 500）
- 画像根目录（host/profile.js）：同数据根 → `highlight-profile/`（`D:\aa\highlight-profile/`）

## 测试

```powershell
$env:NODE_PATH = 'C:\Users\eyx\.dsh\profiles\node_modules'   # fflate 解析
node test/run-mock.js
node test/run-tools.js
node test/run-plugin.js
node test/run-render.js
node test/run-profile.js
node test/run-export.js
node test/run-reflect-paper.js
node test/run-format.js
node scripts/simulate-render.js   # live 3081，POST/profile/format 走 mock，真实数据零改动
node scripts/step8-export-e2e.js  # v0.4 Phase 5：真实论文导出端到端（离线，无需 3081）
node scripts/profile-stats.js --baseline=p-mikolov-2013-2013-1-word2vec --final=p-bahdanau-2016-attention   # 收敛曲线 + 判定
node test/run-real.js "D:\aa\<paper>.pdf"
```

## 数据模型要点

- anchor_id = `a-<page:04d>-<block:02d>-<par:02d>`（1 起始、零填充）
- span 的 `char_start/char_end` 为 0 起始、半开区间，指向 `anchor.text`
- `md_offset` 保证锚点文本在 `paper.md` 中按字符精确定位（标题块偏移在 `# ` 前缀之后）
- 正文过滤：保留 text/title/content；跳过 image/table/formula/ref_text（参考文献）/页眉页脚（MinerU 已归入 discarded_blocks 的 aside_text/page_number 等），统计进 `meta.stats.skipped`
- 真实 MinerU zip 中间结构：`layout.json` → `pdf_info[i].para_blocks`（块序即阅读序，勿按 bbox 重排）；span 文本在 `spans[].content`

## GUI 渲染（Step 3）

- 槽位：`conversation.view`（list 槽 / session 作用域）——包作为 profile bundle 时自动注册「论文」tab
- host 路由：`GET /paper-hl/read[?paperId=]` → `{ok, paperId, paperMd, anchors, highlights, papers}`；`POST /paper-hl/format`（v0.5 一键格式化，`{confirm:true, scope?}` → 审计统计；缺 confirm → 400；仅 POST）（`host/plugin.js`）
- client bundle：`client/client.js`（`fetch('/paper-hl/read')`，锚点序渲染 + `<mark>` 高亮 + 图例（**v0.5.1 语义标签彩色**）+ 刷新/选论文/导出/格式化 + **v0.5.1 轻量公式渲染**（`$…$`/`$$…$$` 等定界符 + 裸 LaTeX 片段 → 衬线斜体；悬停显示原始 LaTeX；导出仍保留原始文本））
- 重新生成 bundle：`node scripts/gen-client.js`（改 `client/render-body.js` 后必须重跑）
- paper profile（3081）：`dsh --profile paper --port 3081 --no-open`；数据根目录解析：组合 config `root`（profile patch 已钉 `D:\aa`）→ `PAPER_HL_ROOT` → `process.cwd()`（兜底）；从任意目录重启均不丢数据
