import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { resolve } from "node:path";
import { config } from "../config.js";
import { runTool } from "../tool-runner.js";

export const ifcCreateTool: ToolDefinition = {
  name: "ifc_create",
  label: "IFC Create",
  description: `Create a new IFC4 building model with spatial hierarchy.
Outputs a new .ifc file with Project, Site, Building, and Storeys.
Storey format: "Name:elevation_mm:height_mm" (comma-separated for multiple).`,
  parameters: Type.Object({
    output: Type.String({ description: "Output IFC filename" }),
    project: Type.Optional(Type.String({ description: "Project name (default: 'Project')" })),
    site: Type.Optional(Type.String({ description: "Site name (default: 'Site')" })),
    building: Type.Optional(Type.String({ description: "Building name (default: 'Building')" })),
    storeys: Type.Optional(Type.String({ description: "Comma-separated storeys: 'Ground Floor:0:2700,First Floor:2700:2700'" })),
  }),
  async execute(toolCallId, params) {
    const script = resolve(config.buildkitToolsDir, "ifc_create.py");
    const args: string[] = ["--output", params.output];

    if (params.project) args.push("--project", params.project);
    if (params.site) args.push("--site", params.site);
    if (params.building) args.push("--building", params.building);
    if (params.storeys) args.push("--storeys", params.storeys);

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
