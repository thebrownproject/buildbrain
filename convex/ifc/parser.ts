"use node";

// ── IFC Parser ──────────────────────────────────────────────────────────────
// Core web-ifc lifecycle: init, open, close, query elements.
// No Convex actions/mutations — pure library functions.

import * as WebIFC from "web-ifc";
import { TYPE_SHORTHAND } from "./types";

// ── IFC class name to web-ifc constant mapping ─────────────────────────────
// Maps "IfcDoor" string to the numeric IFCDOOR constant.

const IFC_TYPE_MAP: Record<string, number> = {
  IfcWall: WebIFC.IFCWALL,
  IfcDoor: WebIFC.IFCDOOR,
  IfcWindow: WebIFC.IFCWINDOW,
  IfcBeam: WebIFC.IFCBEAM,
  IfcColumn: WebIFC.IFCCOLUMN,
  IfcSlab: WebIFC.IFCSLAB,
  IfcRoof: WebIFC.IFCROOF,
  IfcStair: WebIFC.IFCSTAIR,
  IfcStairFlight: WebIFC.IFCSTAIRFLIGHT,
  IfcRailing: WebIFC.IFCRAILING,
  IfcCovering: WebIFC.IFCCOVERING,
  IfcBuildingElementProxy: WebIFC.IFCBUILDINGELEMENTPROXY,
  IfcBuildingStorey: WebIFC.IFCBUILDINGSTOREY,
  IfcSpace: WebIFC.IFCSPACE,
};

/**
 * The set of element types we extract by default during deep extraction.
 * Excludes spatial types (IfcBuildingStorey, IfcSpace) which are handled separately.
 */
export const EXTRACTABLE_ELEMENT_TYPES = [
  "IfcWall",
  "IfcDoor",
  "IfcWindow",
  "IfcBeam",
  "IfcColumn",
  "IfcSlab",
  "IfcRoof",
  "IfcStair",
  "IfcStairFlight",
  "IfcRailing",
  "IfcCovering",
  "IfcBuildingElementProxy",
];

/**
 * Initialize the web-ifc API. Must be called before any model operations.
 * Returns the initialized IfcAPI instance.
 */
export async function initIfcApi(): Promise<WebIFC.IfcAPI> {
  const ifcApi = new WebIFC.IfcAPI();
  await ifcApi.Init();
  return ifcApi;
}

/**
 * Open an IFC model from binary data.
 * Uses settings appropriate for server-side extraction (no coordinate origin
 * translation, 400MB memory limit to stay within Convex's 512MB action limit).
 *
 * @returns The model ID for subsequent API calls.
 */
export function openModel(
  ifcApi: WebIFC.IfcAPI,
  data: Uint8Array
): number {
  const settings: WebIFC.LoaderSettings = {
    COORDINATE_TO_ORIGIN: false,
    MEMORY_LIMIT: 400 * 1024 * 1024, // 400MB — leaves headroom within 512MB limit
  };
  return ifcApi.OpenModel(data, settings);
}

/**
 * Close a model and dispose the WASM instance.
 * CRITICAL: Always call this after processing. WASM memory is not garbage-collected.
 */
export function closeModel(
  ifcApi: WebIFC.IfcAPI,
  modelId: number
): void {
  try {
    ifcApi.CloseModel(modelId);
  } catch {
    // CloseModel may fail if model was never fully opened
  }
  try {
    ifcApi.Dispose();
  } catch {
    // Dispose may fail if Init never completed
  }
}

/**
 * Get basic model info: IFC schema version and project name.
 */
export async function getModelInfo(
  ifcApi: WebIFC.IfcAPI,
  modelId: number
): Promise<{ schema: string; projectName: string | null }> {
  const schema = ifcApi.GetModelSchema(modelId) ?? "unknown";

  let projectName: string | null = null;
  try {
    const projectIds = ifcApi.GetLineIDsWithType(
      modelId,
      WebIFC.IFCPROJECT
    );
    if (projectIds.size() > 0) {
      const project = await ifcApi.properties.getItemProperties(
        modelId,
        projectIds.get(0),
        false
      );
      if (project && project.Name) {
        projectName = extractStringValue(project.Name);
      }
    }
  } catch {
    // Some models may not have IfcProject
  }

  return { schema, projectName };
}

/**
 * Get all express IDs of elements with a given IFC type.
 * Converts the web-ifc Vector to a plain number array.
 *
 * @param typeId - The web-ifc numeric type constant (e.g., IFCDOOR)
 * @returns Array of express IDs
 */
export function getElementsByType(
  ifcApi: WebIFC.IfcAPI,
  modelId: number,
  typeId: number
): number[] {
  const vector = ifcApi.GetLineIDsWithType(modelId, typeId);
  const ids: number[] = [];
  for (let i = 0; i < vector.size(); i++) {
    ids.push(vector.get(i));
  }
  return ids;
}

/**
 * Resolve a user-friendly shorthand or IFC class name to the web-ifc constant.
 *
 * Accepts:
 * - Shorthand: "door" -> { ifcClassName: "IfcDoor", typeConstant: 395920057 }
 * - IFC class: "IfcDoor" -> { ifcClassName: "IfcDoor", typeConstant: 395920057 }
 *
 * @returns Object with ifcClassName and typeConstant, or null if not recognized.
 */
export function resolveTypeShorthand(
  input: string
): { ifcClassName: string; typeConstant: number } | null {
  const lower = input.toLowerCase().trim();

  // Check shorthand map first
  const fromShorthand = TYPE_SHORTHAND[lower];
  if (fromShorthand) {
    const constant = IFC_TYPE_MAP[fromShorthand];
    if (constant !== undefined) {
      return { ifcClassName: fromShorthand, typeConstant: constant };
    }
  }

  // Check direct IFC class name (case-insensitive lookup)
  for (const [className, constant] of Object.entries(IFC_TYPE_MAP)) {
    if (className.toLowerCase() === lower) {
      return { ifcClassName: className, typeConstant: constant };
    }
  }

  return null;
}

/**
 * Get the web-ifc numeric type constant from an IFC class name string.
 *
 * @param ifcClassName - e.g., "IfcDoor"
 * @returns The numeric constant (e.g., 395920057 for IFCDOOR), or null if not found.
 */
export function getTypeConstant(ifcClassName: string): number | null {
  return IFC_TYPE_MAP[ifcClassName] ?? null;
}

/**
 * Get the IFC class name from a web-ifc numeric type constant.
 *
 * @param typeConstant - e.g., 395920057 (IFCDOOR)
 * @returns The class name (e.g., "IfcDoor"), or null if not found.
 */
export function getClassName(typeConstant: number): string | null {
  for (const [name, constant] of Object.entries(IFC_TYPE_MAP)) {
    if (constant === typeConstant) {
      return name;
    }
  }
  return null;
}

// ── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Extract a string value from an IFC property value wrapper.
 * Handles both { value: "string" } and raw string formats.
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
