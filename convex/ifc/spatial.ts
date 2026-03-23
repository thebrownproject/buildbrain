"use node";

// ── IFC Spatial Hierarchy ───────────────────────────────────────────────────
// Extracts storey names and builds element-to-storey lookup caches
// using the web-ifc spatial structure and containment relations.
// No Convex actions/mutations — pure library functions.

import * as WebIFC from "web-ifc";
import { getElementsByType } from "./parser";

/**
 * Node in the IFC spatial structure tree.
 */
interface SpatialNode {
  expressID: number;
  type: string;
  Name?: { value: string } | string;
  children?: SpatialNode[];
}

/**
 * Get the full spatial structure of the model.
 *
 * Uses `ifcApi.properties.getSpatialStructure(modelId, false)` to get
 * the spatial hierarchy without property details (faster).
 * Walks the tree to extract storey information.
 *
 * @returns The spatial tree root node
 */
export async function getSpatialStructure(
  ifcApi: WebIFC.IfcAPI,
  modelId: number
): Promise<SpatialNode | null> {
  try {
    const structure = await ifcApi.properties.getSpatialStructure(
      modelId,
      false
    );
    return structure as SpatialNode | null;
  } catch {
    return null;
  }
}

/**
 * Get all storey names from the model.
 *
 * @returns Array of storey name strings, in order found in the spatial tree.
 */
export async function getStoreyNames(
  ifcApi: WebIFC.IfcAPI,
  modelId: number
): Promise<string[]> {
  const structure = await getSpatialStructure(ifcApi, modelId);
  if (!structure) return [];

  const storeys: string[] = [];
  walkForStoreys(structure, storeys);
  return storeys;
}

/**
 * Get the storey name that contains a specific element.
 *
 * Traverses IfcRelContainedInSpatialStructure relationships to find
 * the containing IfcBuildingStorey.
 *
 * @param expressId - Express ID of the element to look up
 * @returns Storey name string, or null if not assigned to any storey
 */
export async function getStoreyName(
  ifcApi: WebIFC.IfcAPI,
  modelId: number,
  expressId: number
): Promise<string | null> {
  try {
    const containmentIds = getElementsByType(
      ifcApi,
      modelId,
      WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE
    );

    for (const relId of containmentIds) {
      const rel = await ifcApi.properties.getItemProperties(
        modelId,
        relId,
        false
      );
      if (!rel) continue;

      // Check if our element is in RelatedElements
      const relatedElements = rel.RelatedElements;
      if (!Array.isArray(relatedElements)) continue;

      let found = false;
      for (const elem of relatedElements) {
        const elemId = extractExpressId(elem);
        if (elemId === expressId) {
          found = true;
          break;
        }
      }

      if (!found) continue;

      // Get the RelatingStructure (should be a storey)
      const relatingStructure = rel.RelatingStructure;
      const structureId = extractExpressId(relatingStructure);
      if (structureId === null) continue;

      // Get the storey properties to find its name
      const storeyProps = await ifcApi.properties.getItemProperties(
        modelId,
        structureId,
        false
      );
      if (!storeyProps) continue;

      return extractNameValue(storeyProps.Name);
    }
  } catch {
    // Containment traversal can fail
  }

  return null;
}

/**
 * Build a lookup cache mapping element expressId to storey name.
 *
 * Traverses all IfcRelContainedInSpatialStructure relations once and
 * builds a Map for O(1) lookups. This avoids repeated traversal when
 * processing many elements.
 *
 * @returns Map of expressId -> storey name
 */
export async function buildStoreyLookup(
  ifcApi: WebIFC.IfcAPI,
  modelId: number
): Promise<Map<number, string>> {
  const lookup = new Map<number, string>();

  try {
    const containmentIds = getElementsByType(
      ifcApi,
      modelId,
      WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE
    );

    // First, build a cache of storey express IDs to names
    const storeyNameCache = new Map<number, string>();

    for (const relId of containmentIds) {
      const rel = await ifcApi.properties.getItemProperties(
        modelId,
        relId,
        false
      );
      if (!rel) continue;

      // Get the containing structure (storey)
      const relatingStructure = rel.RelatingStructure;
      const structureId = extractExpressId(relatingStructure);
      if (structureId === null) continue;

      // Resolve storey name (cached)
      let storeyName = storeyNameCache.get(structureId);
      if (storeyName === undefined) {
        const storeyProps = await ifcApi.properties.getItemProperties(
          modelId,
          structureId,
          false
        );
        storeyName = storeyProps
          ? extractNameValue(storeyProps.Name) ?? "Unknown Storey"
          : "Unknown Storey";
        storeyNameCache.set(structureId, storeyName);
      }

      // Map all related elements to this storey
      const relatedElements = rel.RelatedElements;
      if (Array.isArray(relatedElements)) {
        for (const elem of relatedElements) {
          const elemId = extractExpressId(elem);
          if (elemId !== null) {
            lookup.set(elemId, storeyName);
          }
        }
      }
    }
  } catch {
    // Containment traversal can fail on malformed models
  }

  return lookup;
}

// ── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Recursively walk the spatial structure tree to find IfcBuildingStorey nodes.
 */
function walkForStoreys(node: SpatialNode, storeys: string[]): void {
  if (node.type === "IFCBUILDINGSTOREY") {
    const name = extractNameValue(node.Name);
    if (name) {
      storeys.push(name);
    }
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      walkForStoreys(child, storeys);
    }
  }
}

/**
 * Extract an express ID from a value that may be a raw number or a ref object.
 */
function extractExpressId(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "number") return val;
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    if (typeof obj.value === "number") return obj.value;
    if (typeof obj.expressID === "number") return obj.expressID;
  }
  return null;
}

/**
 * Extract a string name from an IFC Name property.
 * Handles both { value: "string" } wrappers and raw strings.
 */
function extractNameValue(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "string") return val || null;
  if (typeof val === "object" && val !== null && "value" in val) {
    const v = (val as Record<string, unknown>).value;
    return typeof v === "string" && v ? v : null;
  }
  return null;
}
