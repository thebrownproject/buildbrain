"use node";

// ── IFC Extractor — Phase 1: Deep Extraction ──────────────────────────────
// Full property/material/quantity extraction for all IFC elements.
// Results are stored in elementGroups + elements tables for instant querying.

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  initIfcApi,
  openModel,
  closeModel,
  getElementsByType,
  getTypeConstant,
  EXTRACTABLE_ELEMENT_TYPES,
} from "../ifc/parser";
import { getPropertySets, getTypeProduct } from "../ifc/properties";
import { getMaterialName } from "../ifc/materials";
import { buildStoreyLookup } from "../ifc/spatial";
import type { ElementData } from "../ifc/types";
import type { Id } from "../_generated/dataModel";

/** Maximum elements per batch insert mutation call. */
const BATCH_SIZE = 50;

/**
 * Display name mapping for IFC types.
 */
const DISPLAY_NAMES: Record<string, string> = {
  IfcWall: "Walls",
  IfcDoor: "Doors",
  IfcWindow: "Windows",
  IfcBeam: "Beams",
  IfcColumn: "Columns",
  IfcSlab: "Slabs",
  IfcRoof: "Roofs",
  IfcStair: "Stairs",
  IfcStairFlight: "Stair Flights",
  IfcRailing: "Railings",
  IfcCovering: "Coverings",
  IfcBuildingElementProxy: "Proxies",
};

/**
 * Phase 1: Deep IFC extraction.
 *
 * For each extractable element type:
 *   1. Gets all elements of that type
 *   2. Extracts properties, materials, quantities, storey for each element
 *   3. Creates an elementGroup record
 *   4. Batch-inserts element records (50 per mutation)
 *   5. Marks the group complete
 *
 * Updates the file's extractionStatus to "extracted" on success or "failed" on error.
 */
export const extract = internalAction({
  args: {
    fileId: v.id("files"),
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    let ifcApi = null;
    let modelId: number | null = null;

    try {
      // Update status to extracting
      await ctx.runMutation(internal.ingest.pipeline.updateExtractionStatus, {
        fileId: args.fileId,
        status: "extracting",
      });

      // Delete old extraction data for idempotency
      await ctx.runMutation(internal.ingest.pipeline.deleteOldIfcData, {
        fileId: args.fileId,
      });

      // Get file record
      const file = await ctx.runQuery(internal.ingest.pipeline.getFile, {
        fileId: args.fileId,
      });

      // Download file from storage
      const blob = await ctx.storage.get(file.storageId);
      if (!blob) {
        throw new Error("File not found in storage");
      }
      const arrayBuffer = await blob.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);

      // Init web-ifc and open model
      ifcApi = await initIfcApi();
      modelId = openModel(ifcApi, data);

      // Build storey lookup once for all elements
      const storeyLookup = await buildStoreyLookup(ifcApi, modelId);

      // Track coverage stats for manifest update
      let totalElements = 0;
      let elementsWithPset = 0;
      let elementsWithQto = 0;

      // Process each element type
      for (const elementType of EXTRACTABLE_ELEMENT_TYPES) {
        const typeConstant = getTypeConstant(elementType);
        if (typeConstant === null) continue;

        const expressIds = getElementsByType(ifcApi, modelId, typeConstant);
        if (expressIds.length === 0) continue;

        totalElements += expressIds.length;

        // Determine column order based on element type
        const columnOrder = buildColumnOrder(elementType);

        // Create element group
        const groupId: Id<"elementGroups"> = await ctx.runMutation(
          internal.ingest.pipeline.createElementGroup,
          {
            projectId: args.projectId,
            fileId: args.fileId,
            elementType,
            displayName: DISPLAY_NAMES[elementType] ?? elementType,
            count: expressIds.length,
            columnOrder,
            extractedAt: Date.now(),
          }
        );

        // Extract elements in batches
        let batch: Array<{
          groupId: Id<"elementGroups">;
          projectId: Id<"projects">;
          globalId: string;
          name?: string;
          properties: Record<string, unknown>;
        }> = [];

        for (const expressId of expressIds) {
          const elementData = await extractSingleElement(
            ifcApi!,
            modelId!,
            expressId,
            elementType,
            storeyLookup
          );

          // Track coverage
          if (Object.keys(elementData.properties).length > 0) {
            elementsWithPset++;
          }
          if (Object.keys(elementData.quantities).length > 0) {
            elementsWithQto++;
          }

          // Flatten properties for storage: merge psets, qtos, and metadata
          const flatProperties = flattenElementProperties(elementData);

          batch.push({
            groupId,
            projectId: args.projectId,
            globalId: elementData.guid,
            name: elementData.name ?? undefined,
            properties: flatProperties,
          });

          // Flush batch when it reaches BATCH_SIZE
          if (batch.length >= BATCH_SIZE) {
            await ctx.runMutation(internal.ingest.pipeline.insertElements, {
              elements: batch,
            });
            batch = [];
          }
        }

        // Flush remaining elements
        if (batch.length > 0) {
          await ctx.runMutation(internal.ingest.pipeline.insertElements, {
            elements: batch,
          });
          batch = [];
        }

        // Mark group complete
        await ctx.runMutation(internal.ingest.pipeline.markGroupComplete, {
          groupId,
        });
      }

      // Clean up web-ifc before final mutations
      closeModel(ifcApi, modelId);
      ifcApi = null;
      modelId = null;

      // Compute coverage percentages
      const psetCoverage =
        totalElements > 0
          ? Math.round((elementsWithPset / totalElements) * 100)
          : 0;
      const qtoCoverage =
        totalElements > 0
          ? Math.round((elementsWithQto / totalElements) * 100)
          : 0;

      // Update manifest with coverage stats
      const currentFile = await ctx.runMutation(
        internal.ingest.pipeline.getFile,
        { fileId: args.fileId }
      );
      const updatedManifest = {
        ...(currentFile.manifest ?? {}),
        psetCoverage,
        qtoCoverage,
      };

      // Update status to extracted
      await ctx.runMutation(internal.ingest.pipeline.updateExtractionStatus, {
        fileId: args.fileId,
        status: "extracted",
        manifest: updatedManifest,
      });
    } catch (error) {
      // Clean up on error
      if (ifcApi && modelId !== null) {
        closeModel(ifcApi, modelId);
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      await ctx.runMutation(internal.ingest.pipeline.updateExtractionStatus, {
        fileId: args.fileId,
        status: "failed",
        error: `IFC extraction failed: ${errorMessage}`,
      });
    }
  },
});

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract data for a single IFC element.
 */
