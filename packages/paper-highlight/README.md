# paper-highlight (v0.3 ✅)

论文多色高亮 Agent 的宿主插件包（host 逻辑 + client bundle + agent 工具 + 技能）。

> v0.1（管线打通）2026-08-26 验收通过；v0.2（审查闭环）2026-08-27 验收通过；**v0.3（画像收敛）2026-08-27 验收 PASS**：四层画像（`highlight-profile/`）+ 冷启动引导 + colors.yml 驱动图例/色板 + GUI 画像编辑面板 + propose 摘要注入（`read_profile`）+ 待确认提案面板 + 确认闭环（`confirm_proposal` / `/profile/apply`，append-only）+ 三篇同领域论文收敛验收（`step7-multi-paper.js`：认可率 50%→67%→100%，修改率 50%→33%→0%，PASS）。验收记录见 `D:\aa\docs\paper-highlight-progress-v0.3.md`。

## 布局

```
host/
  schema.js     # anchors / paper.highlights.json 数据模型与校验（设计 §4.1/§4.2）+ reflections.confirmation
  store.js      # data/<paper_id> 读写（paper.md / anchors.json / meta.json / highlights）
  mineru.js     # MinerU 云 API 客户端：上传 → 建任务 → 轮询 → 下载 zip
  normalize.js  # MinerU zip → paper.md + anchors.json + meta.json（正文过滤 + 锚点）
  pipeline.js   # 端到端管线：parsePdf → normalize → writePaper
  plugin.js     # (Step 3) durable host 插件：/paper-hl/read + /write + /profile + /init + /apply + /save 路由
  profile.js    # (v0.3) 画像四层：ensureProfile / buildProfileSummary / applyProposal / applyProfileUpdate 纯逻辑
  tools.js      # (Step 2 + Phase 3/4) agent 工具：parse_pdf / read_highlights / write_highlights / list_sections / read_section / summarize_section_diff / read_profile / confirm_proposal
  tools-plugin.mjs # (Step 2) 工具行 ESM 包装（allTools() 自动注册全部工具）
  diff.js       # (Phase 4) 审查差异分析纯函数：classifySpanChange / summarizeDiff（计数+接受率+样例）
client/
  client.js     # (Step 3) durable client bundle：conversation.view「论文」tab 渲染 + 高亮层 + 画像/提案面板
  render-body.js# 渲染逻辑单一来源（gen-client.js 由它生成 bundle 与动态半）
scripts/
  gen-client.js # 生成 client/client.js 与 dynamic/client-half.js
  seed-demo.js  # 种子演示 spans（幂等，store 同路径）
  verify-http.js # 三条通路自检（首页 / client bundle / /paper-hl/read）
  simulate-render.js # 无浏览器渲染模拟：React/DOM shim 执行已发布 bundle，走真实 3081 数据通路断言渲染树（含冷启动引导 / 画像面板 / 提案面板交互）
  step4-e2e.js  # Step 4 端到端验收驱动：3081 上 session.create(默认 paper preset) → prompt Agent 跑真实管线 → 轮询至空闲 → 汇总 + /paper-hl/read 判定
  step5-acceptance.js # Step 5 收尾抽样：真实数据锚点契约(md_offset/阅读序) + highlights 校验 + 正文过滤抽查 + v0.1 验收判定
  step6-e2e.js  # v0.2 端到端：global-read → propose → GUI 模拟审查 → reflect → reflections.json（PASS）
  step7-multi-paper.js # (v0.3 Phase 4) 三篇同领域论文收敛验收驱动：propose→审查→reflect→确认全闭环
  profile-stats.js     # (v0.3 Phase 4) 逐篇收敛指标（认可率/修改率曲线 + 判定，--baseline/--final）
  check-host.js # 动态双半体校验（解析门控 + 插件形状）
dynamic/
  host-half.js  # 动态双半插件 host 半（harness.handle 数据源，备用）
  client-half.js# 动态双半插件浏览器半（host.call 数据源，备用）
skills/         # (Phase 3/4) agent 技能：global-read（论文地图+plan，参考画像摘要）/ propose（逐节 + read_profile 摘要注入 + 去重硬规则）/ reflect（summarize_section_diff 差异分析→画像提案→等待确认）
                #   运行时接线：<projectRoot>/.agents/skills → junction → 本目录（DSH skill-filesystem 按 cwd 自动发现）
test/
  run-mock.js   # 离线 mock 验证（无网络）
  run-tools.js  # 工具定义 + 读写往返 + 非法 span 拒绝 + lossless JSON 回归 + append 模式 + list_sections/read_section + summarize_section_diff + duplicates 契约 + read_profile/confirm_proposal（Phase 3/4 + v0.3）
  run-plugin.js # host 插件 /paper-hl 路由回归（read/write/profile/init/apply/save + 负例矩阵）
  run-render.js # 渲染纯函数矩阵（P2-a…e + v0.3 colorLegend/callProfile/面板模型/提案模型）
  run-profile.js# (v0.3) 画像层单测：冷启动/校验/摘要/applyProposal/applyProfileUpdate/confirm 工具矩阵
  run-real.js   # 真实 MinerU 端到端验证（需 MINERU_API）
```

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
node scripts/simulate-render.js   # live 3081，POST/profile 走 mock，真实数据零改动
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
- host 路由：`GET /paper-hl/read[?paperId=]` → `{ok, paperId, paperMd, anchors, highlights, papers}`（`host/plugin.js`）
- client bundle：`client/client.js`（`fetch('/paper-hl/read')`，锚点序渲染 + `<mark>` 高亮 + 图例 + 刷新/选论文）
- 重新生成 bundle：`node scripts/gen-client.js`（改 `client/render-body.js` 后必须重跑）
- paper profile（3081）：`dsh --profile paper --port 3081 --no-open`；数据根目录解析：组合 config `root`（profile patch 已钉 `D:\aa`）→ `PAPER_HL_ROOT` → `process.cwd()`（兜底）；从任意目录重启均不丢数据
