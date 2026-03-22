import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { resolve } from "node:path";
import { config } from "../config.js";
import { runTool, truncateResult } from "../tool-runner.js";

export const pdfExtractTool: ToolDefinition = {
  name: "pdf_extract",
  label: "PDF Extract",
  description: `Extract data from PDF construction drawings. Available commands:
- text [--pages 1-5]: Extract raw text from specified pages
- tables [--pages 12-15]: Extract tables from specified pages
- search "keyword": Find pages containing a keyword
- schedules: Auto-detect door, window, and finish schedules

Page ranges: "1-5", "12", "1,3,5-8" (1-indexed).`,
  parameters: Type.Object({
    file: Type.String({ description: "PDF filename in the project data directory" }),
    command: Type.Union([
      Type.Literal("text"),
      Type.Literal("tables"),
      Type.Literal("search"),
      Type.Literal("schedules"),
    ], { description: "Extraction command to run" }),
    pages: Type.Optional(Type.String({ description: "Page range e.g. '1-5', '12', '1,3,5-8'" })),
    query: Type.Optional(Type.String({ description: "Search keyword (for search command)" })),
  }),
  async execute(toolCallId, params) {
    const script = resolve(config.cliToolsDir, "pdf_extract.py");
    const args: string[] = [params.file, params.command];

    if (params.query && params.command === "search") args.push(params.query);
    if (params.pages) args.push("--pages", params.pages);
    args.push("--save");

    const result = await runTool(script, args);

    if (!result.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        details: { error: true, raw: result },
      };
    }

    const text = truncateResult(result.data, config.maxResultChars);
    return {
      content: [{ type: "text" as const, text }],
      details: { raw: result.data },
    };
  },
};
