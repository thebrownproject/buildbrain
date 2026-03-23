"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";

/**
 * Public test runner for the web-ifc spike.
 *
 * Usage from CLI:
 *   npx convex run spikes/runIfcSpike:run
 *   npx convex run spikes/runIfcSpike:run '{"storageId": "k1234..."}'
 *
 * If no storageId is provided, it scans the files table for the first
 * IFC file and uses its storageId.
 */
export const run = action({
  args: {
    storageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    let storageId = args.storageId;

    if (!storageId) {
      // Find the first IFC file in the files table
      const files: Array<{
        storageId: string;
        name: string;
        type: string;
      }> = await ctx.runQuery(internal.spikes.ifcSpikeHelpers.listIfcFiles, {});

      if (files.length === 0) {
        return {
          success: false,
          error:
            "No IFC files found in storage. Upload an IFC file first, then re-run this spike test.",
          hint: "Use the BuildBrain UI to upload a .ifc file, or manually upload via `npx convex storage upload <file>`.",
        };
      }

      // Use the first IFC file's storageId
      const firstFile = files[0];
      storageId = firstFile.storageId as typeof storageId;
      console.log(
        `[runIfcSpike] Using IFC file: "${firstFile.name}" (storageId: ${storageId})`
      );
    }

    // Run the spike test
    console.log(`[runIfcSpike] Starting spike test with storageId: ${storageId}`);
    const result: Record<string, unknown> = await ctx.runAction(
      internal.spikes.ifcSpike.run,
      { storageId: storageId! }
    );

    console.log(
      `[runIfcSpike] Spike test ${result.success ? "PASSED" : "FAILED"}`
    );
    return result;
  },
});
