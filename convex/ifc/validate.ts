"use node";

// ── IFC Data Quality Validation ─────────────────────────────────────────────
// Checks IFC models for common data quality issues: missing property sets,
// proxy elements, orphaned elements, and Qto coverage.
// No Convex actions/mutations — pure library functions.

import * as WebIFC from "web-ifc";
import type { ValidationResult, ValidationIssue } from "./types";
import { getElementsByType, getTypeConstant } from "./parser";
import { getPropertySets } from "./properties";
import { buildStoreyLookup } from "./spatial";

// ── Expected Property Sets ──────────────────────────────────────────────────
// Maps element types to their expected common property sets per IFC standard.

const EXPECTED_PSETS: Record<string, string> = {
  IfcDoor: "Pset_DoorCommon",
  IfcWindow: "Pset_WindowCommon",
  IfcWall: "Pset_WallCommon",
  IfcSlab: "Pset_SlabCommon",
  IfcBeam: "Pset_BeamCommon",
  IfcColumn: "Pset_ColumnCommon",
  IfcRoof: "Pset_RoofCommon",
  IfcStair: "Pset_StairCommon",
  IfcStairFlight: "Pset_StairFlightCommon",
  IfcRailing: "Pset_RailingCommon",
  IfcCovering: "Pset_CoveringCommon",
  IfcSpace: "Pset_SpaceCommon",
};

// Element types to validate (excludes proxy, which is checked separately)
const VALIDATE_TYPES = [
  "IfcWall",
  "IfcDoor",
  "IfcWindow",
  "IfcSlab",
  "IfcBeam",
  "IfcColumn",
  "IfcRoof",
  "IfcStair",
  "IfcStairFlight",
  "IfcRailing",
  "IfcCovering",
];

/**
 * Run all data quality checks on an IFC model.
 *
 * Checks:
 * 1. Missing property sets per element type (e.g., IfcDoor should have Pset_DoorCommon)
 * 2. Proxy elements (IfcBuildingElementProxy count — indicates unclassified geometry)
 * 3. Elements not assigned to any storey (orphaned)
 * 4. Qto coverage per element type (elements with vs without Qto_ sets)
 *
 * @returns ValidationResult with issues array and completeness scores
 */
export async function validateModel(
  ifcApi: WebIFC.IfcAPI,
  modelId: number
): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];
  const completeness: Record<
    string,
    { total: number; withPset: number; score: number }
  > = {};

  // Build storey lookup once for orphan check
  const storeyLookup = await buildStoreyLookup(ifcApi, modelId);

  // ── Check 1: Missing property sets per element type ───────────────
  for (const elementType of VALIDATE_TYPES) {
    const typeConstant = getTypeConstant(elementType);
    if (!typeConstant) continue;

    const elementIds = getElementsByType(ifcApi, modelId, typeConstant);
    if (elementIds.length === 0) continue;

    const expectedPset = EXPECTED_PSETS[elementType];
    if (!expectedPset) continue;

    let withPset = 0;
    let withQto = 0;
    const missingPsetGuids: string[] = [];
    const orphanedGuids: string[] = [];

    for (const expressId of elementIds) {
      const { psets, qtos } = await getPropertySets(
        ifcApi,
        modelId,
        expressId
      );

      // Check for expected pset
      if (psets[expectedPset]) {
        withPset++;
      } else {
        // Get the GUID for reporting
        const guid = await getElementGuid(ifcApi, modelId, expressId);
        if (guid) missingPsetGuids.push(guid);
      }

      // Check for any Qto set
      const hasQto = Object.keys(qtos).some(
        (k) => k.startsWith("Qto_") || k.startsWith("BaseQuantities")
      );
      if (hasQto) withQto++;

      // Check 3: orphaned elements (no storey assignment)
      if (!storeyLookup.has(expressId)) {
        const guid = await getElementGuid(ifcApi, modelId, expressId);
        if (guid) orphanedGuids.push(guid);
      }
    }

    // Record completeness score
    const score =
      elementIds.length > 0 ? withPset / elementIds.length : 1;
    completeness[elementType] = {
      total: elementIds.length,
      withPset,
      score,
    };

    // Issue: missing property sets
    if (missingPsetGuids.length > 0) {
      const severity =
        missingPsetGuids.length > elementIds.length * 0.5
          ? "warning"
          : "info";
      issues.push({
        severity,
        type: "missing_pset",
        message: `${missingPsetGuids.length} of ${elementIds.length} ${elementType} elements missing ${expectedPset}`,
        affectedCount: missingPsetGuids.length,
        elementType,
        elements: missingPsetGuids.slice(0, 20), // Cap at 20 for readability
      });
    }

    // Issue: missing Qto sets
    const missingQtoCount = elementIds.length - withQto;
    if (missingQtoCount > 0) {
      issues.push({
        severity: "info",
        type: "missing_qto",
        message: `${missingQtoCount} of ${elementIds.length} ${elementType} elements have no Qto property set — quantities unavailable without geometry fallback`,
        affectedCount: missingQtoCount,
        elementType,
      });
    }

    // Issue: orphaned elements
    if (orphanedGuids.length > 0) {
      issues.push({
        severity: "warning",
        type: "orphaned_element",
        message: `${orphanedGuids.length} ${elementType} elements not assigned to any storey`,
        affectedCount: orphanedGuids.length,
        elementType,
        elements: orphanedGuids.slice(0, 20),
      });
    }
  }

  // ── Check 2: Proxy elements ───────────────────────────────────────
  const proxyConstant = getTypeConstant("IfcBuildingElementProxy");
  if (proxyConstant) {
    const proxyIds = getElementsByType(ifcApi, modelId, proxyConstant);
    if (proxyIds.length > 0) {
      const severity = proxyIds.length > 10 ? "warning" : "info";
      issues.push({
        severity,
        type: "proxy_elements",
        message: `${proxyIds.length} IfcBuildingElementProxy elements found — these represent unclassified geometry that should be properly typed`,
        affectedCount: proxyIds.length,
        elementType: "IfcBuildingElementProxy",
      });
    }
  }

  return { issues, completeness };
}

// ── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Get the GlobalId (GUID) of an IFC element.
 */
async function getElementGuid(
  ifcApi: WebIFC.IfcAPI,
  modelId: number,
  expressId: number
): Promise<string | null> {
  try {
    const props = await ifcApi.properties.getItemProperties(
      modelId,
      expressId,
      false
    );
    if (!props) return null;

    const guid = props.GlobalId;
    if (typeof guid === "string") return guid;
    if (
      typeof guid === "object" &&
      guid !== null &&
      "value" in guid
    ) {
      const v = (guid as Record<string, unknown>).value;
      return typeof v === "string" ? v : null;
    }
  } catch {
    // Property lookup can fail
  }
  return null;
}
