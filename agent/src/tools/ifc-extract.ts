import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { resolve } from "node:path";
import { config } from "../config.js";
import { runTool, truncateResult } from "../tool-runner.js";

export const ifcExtractTool: ToolDefinition = {
  name: "ifc_extract",
  label: "IFC Extract",
  description: `Extract data from IFC building models. Available commands:
- summary: Model overview (element counts, storeys, schema)
- list <type>: All elements of a type with properties, quantities, materials
- props <guid>: Detailed properties for a single element by GlobalId
- query <type> --property Pset.Prop [--value V | --not-null]: Filter elements by property
- quantities <type> [--group-by storey|type]: Pre-computed aggregates (areas, volumes, counts)
- validate: Data quality check (missing property sets, proxy elements)
- export <type> --output file.csv: Export to CSV

Type shorthands: door, wall, window, slab, roof, column, beam, stair, railing, space, covering.
NEVER compute quantities yourself. Always use the quantities command.`,
  parameters: Type.Object({
    file: Type.String({ description: "IFC filename in the project data directory" }),
    command: Type.Union([
      Type.Literal("summary"),
      Type.Literal("list"),
      Type.Literal("props"),
      Type.Literal("query"),
      Type.Literal("quantities"),
      Type.Literal("validate"),
      Type.Literal("export"),
    ], { description: "Extraction command to run" }),
    type: Type.Optional(Type.String({ description: "Element type shorthand: door, wall, window, slab, roof, column, beam, etc." })),
    guid: Type.Optional(Type.String({ description: "Element GlobalId (for props command)" })),
    property: Type.Optional(Type.String({ description: "Property path e.g. Pset_DoorCommon.FireRating (for query)" })),
    value: Type.Optional(Type.String({ description: "Property value to match (for query)" })),
    notNull: Type.Optional(Type.Boolean({ description: "Filter for non-null values (for query)" })),
    groupBy: Type.Optional(Type.Union([Type.Literal("storey"), Type.Literal("type")], { description: "Group quantities by storey or type" })),
    limit: Type.Optional(Type.Number({ description: "Max elements to return" })),
    compact: Type.Optional(Type.Boolean({ description: "Compact output: guid, name, type_name, storey only" })),
  }),
  async execute(toolCallId, params) {
    const script = resolve(config.cliToolsDir, "ifc_extract.py");
    const args: string[] = [params.file, params.command];

    if (params.type) args.push(params.type);
    if (params.guid) args.push(params.guid);
    if (params.property) args.push("--property", params.property);
    if (params.value) args.push("--value", params.value);
    if (params.notNull) args.push("--not-null");
    if (params.groupBy) args.push("--group-by", params.groupBy);
    if (params.limit) args.push("--limit", String(params.limit));
    if (params.compact) args.push("--compact");
    args.push("--save");

    const timeout = params.command === "quantities"
      ? config.quantitiesToolTimeoutMs
      : config.defaultToolTimeoutMs;

    const result = await runTool(script, args, { timeout });

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
