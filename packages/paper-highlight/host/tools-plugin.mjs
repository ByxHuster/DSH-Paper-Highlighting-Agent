/**
 * paper-highlight · agent tool plugin (ESM wrapper over host/tools.js)
 *
 * Preset row: `paper-highlight/tools-plugin`. Registers parse_pdf,
 * read_highlights, and write_highlights into the host `tools` registry with
 * the standard durable-tool shape (defineTool from @deepseek-ai/dsh-tools).
 */

import { createRequire } from "node:module"
import { defineTool } from "@deepseek-ai/dsh-tools"

const require = createRequire(import.meta.url)
const { allTools } = require("./tools.js")

const name = "paper-highlight-tools"
const inject = ["tools"]

function apply(ctx) {
  for (const def of allTools()) {
    ctx.tools.register(defineTool(def))
  }
}

export { apply, inject, name }
