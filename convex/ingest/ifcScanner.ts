"use node";

// ── IFC Scanner — Phase 0: Manifest Generation ────────────────────────────
// Fast scan of IFC file to produce a manifest: element counts, storey names,
// schema version. The manifest gives the agent instant orientation about the
// file's contents without deep extraction.

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  initIfcApi,
  openModel,
  closeModel,
  getElementsByType,
  getModelInfo,
  getTypeConstant,
  EXTRACTABLE_ELEMENT_TYPES,
} from "../ifc/parser";
import { getStoreyNames } from "../ifc/spatial";
import type { IFCManifest } from "../ifc/types";

/**
 * Phase 0: IFC manifest generation.
 *
 * Fast scan that:
 *   1. Downloads the IFC file from Convex storage
 *   2. Opens it with web-ifc WASM
 *   3. Counts elements by type
 *   4. Lists storey names
 *   5. Gets schema version
 *   6. Builds and stores an IFCManifest
 *   7. Schedules Phase 1 deep extraction
 *
 * Target: <5 seconds for typical construction models.
 */
export const scan = internalAction({
  args: {
    fileId: v.id("files"),
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();
    let ifcApi = null;
    let modelId: number | null = null;

    try {
      // Get file record to access storageId
      const file = await ctx.runQuery(internal.ingest.pipeline.getFile, {
        fileId: args.fileId,
      });

      // Download file from Convex storage
      const blob = await ctx.storage.get(file.storageId);
      if (!blob) {
        throw new Error("File not found in storage");
      }
      const arrayBuffer = await blob.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);

      // Init web-ifc and open model
      ifcApi = await initIfcApi();
      modelId = openModel(ifcApi, data);

      // Get schema and project name
      const { schema } = await getModelInfo(ifcApi, modelId);

      // Count elements by type
      const elementCounts: Record<string, number> = {};

      for (const typeName of EXTRACTABLE_ELEMENT_TYPES) {
        const typeConstant = getTypeConstant(typeName);
        if (typeConstant === null) continue;

        const ids = getElementsByType(ifcApi, modelId, typeConstant);
        if (ids.length > 0) {
          elementCounts[typeName] = ids.length;
        }
      }

      // Get storey names
      const storeys = await getStoreyNames(ifcApi, modelId);

      // Build manifest
      const parseTimeMs = Date.now() - startTime;
      const manifest: IFCManifest = {
        fileName: file.name,
        schema,
        fileSizeMb: Math.round((file.sizeBytes / (1024 * 1024)) * 100) / 100,
        storeys,
        elementCounts,
        psetCoverage: 0, // Will be computed during Phase 1
        qtoCoverage: 0,  // Will be computed during Phase 1
        parseTimeMs,
      };

      // Clean up web-ifc before mutations
      closeModel(ifcApi, modelId);
      ifcApi = null;
      modelId = null;

      // Update file with manifest and status
      await ctx.runMutation(internal.ingest.pipeline.updateExtractionStatus, {
        fileId: args.fileId,
        status: "scanned",
        manifest,
      });

      // Also update legacy IFC metadata fields for backward compatibility
      await ctx.runMutation(internal.files.updateIfcMeta, {
        fileId: args.fileId,
        ifcSchema: schema,
        elementCounts,
        storeyNames: storeys,
      });

      // Schedule Phase 1: deep extraction
      await ctx.scheduler.runAfter(
        0,
        internal.ingest.ifcExtractor.extract,
        { fileId: args.fileId, projectId: args.projectId }
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      await ctx.runMutation(internal.ingest.pipeline.updateExtractionStatus, {
        fileId: args.fileId,
        status: "failed",
        error: `IFC scan failed: ${errorMessage}`,
      });

      throw error;
    } finally {
      if (ifcApi && modelId !== null) {
        try { closeModel(ifcApi, modelId); } catch { /* ignore cleanup errors */ }
      }
    }
  },
});
