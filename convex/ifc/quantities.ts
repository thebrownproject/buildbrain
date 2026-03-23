"use node";

// ── IFC Quantity Extraction ─────────────────────────────────────────────────
// Extracts quantities from Qto_ property sets (NO geometry fallback in MVP).
// Aggregates totals, by-storey, and by-type breakdowns.
// No Convex actions/mutations — pure library functions.

import * as WebIFC from "web-ifc";
import { QTO_PREFERENCES } from "./types";
import type { QuantityResult } from "./types";
import { getPropertySets } from "./properties";
import { getTypeProduct } from "./properties";
import { getTypeConstant, getElementsByType } from "./parser";
import { buildStoreyLookup } from "./spatial";

/**
 * Extract quantities for all elements of a given IFC type.
 *
 * Uses the QTO_PREFERENCES map to locate the expected Qto set and property
 * names (area, volume). Aggregates results into totals, by-storey, and
 * by-type breakdowns.
 *
 * For stairs, traverses IfcRelAggregates to find IfcStairFlight children.
 * For spaces, falls back from NetFloorArea to GrossFloorArea.
 *
 * @param ifcApi - Initialized IfcAPI instance
 * @param modelId - Model handle
 * @param elementType - IFC class name (e.g., "IfcDoor")
 * @returns Aggregated quantity result
 */
export async function getQuantities(
  ifcApi: WebIFC.IfcAPI,
  modelId: number,
  elementType: string
): Promise<QuantityResult> {
  const prefs = QTO_PREFERENCES[elementType];
  const typeConstant = getTypeConstant(elementType);

  if (!typeConstant) {
    return emptyResult();
  }

  // Build storey lookup for all elements
  const storeyLookup = await buildStoreyLookup(ifcApi, modelId);

  // Get all element IDs for this type
  let elementIds = getElementsByType(ifcApi, modelId, typeConstant);

  // Special case: for IfcStair, also gather IfcStairFlight children
  if (elementType === "IfcStair") {
    const flightIds = await getStairFlightChildren(
      ifcApi,
      modelId,
      elementIds
    );
    // Use flights for quantity extraction (stairs themselves rarely have Qto)
    if (flightIds.length > 0) {
      elementIds = flightIds;
    }
  }

  const result: QuantityResult = {
    totals: { count: elementIds.length, area: null, volume: null },
    byStorey: {},
    byType: {},
    qtoCoverage: 0,
    geometryFallbackCount: 0,
  };

  if (elementIds.length === 0) return result;

  let totalArea = 0;
  let totalVolume = 0;
  let hasAnyArea = false;
  let hasAnyVolume = false;
  let elementsWithQto = 0;

  for (const expressId of elementIds) {
    const { qtos } = await getPropertySets(ifcApi, modelId, expressId);

    // Find the matching Qto set
    const qtoData = prefs
      ? qtos[prefs.qtoSetName]
      : findAnyQtoSet(qtos);

    let area: number | null = null;
    let volume: number | null = null;

    if (qtoData) {
      elementsWithQto++;

      // Extract area
      if (prefs?.areaProp) {
        area = extractNumericQuantity(qtoData, prefs.areaProp);
        // Space special case: fallback NetFloorArea -> GrossFloorArea
        if (area === null && elementType === "IfcSpace") {
          area = extractNumericQuantity(qtoData, "GrossFloorArea");
        }
      }

      // Extract volume
      if (prefs?.volumeProp) {
        volume = extractNumericQuantity(qtoData, prefs.volumeProp);
      }
    } else {
      // Try any Qto_ set as fallback
      const fallbackQto = findAnyQtoSet(qtos);
      if (fallbackQto) {
        elementsWithQto++;
        area = findAreaInQto(fallbackQto);
        volume = findVolumeInQto(fallbackQto);
      }
    }

    if (area !== null) {
      totalArea += area;
      hasAnyArea = true;
    }
    if (volume !== null) {
      totalVolume += volume;
      hasAnyVolume = true;
    }

    // Aggregate by storey
    const storey = storeyLookup.get(expressId) ?? "Unassigned";
    if (!result.byStorey[storey]) {
      result.byStorey[storey] = { count: 0, area: null, volume: null };
    }
    result.byStorey[storey].count++;
    if (area !== null) {
      result.byStorey[storey].area =
        (result.byStorey[storey].area ?? 0) + area;
    }
    if (volume !== null) {
      result.byStorey[storey].volume =
        (result.byStorey[storey].volume ?? 0) + volume;
    }

    // Aggregate by type name
    const { typeName } = await getTypeProduct(ifcApi, modelId, expressId);
    const typeKey = typeName ?? "Untyped";
    if (!result.byType[typeKey]) {
      result.byType[typeKey] = { count: 0, area: null, volume: null };
    }
    result.byType[typeKey].count++;
    if (area !== null) {
      result.byType[typeKey].area =
        (result.byType[typeKey].area ?? 0) + area;
    }
    if (volume !== null) {
      result.byType[typeKey].volume =
        (result.byType[typeKey].volume ?? 0) + volume;
    }
  }

  result.totals.area = hasAnyArea ? totalArea : null;
  result.totals.volume = hasAnyVolume ? totalVolume : null;
  result.qtoCoverage =
    elementIds.length > 0 ? elementsWithQto / elementIds.length : 0;
  // No geometry fallback in MVP
  result.geometryFallbackCount = 0;

  return result;
}

// ── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Traverse IfcRelAggregates to find IfcStairFlight children of stairs.
 * Stairs decompose into flights (and landings) via IfcRelAggregates.
 */
async function getStairFlightChildren(
  ifcApi: WebIFC.IfcAPI,
  modelId: number,
  stairIds: number[]
): Promise<number[]> {
  const flightIds: number[] = [];
  const stairIdSet = new Set(stairIds);

  try {
    const aggregateIds = getElementsByType(
      ifcApi,
      modelId,
      WebIFC.IFCRELAGGREGATES
    );

    for (const relId of aggregateIds) {
      const rel = await ifcApi.properties.getItemProperties(
        modelId,
        relId,
        false
      );
      if (!rel) continue;

      // Check if RelatingObject is one of our stairs
      const relatingObj = rel.RelatingObject;
      const relatingId =
        typeof relatingObj === "object" && relatingObj !== null
          ? (relatingObj as Record<string, unknown>).value
          : relatingObj;

      if (typeof relatingId !== "number" || !stairIdSet.has(relatingId)) {
        continue;
      }

      // Get RelatedObjects (the flights/landings)
      const relatedObjects = rel.RelatedObjects;
      if (Array.isArray(relatedObjects)) {
        for (const obj of relatedObjects) {
          const objId =
            typeof obj === "object" && obj !== null
              ? (obj as Record<string, unknown>).value
              : obj;
          if (typeof objId === "number") {
            flightIds.push(objId);
          }
        }
      }
    }
  } catch {
    // IfcRelAggregates traversal can fail
  }

  return flightIds;
}

/**
 * Find any Qto_ set from the extracted property sets.
 */
function findAnyQtoSet(
  qtos: Record<string, Record<string, unknown>>
): Record<string, unknown> | null {
  for (const [name, data] of Object.entries(qtos)) {
    if (name.startsWith("Qto_") || name.startsWith("BaseQuantities")) {
      return data;
    }
  }
  return null;
}

/**
 * Extract a numeric quantity value from a Qto property set.
 * Handles both direct numbers and { value: number } wrappers.
 */
function extractNumericQuantity(
  qtoData: Record<string, unknown>,
  propName: string
): number | null {
  const val = qtoData[propName];
  if (val === null || val === undefined) return null;
  if (typeof val === "number" && isFinite(val)) return val;
  if (typeof val === "object" && val !== null && "value" in val) {
    const inner = (val as Record<string, unknown>).value;
    if (typeof inner === "number" && isFinite(inner)) return inner;
  }
  return null;
}

/**
 * Search for any area-like property in a Qto set.
 */
function findAreaInQto(
  qtoData: Record<string, unknown>
): number | null {
  const areaKeys = [
    "NetSideArea",
    "NetArea",
    "NetFloorArea",
    "GrossFloorArea",
    "GrossArea",
    "NetSurfaceArea",
    "GrossSurfaceArea",
    "Area",
    "CrossSectionArea",
    "OuterSurfaceArea",
  ];
  for (const key of areaKeys) {
    const val = extractNumericQuantity(qtoData, key);
    if (val !== null) return val;
  }
  return null;
}

/**
 * Search for any volume-like property in a Qto set.
 */
function findVolumeInQto(
  qtoData: Record<string, unknown>
): number | null {
  const volumeKeys = [
    "NetVolume",
    "GrossVolume",
    "Volume",
  ];
  for (const key of volumeKeys) {
    const val = extractNumericQuantity(qtoData, key);
    if (val !== null) return val;
  }
  return null;
}

/**
 * Return an empty quantity result.
 */
function emptyResult(): QuantityResult {
  return {
    totals: { count: 0, area: null, volume: null },
    byStorey: {},
    byType: {},
    qtoCoverage: 0,
    geometryFallbackCount: 0,
  };
}
