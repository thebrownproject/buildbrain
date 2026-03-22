import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { resolve } from "node:path";
import { config } from "../config.js";
import { runTool } from "../tool-runner.js";

export const ifcPlaceTool: ToolDefinition = {
  name: "ifc_place",
  label: "IFC Place",
  description: `Place building elements in an existing IFC model.
Currently supports: wall
All dimensions in millimetres. Coordinates as "x,y" pairs.`,
  parameters: Type.Object({
    model: Type.String({ description: "Path to existing IFC file" }),
    element: Type.Union([Type.Literal("wall")], { description: "Element type to place" }),
    name: Type.String({ description: "Element name e.g. 'Wall_North'" }),
    start: Type.String({ description: "Start point 'x,y' in mm e.g. '0,0'" }),
    end: Type.String({ description: "End point 'x,y' in mm e.g. '10000,0'" }),
    height: Type.Number({ description: "Height in mm" }),
    thickness: Type.Number({ description: "Thickness in mm" }),
    storey: Type.String({ description: "Storey name to assign element to" }),
  }),
  async execute(toolCallId, params) {
    const script = resolve(config.buildkitToolsDir, "ifc_place.py");
    const args: string[] = [
      params.element,
      "--model", params.model,
      "--name", params.name,
      "--start", params.start,
      "--end", params.end,
      "--height", String(params.height),
      "--thickness", String(params.thickness),
      "--storey", params.storey,
    ];

    const result = await runTool(script, args);

    if (!result.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        details: { error: true, raw: result },
      };
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result.data, null, 2) }],
      details: { raw: result.data },
    };
  },
};
