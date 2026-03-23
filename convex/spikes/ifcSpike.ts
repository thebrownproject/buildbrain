"use node";

import * as WebIFC from "web-ifc";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";

/**
 * Spike test: validate that web-ifc WASM loads and runs inside a Convex
 * Node.js action (512 MB memory, 10-minute timeout).
 *
 * This action downloads an IFC file from Convex storage, opens it with
 * web-ifc, and extracts doors, property sets, schema, and spatial structure.
 */
export const run = internalAction({
  args: {
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const ifcApi = new WebIFC.IfcAPI();

    try {
      // ── 1. Initialize WASM ───────────────────────────────────────
      await ifcApi.Init();
      console.log("[ifcSpike] WASM initialized");

      // ── 2. Download the IFC file from Convex storage ─────────────
      const blob = await ctx.storage.get(args.storageId);
      if (!blob) {
        return {
          success: false,
          error: `No file found in storage for id: ${args.storageId}`,
        };
      }

      const arrayBuffer = await blob.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);
      console.log(`[ifcSpike] Downloaded IFC file: ${data.byteLength} bytes`);

      // ── 3. Open the model ────────────────────────────────────────
      const modelId = ifcApi.OpenModel(data);
      console.log(`[ifcSpike] Model opened, modelId=${modelId}`);

      // ── 4. Get the model schema (IFC2X3, IFC4, etc.) ────────────
      const schema = ifcApi.GetModelSchema(modelId);
      console.log(`[ifcSpike] Schema: ${schema}`);

      // ── 5. Get all IfcDoor elements ──────────────────────────────
      const doorIds = ifcApi.GetLineIDsWithType(modelId, WebIFC.IFCDOOR);
      const doorCount = doorIds.size();
      console.log(`[ifcSpike] Found ${doorCount} doors`);

      // ── 6. Extract property sets for the first 3 doors ───────────
      const sampleCount = Math.min(3, doorCount);
      const sampleProperties: Array<{
        expressId: number;
        propertySets: unknown;
      }> = [];

      for (let i = 0; i < sampleCount; i++) {
        const expressId = doorIds.get(i);
        const psets = await ifcApi.properties.getPropertySets(
          modelId,
          expressId,
          true
        );
        sampleProperties.push({ expressId, propertySets: psets });
      }
      console.log(
        `[ifcSpike] Extracted property sets for ${sampleCount} doors`
      );

      // ── 7. Get the spatial structure ─────────────────────────────
      const spatialStructure = await ifcApi.properties.getSpatialStructure(
        modelId,
        false
      );

      // Extract storey names from the spatial structure
      const storeyNames: string[] = [];
      function extractStoreys(node: Record<string, unknown>) {
        if (node.type === "IFCBUILDINGSTOREY" && typeof node.Name === "object" && node.Name !== null) {
          const nameObj = node.Name as Record<string, unknown>;
          if (typeof nameObj.value === "string") {
            storeyNames.push(nameObj.value);
          }
        }
        // Walk children recursively
        const children = node.children as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(children)) {
          for (const child of children) {
            extractStoreys(child);
          }
        }
      }

      // The spatial structure is a tree; walk it to find storeys
      if (spatialStructure && typeof spatialStructure === "object") {
        extractStoreys(spatialStructure as unknown as Record<string, unknown>);
      }
      console.log(`[ifcSpike] Found ${storeyNames.length} storeys: ${storeyNames.join(", ")}`);

      // ── 8. Clean up WASM memory ──────────────────────────────────
      ifcApi.CloseModel(modelId);
      ifcApi.Dispose();
      console.log("[ifcSpike] Cleaned up WASM memory");

      return {
        success: true,
        schema,
        doorCount,
        sampleProperties,
        storeyNames,
        spatialStructureSummary: {
          type: (spatialStructure as unknown as Record<string, unknown>)?.type ?? "unknown",
          childCount: Array.isArray(
            (spatialStructure as unknown as Record<string, unknown>)?.children
          )
            ? (
                (spatialStructure as unknown as Record<string, unknown>)
                  .children as unknown[]
              ).length
            : 0,
        },
      };
    } catch (error) {
      // Always try to clean up even on error
      try {
        ifcApi.Dispose();
      } catch {
        // Dispose may fail if Init never completed
      }

      const message =
        error instanceof Error ? error.message : String(error);
      console.error(`[ifcSpike] FAILED: ${message}`);
      return {
        success: false,
        error: message,
      };
    }
  },
});
