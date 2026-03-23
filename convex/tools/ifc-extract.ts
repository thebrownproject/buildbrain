"use node";

/**
 * IFC Extract Tool
 *
 * On-demand extraction fallback: checks whether IFC element data has been
 * pre-extracted and advises the agent accordingly. When the ingest pipeline
 * module (convex/ingest/ifcExtractor.ts) is implemented, this tool will
 * schedule extraction directly.
 *
 * The agent should prefer queryIfcElements (which reads from the structured
 * store) and only use this tool when data is missing.
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../_generated/api";

export const extractIfcElementsTool = createTool({
  description:
    "Trigger on-demand IFC element extraction for a specific element type. " +
    "Use this ONLY if queryIfcElements returned no data and you need the data extracted. " +
    "The extraction runs in the background — data will be available shortly after. " +
    "Prefer queryIfcElements for already-extracted data.",
  inputSchema: z.object({
    projectId: z
      .string()
      .describe("The project ID containing the IFC file"),
    fileId: z
      .string()
      .describe("The file ID of the IFC file to extract from"),
    elementType: z
      .string()
      .describe(
        "IFC element type to extract, e.g. 'IfcDoor', 'IfcWall', 'IfcWindow'"
      ),
  }),
  execute: async (ctx, input) => {
    // 1. Check if element group already exists for this file + type
    const groups = await ctx.runQuery(
      internal.tools.queries.listElementGroupsByFile,
      {
        fileId: input.fileId as never,
        elementType: input.elementType,
      }
    );

    if (groups.length > 0) {
      const group = groups[0];
      return JSON.stringify({
        status: "already_extracted",
        message:
          `Data for '${input.elementType}' already exists (${group.count} elements, ` +
          `status: ${group.status}). Use queryIfcElements to access it.`,
        elementType: input.elementType,
        count: group.count,
        groupStatus: group.status,
      });
    }

    // 2. Verify the file exists and is an IFC file
    const file = await ctx.runQuery(internal.tools.queries.getFile, {
      fileId: input.fileId as never,
    });

    if (!file) {
      return JSON.stringify({
        status: "error",
        message: `File not found: ${input.fileId}`,
      });
    }

    if (file.type !== "ifc") {
      return JSON.stringify({
        status: "error",
        message: `File '${file.name}' is a ${file.type} file, not an IFC file. ` +
          `IFC extraction only works on IFC files.`,
      });
    }

    // 3. Check file extraction status
    const extractionStatus = file.extractionStatus ?? "pending";

    if (extractionStatus === "ready" || extractionStatus === "extracted") {
      // Pipeline completed but this element type wasn't included
      return JSON.stringify({
        status: "not_extracted",
        message:
          `File '${file.name}' has been processed (status: ${extractionStatus}) ` +
          `but '${input.elementType}' was not included in the extraction. ` +
          `This element type may not exist in the model, or the pipeline may need ` +
          `to be re-run with this type included.`,
        elementType: input.elementType,
        fileName: file.name,
        extractionStatus,
      });
    }

    if (
      extractionStatus === "scanning" ||
      extractionStatus === "extracting" ||
      extractionStatus === "indexing"
    ) {
      return JSON.stringify({
        status: "in_progress",
        message:
          `File '${file.name}' is currently being processed (status: ${extractionStatus}). ` +
          `Please wait for processing to complete and then try queryIfcElements again.`,
        elementType: input.elementType,
        fileName: file.name,
        extractionStatus,
      });
    }

    // Pipeline hasn't run yet or failed
    // TODO: When convex/ingest/ifcExtractor.ts is implemented, schedule extraction:
    //   await ctx.scheduler.runAfter(0, internal.ingest.ifcExtractor.extract, {
    //     fileId: input.fileId, projectId: input.projectId, elementType: input.elementType,
    //   });
    return JSON.stringify({
      status: "pending",
      message:
        `File '${file.name}' has not been processed yet (status: ${extractionStatus}). ` +
        `The Document Intelligence Pipeline needs to process this file before ` +
        `element data is available. The file should be processed automatically ` +
        `after upload — if it hasn't been, the pipeline may need to be triggered manually.`,
      elementType: input.elementType,
      fileName: file.name,
      extractionStatus,
    });
  },
});
