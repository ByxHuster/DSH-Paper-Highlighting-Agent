# paper-highlight (v0.2 ✅)

论文多色高亮 Agent 的宿主插件包（host 逻辑 + client bundle + agent 工具 + 技能）。

> v0.1（管线打通）2026-08-26 验收通过；**v0.2（审查闭环）2026-08-27 验收通过**：两遍阅读/逐节 propose/审查反思三技能（`paper-hl-global-read` / `paper-hl-propose` / `paper-hl-reflect`）+ GUI 审查交互（操作条/新增/改范围/节完成信号）+ 差异分析工具（`summarize_section_diff`）+ 去重硬规则（duplicates append-only），`step6-e2e.js` 端到端跑通「propose → 审查 → 反思 → reflections.json」并归档 `v0.2.0`。验收记录见 `D:\aa\docs\paper-highlight-progress-v0.2.md`。

## 布局

```
host/
  schema.js     # anchors / paper.highlights.json 数据模型与校验（设计 §4.1/§4.2）
  store.js      # data/<paper_id> 读写（paper.md / anchors.json / meta.json / highlights）
  mineru.js     # MinerU 云 API 客户端：上传 → 建任务 → 轮询 → 下载 zip
  normalize.js  # MinerU zip → paper.md + anchors.json + meta.json（正文过滤 + 锚点）
  pipeline.js   # 端到端管线：parsePdf → normalize → writePaper
  plugin.js     # (Step 3) durable host 插件：/paper-hl/read webserver 路由
  tools.js      # (Step 2 + Phase 3/4) agent 工具：parse_pdf / read_highlights / write_highlights / list_sections / read_section / summarize_section_diff
  tools-plugin.mjs # (Step 2) 工具行 ESM 包装（allTools() 自动注册全部工具）
  diff.js       # (Phase 4) 审查差异分析纯函数：classifySpanChange / summarizeDiff（计数+接受率+样例）
client/
  client.js     # (Step 3) durable client bundle：conversation.view「论文」tab 渲染 + 高亮层
  render-body.js# 渲染逻辑单一来源（gen-client.js 由它生成 bundle 与动态半）
scripts/
  gen-client.js # 生成 client/client.js 与 dynamic/client-half.js
  seed-demo.js  # 种子演示 spans（幂等，store 同路径）
  verify-http.js # 三条通路自检（首页 / client bundle / /paper-hl/read）
  simulate-render.js # 无浏览器渲染模拟：React/DOM shim 执行已发布 bundle，走真实 3081 数据通路断言渲染树（mark 数数据驱动）
  step4-e2e.js  # Step 4 端到端验收驱动：3081 上 session.create(默认 paper preset) → prompt Agent 跑真实管线 → 轮询至空闲 → 汇总 + /paper-hl/read 判定
  step5-acceptance.js # Step 5 收尾抽样：真实数据锚点契约(md_offset/阅读序) + highlights 校验 + 正文过滤抽查 + v0.1 验收判定
  check-host.js # 动态双半体校验（解析门控 + 插件形状）
dynamic/
  host-half.js  # 动态双半插件 host 半（harness.handle 数据源，备用）
  client-half.js# 动态双半插件浏览器半（host.call 数据源，备用）
skills/         # (Phase 3/4) agent 技能：global-read（论文地图+plan）/ propose（逐节 + 去重硬规则）/ reflect（summarize_section_diff 差异分析→画像提案）
                #   运行时接线：<projectRoot>/.agents/skills → junction → 本目录（DSH skill-filesystem 按 cwd 自动发现）
test/
  run-mock.js   # 离线 mock 验证（无网络）
  run-tools.js  # 工具定义 + 读写往返 + 非法 span 拒绝 + lossless JSON 回归 + append 模式 + list_sections/read_section + summarize_section_diff + duplicates 契约（Phase 3/4）
  run-plugin.js # host 插件 /paper-hl 路由回归（config.root 与 cwd 无关、404/500 JSON 行为）
  run-real.js   # 真实 MinerU 端到端验证（需 MINERU_API）
```

## 配置

- `MINERU_API`（或 `MinerU_API`）：MinerU API key
- `MINERU_BASE_URL`：默认 `https://mineru.net`
- `MINERU_UPLOAD_MODE=file|url`：上传方式（file = `POST /api/v4/file-urls/batch` 预签名上传，默认；url = `POST /api/v4/extract/task` 公开 URL）
- `MINERU_OCR=1`：强制 OCR；`MINERU_FORMULA=1`：启用公式识别；`MINERU_LANGUAGE=en`
- 数据根目录解析顺序（host/plugin.js）：组合 config `root`（paper profile patch 已钉 `D:\aa`）→ 环境变量 `PAPER_HL_ROOT` → `process.cwd()`（仅兜底；曾因从用户主目录重启 3081 导致 `scandir C:\Users\eyx\data` → 500）

## 测试

```powershell
$env:NODE_PATH = 'C:\Users\eyx\.dsh\profiles\node_modules'   # fflate 解析
node test/run-mock.js
node test/run-tools.js
node test/run-plugin.js
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
