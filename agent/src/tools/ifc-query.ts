import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { resolve } from "node:path";
import { config } from "../config.js";
import { runTool, truncateResult } from "../tool-runner.js";

export const ifcQueryTool: ToolDefinition = {
  name: "ifc_query",
  label: "IFC Query",
  description: `Inspect and query IFC building models. Modes:
- summary: Model overview (schema, element counts, spatial hierarchy, materials)
- type <type>: List elements of a type (supports shorthands: wall, door, window, etc.)
- element <name_or_guid> [--properties]: Look up a single element by name or GlobalId
- storey <name> [--elements]: Show storey info, optionally list all elements in it`,
  parameters: Type.Object({
    model: Type.String({ description: "Path to IFC file" }),
    mode: Type.Union([
      Type.Literal("summary"),
      Type.Literal("type"),
      Type.Literal("element"),
      Type.Literal("storey"),
    ], { description: "Query mode" }),
    target: Type.Optional(Type.String({ description: "Type name, element name/guid, or storey name" })),
    properties: Type.Optional(Type.Boolean({ description: "Show full properties for element mode" })),
    elements: Type.Optional(Type.Boolean({ description: "List elements in storey mode" })),
    compact: Type.Optional(Type.Boolean({ description: "Compact JSON output" })),
  }),
  async execute(toolCallId, params) {
    const script = resolve(config.buildkitToolsDir, "ifc_query.py");
    const args: string[] = ["--model", params.model];

    switch (params.mode) {
      case "summary":
        args.push("--summary");
        break;
      case "type":
        if (params.target) args.push("--type", params.target);
        break;
      case "element":
        if (params.target) args.push("--element", params.target);
        if (params.properties) args.push("--properties");
        break;
      case "storey":
        if (params.target) args.push("--storey", params.target);
        if (params.elements) args.push("--elements");
        break;
    }
    if (params.compact) args.push("--compact");

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
