"use node";

// ── IFC Property Extraction ─────────────────────────────────────────────────
// Extracts property sets (Pset_*) and quantity sets (Qto_*) from IFC elements
// using the web-ifc Properties helper.
// No Convex actions/mutations — pure library functions.

import * as WebIFC from "web-ifc";
import { extractStringValue, type PropertySets } from "./types";

/**
 * Result of property set extraction, separated into psets and qtos.
 */
export interface PropertySetResult {
  psets: PropertySets;
  qtos: PropertySets;
}

/**
 * Get all property sets for an element, separated into Pset_* and Qto_*.
 *
 * Uses `ifcApi.properties.getPropertySets(modelId, expressId, true)` to get
 * recursively resolved property sets. Cleans up internal "id" keys and
 * separates into standard property sets vs quantity sets.
 *
 * @param ifcApi - Initialized IfcAPI instance
 * @param modelId - Model handle from OpenModel
 * @param expressId - Express ID of the element
 * @returns Separated psets and qtos
 */
export async function getPropertySets(
  ifcApi: WebIFC.IfcAPI,
  modelId: number,
  expressId: number
): Promise<PropertySetResult> {
  const psets: PropertySets = {};
  const qtos: PropertySets = {};

  try {
    const rawSets = await ifcApi.properties.getPropertySets(
      modelId,
      expressId,
      true
    );

    if (!Array.isArray(rawSets)) return { psets, qtos };

    for (const rawSet of rawSets) {
      if (!rawSet || typeof rawSet !== "object") continue;

      const setName = extractStringValue(rawSet.Name);
      if (!setName) continue;

      const setType = rawSet.type;
      const properties: Record<string, unknown> = {};

      // Extract properties from HasProperties (for Pset) or Quantities (for Qto)
      const items =
        rawSet.HasProperties ?? rawSet.Quantities ?? [];

      if (Array.isArray(items)) {
        for (const item of items) {
          if (!item || typeof item !== "object") continue;
          const propName = extractStringValue(item.Name);
          if (!propName) continue;

          const value = extractPropertyValue(item);
          properties[propName] = value;
        }
      }

      // Separate Qto_ sets from Pset_ sets
      if (
        setType === WebIFC.IFCELEMENTQUANTITY ||
        setName.startsWith("Qto_") ||
        setName.startsWith("BaseQuantities")
      ) {
        qtos[setName] = properties;
      } else {
        psets[setName] = properties;
      }
    }
  } catch {
    // Property extraction can fail for malformed elements
  }

  return { psets, qtos };
}

/**
 * Get a single property value from a specific property set.
 *
 * @param ifcApi - Initialized IfcAPI instance
 * @param modelId - Model handle
 * @param expressId - Express ID of the element
 * @param psetName - Property set name (e.g., "Pset_DoorCommon")
 * @param propName - Property name (e.g., "FireRating")
 * @returns The property value, or null if not found
 */
export async function getSingleProperty(
  ifcApi: WebIFC.IfcAPI,
  modelId: number,
  expressId: number,
  psetName: string,
  propName: string
): Promise<unknown> {
  const { psets, qtos } = await getPropertySets(ifcApi, modelId, expressId);
  const allSets = { ...psets, ...qtos };

  const set = allSets[psetName];
  if (!set) return null;

  return set[propName] ?? null;
}

/**
 * Get the type product for an element (e.g., IfcDoorType).
 * Returns the type name string.
 *
 * Uses `ifcApi.properties.getTypeProperties(modelId, expressId, true)`.
 *
 * @returns The type name (e.g., "Single Flush Door 900x2100"), or null
 */
export async function getTypeProduct(
  ifcApi: WebIFC.IfcAPI,
  modelId: number,
  expressId: number
): Promise<{ typeName: string | null; typeExpressId: number | null }> {
  try {
    const typeProps = await ifcApi.properties.getTypeProperties(
      modelId,
      expressId,
      true
    );

    if (!Array.isArray(typeProps) || typeProps.length === 0) {
      return { typeName: null, typeExpressId: null };
    }

    // Use the first type product found
    const typeObj = typeProps[0];
    if (!typeObj || typeof typeObj !== "object") {
      return { typeName: null, typeExpressId: null };
    }

    const typeName = extractStringValue(typeObj.Name);
    const typeExpressId =
      typeof typeObj.expressID === "number" ? typeObj.expressID : null;

    return { typeName, typeExpressId };
  } catch {
    return { typeName: null, typeExpressId: null };
  }
}

// ── Value Extraction Helpers ────────────────────────────────────────────────

/**
 * Extract the value from an IFC property item.
 * Handles IfcPropertySingleValue (NominalValue), quantity values, and enums.
 */
function extractPropertyValue(item: Record<string, unknown>): unknown {
  // IfcPropertySingleValue: NominalValue contains the actual value
  if (item.NominalValue !== undefined && item.NominalValue !== null) {
    return unwrapValue(item.NominalValue);
  }

  // Quantity values: AreaValue, VolumeValue, LengthValue, CountValue, WeightValue
  for (const key of [
    "AreaValue",
    "VolumeValue",
    "LengthValue",
    "CountValue",
    "WeightValue",
    "TimeValue",
  ]) {
    if (item[key] !== undefined && item[key] !== null) {
      return unwrapValue(item[key]);
    }
  }

  // IfcPropertyEnumeratedValue
  if (item.EnumerationValues !== undefined) {
    const enumVals = item.EnumerationValues;
    if (Array.isArray(enumVals)) {
      return enumVals.map((v) => unwrapValue(v)).join(", ");
    }
    return unwrapValue(enumVals);
  }

  return null;
}

/**
 * Unwrap an IFC value wrapper to get the raw value.
 * IFC values are often wrapped as { type: X, value: Y }.
 */
function unwrapValue(val: unknown): unknown {
  if (val === null || val === undefined) return null;
  if (typeof val !== "object") return val;

  const obj = val as Record<string, unknown>;

  // web-ifc wraps values as { type: N, value: X }
  if ("value" in obj) {
    const inner = obj.value;
    // Boolean values: .UNKNOWN. / .TRUE. / .FALSE.
    if (typeof inner === "string") {
      if (inner === ".T." || inner === ".TRUE.") return true;
      if (inner === ".F." || inner === ".FALSE.") return false;
      if (inner === ".UNKNOWN.") return null;
      // Strip enum dots: .SINGLE_SWING_LEFT. -> SINGLE_SWING_LEFT
      if (inner.startsWith(".") && inner.endsWith(".")) {
        return inner.slice(1, -1);
      }
    }
    return inner;
  }

  return val;
}

// extractStringValue imported from ./types