async function extractSingleElement(
  ifcApi: import("web-ifc").IfcAPI,
  modelId: number,
  expressId: number,
  elementType: string,
  storeyLookup: Map<number, string>
): Promise<ElementData> {
  // Get basic properties
  let guid = "";
  let name: string | null = null;
  try {
    const itemProps = await ifcApi.properties.getItemProperties(
      modelId,
      expressId,
      false
    );
    if (itemProps) {
      guid = extractStringValue(itemProps.GlobalId) ?? "";
      name = extractStringValue(itemProps.Name);
    }
  } catch {
    // Property lookup can fail for malformed elements
  }

  // Get property sets and quantities
  const { psets, qtos } = await getPropertySets(ifcApi, modelId, expressId);

  // Get type product name
  const { typeName } = await getTypeProduct(ifcApi, modelId, expressId);

  // Get material name
  const material = await getMaterialName(ifcApi, modelId, expressId);

  // Get storey from lookup
  const storey = storeyLookup.get(expressId) ?? null;

  return {
    guid,
    name,
    typeName,
    storey,
    ifcClass: elementType,
    properties: psets,
    quantities: qtos,
    material,
  };
}

/**
 * Flatten element properties into a single-level record for storage.
 *
 * Merges property sets, quantities, and metadata into a flat structure:
 *   - _type: IFC class name
 *   - _typeName: type product name
 *   - _storey: containing storey
 *   - _material: material name(s)
 *   - PsetName.PropName: property value
 *   - QtoName.PropName: quantity value
 */
function flattenElementProperties(
  element: ElementData
): Record<string, unknown> {
  const flat: Record<string, unknown> = {};

  // Metadata
  flat._type = element.ifcClass;
  if (element.typeName) flat._typeName = element.typeName;
  if (element.storey) flat._storey = element.storey;
  if (element.material) flat._material = element.material;

  // Flatten property sets: PsetName.PropName -> value
  for (const [psetName, props] of Object.entries(element.properties)) {
    for (const [propName, value] of Object.entries(props)) {
      flat[`${psetName}.${propName}`] = value;
    }
  }

  // Flatten quantity sets: QtoName.PropName -> value
  for (const [qtoName, props] of Object.entries(element.quantities)) {
    if (typeof props === "object" && props !== null) {
      for (const [propName, value] of Object.entries(
        props as Record<string, unknown>
      )) {
        flat[`${qtoName}.${propName}`] = value;
      }
    }
  }

  return flat;
}

/**
 * Build the column order for an element group display.
 */
function buildColumnOrder(elementType: string): string[] {
  const base = ["Name", "Type", "Storey", "Material"];

  // Add type-specific columns
  switch (elementType) {
    case "IfcDoor":
      return [
        ...base,
        "FireRating",
        "IsExternal",
        "Width",
        "Height",
        "Area",
      ];
    case "IfcWindow":
      return [
        ...base,
        "IsExternal",
        "ThermalTransmittance",
        "Width",
        "Height",
        "Area",
      ];
    case "IfcWall":
      return [...base, "IsExternal", "LoadBearing", "NetSideArea", "NetVolume"];
    case "IfcSlab":
      return [...base, "IsExternal", "LoadBearing", "NetArea", "NetVolume"];
    case "IfcBeam":
    case "IfcColumn":
      return [...base, "LoadBearing", "CrossSectionArea", "NetVolume"];
    default:
      return base;
  }
}

/**
 * Extract a string value from an IFC property wrapper.
 */
function extractStringValue(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "string") return val;
  if (typeof val === "object" && val !== null && "value" in val) {
    const v = (val as Record<string, unknown>).value;
    return typeof v === "string" ? v : v !== null && v !== undefined ? String(v) : null;
  }
  return null;
}
