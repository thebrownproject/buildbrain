"use node";

/**
 * Cross-Validation Tool
 *
 * The money feature: joins IFC model elements against PDF schedule rows
 * by mark/tag and compares property values. Returns a structured report
 * with PASS/MISMATCH/ABSENT for each property comparison.
 *
 * Data flow:
 *   1. Query elements of the given IFC type
 *   2. Query pdfScheduleRows of the given schedule type
 *   3. Normalize marks and join
 *   4. Compare common properties
 *   5. Return structured discrepancy report
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../_generated/api";

// Maximum elements in the per-element detail section
const MAX_DETAIL_ELEMENTS = 30;
const MAX_RESULT_SIZE = 50_000;

// ── Mark normalization ─────────────────────────────────────────

/**
 * Normalize a mark/tag for matching.
 * "D-01" -> "d01", "D.01" -> "d01", "W-14" -> "w14",
 * "101" -> "101", "D101" -> "d101"
 */
function normalizeMark(mark: string): string {
  return mark
    .toLowerCase()
    .replace(/[-_./\s]/g, "") // Strip separators
    .replace(/^0+/, "") || "0"; // Strip leading zeros, keep at least "0"
}

// ── Property comparison ────────────────────────────────────────

type ComparisonResult = "PASS" | "MISMATCH" | "ABSENT";

interface PropertyComparison {
  property: string;
  ifcValue: string | null;
  pdfValue: string | null;
  result: ComparisonResult;
}

/**
 * Normalize a property value for comparison.
 * Trims whitespace, lowercases, strips common formatting differences.
 */
function normalizeValue(value: unknown): string | null {
  if (value == null || value === "" || value === "-") return null;
  return String(value).trim().toLowerCase();
}

/**
 * Compare a single property between IFC and PDF sources.
 */
function compareProperty(
  ifcRaw: unknown,
  pdfRaw: unknown
): ComparisonResult {
  const ifcVal = normalizeValue(ifcRaw);
  const pdfVal = normalizeValue(pdfRaw);

  if (ifcVal === null && pdfVal === null) return "PASS"; // Both absent is not a mismatch
  if (ifcVal === null || pdfVal === null) return "ABSENT";
  if (ifcVal === pdfVal) return "PASS";

  // Fuzzy match: check if one contains the other (handles "FRL 60/60/60" vs "60/60/60")
  if (ifcVal.includes(pdfVal) || pdfVal.includes(ifcVal)) return "PASS";

  return "MISMATCH";
}

// ── Property mapping ───────────────────────────────────────────

/**
 * Maps between IFC property paths and PDF schedule column names.
 * Keys are schedule types, values map PDF column names to IFC property paths.
 */
const PROPERTY_MAPS: Record<string, Array<{ pdf: string[]; ifc: string[]; label: string }>> = {
  door_schedule: [
    { pdf: ["FireRating", "FRL", "Fire Rating", "Fire Resistance"], ifc: ["Pset_DoorCommon.FireRating", "FireRating"], label: "Fire Rating" },
    { pdf: ["Size", "Door Size", "Dimensions"], ifc: ["OverallWidth", "OverallHeight", "Width", "Height"], label: "Size" },
    { pdf: ["Material", "Door Material"], ifc: ["Material", "Pset_DoorCommon.Material"], label: "Material" },
    { pdf: ["Hardware", "Hardware Set", "Ironmongery"], ifc: ["Pset_DoorCommon.HandicapAccessible", "Hardware"], label: "Hardware" },
    { pdf: ["Finish", "Door Finish"], ifc: ["Finish", "Pset_DoorCommon.SurfaceFinish"], label: "Finish" },
    { pdf: ["Type", "Door Type"], ifc: ["ObjectType", "Type"], label: "Type" },
  ],
  window_schedule: [
    { pdf: ["GlazingType", "Glazing", "Glass Type"], ifc: ["Pset_WindowCommon.GlazingType", "GlazingType"], label: "Glazing Type" },
    { pdf: ["Size", "Window Size", "Dimensions"], ifc: ["OverallWidth", "OverallHeight", "Width", "Height"], label: "Size" },
    { pdf: ["UValue", "U-Value", "U Value", "Thermal"], ifc: ["Pset_WindowCommon.ThermalTransmittance", "UValue"], label: "U-Value" },
    { pdf: ["Frame", "Frame Material", "Frame Type"], ifc: ["Pset_WindowCommon.FrameMaterial", "Frame"], label: "Frame" },
    { pdf: ["Acoustic", "STC", "Rw"], ifc: ["Pset_WindowCommon.AcousticRating", "AcousticRating"], label: "Acoustic" },
  ],
  finish_schedule: [
    { pdf: ["FloorFinish", "Floor", "Floor Finish"], ifc: ["Pset_SpaceCommon.FloorFinish", "FloorFinish"], label: "Floor Finish" },
    { pdf: ["WallFinish", "Wall", "Walls", "Wall Finish"], ifc: ["Pset_SpaceCommon.WallFinish", "WallFinish"], label: "Wall Finish" },
    { pdf: ["CeilingFinish", "Ceiling", "Ceiling Finish"], ifc: ["Pset_SpaceCommon.CeilingFinish", "CeilingFinish"], label: "Ceiling Finish" },
    { pdf: ["Skirting", "Skirting Type"], ifc: ["Pset_SpaceCommon.SkirtingBoard", "Skirting"], label: "Skirting" },
  ],
};

/**
 * Find a property value from a properties object, trying multiple possible keys.
 */
function findProperty(
  properties: Record<string, unknown>,
  keys: string[]
): unknown {
  for (const key of keys) {
    // Direct key match
    if (properties[key] != null) return properties[key];

    // Dot-notation path (e.g. "Pset_DoorCommon.FireRating")
    if (key.includes(".")) {
      const parts = key.split(".");
      let current: unknown = properties;
      let found = true;
      for (const part of parts) {
        if (current == null || typeof current !== "object") {
          found = false;
          break;
        }
        current = (current as Record<string, unknown>)[part];
      }
      if (found && current != null) return current;
    }

    // Case-insensitive fallback
    const lowerKey = key.toLowerCase();
    for (const [k, v] of Object.entries(properties)) {
      if (k.toLowerCase() === lowerKey && v != null) return v;
    }
  }
  return null;
}

/**
 * Extract the mark/tag from an IFC element.
 * Tries Tag property first, then various common property paths.
 */
function extractMark(
  element: { name?: string; properties: Record<string, unknown> },
  matchBy: "mark" | "name"
): string | null {
  if (matchBy === "name") {
    return element.name ?? null;
  }

  // Try common tag/mark property locations
  const tagKeys = [
    "Tag",
    "tag",
    "Mark",
    "mark",
    "Reference",
    "Pset_DoorCommon.Reference",
    "Pset_WindowCommon.Reference",
  ];

  for (const key of tagKeys) {
    const val = findProperty(element.properties, [key]);
    if (val != null && String(val).trim() !== "") return String(val);
  }

  return null;
}

// ── Cross-Validation Tool ──────────────────────────────────────

export const crossValidateTool = createTool({
  description:
    "Cross-validate IFC model data against PDF schedule data. " +
    "Joins elements to schedule rows by mark/tag and compares properties. " +
    "Returns PASS/MISMATCH/ABSENT for each property comparison. " +
    "Use this to find discrepancies between the 3D model and construction drawings — " +
    "e.g. door fire ratings in the model vs the door schedule, window U-values, room finishes.",
  inputSchema: z.object({
    projectId: z
      .string()
      .describe("The project ID to cross-validate within"),
    ifcType: z
      .string()
      .describe(
        "IFC element type to compare, e.g. 'IfcDoor', 'IfcWindow', 'IfcSpace'"
      ),
    scheduleType: z
      .string()
      .describe(
        "PDF schedule type to compare against: 'door_schedule', 'window_schedule', or 'finish_schedule'"
      ),
    matchBy: z
      .enum(["mark", "name"])
      .default("mark")
      .describe(
        "How to match elements to schedule rows: 'mark' (Tag/Reference) or 'name' (element Name)"
      ),
  }),
  execute: async (ctx, input) => {
    // 1. Query IFC elements
    const groups = await ctx.runQuery(
      internal.tools.queries.listElementGroups,
      {
        projectId: input.projectId as never,
        elementType: input.ifcType,
      }
    );

    if (groups.length === 0) {
      return JSON.stringify({
        status: "error",
        message: `No IFC elements found for type '${input.ifcType}'. ` +
          `Extract the data first using extractIfcElements, or check the element type name.`,
      });
    }

    // Collect all elements from matching groups
    const allElements: Array<{
      globalId: string;
      name?: string;
      properties: Record<string, unknown>;
    }> = [];

    for (const group of groups) {
      const elements = await ctx.runQuery(
        internal.tools.queries.listElementsByGroup,
        { groupId: group._id, limit: 200 }
      );
      allElements.push(
        ...elements.map((e) => ({
          globalId: e.globalId,
          name: e.name ?? undefined,
          properties: e.properties as Record<string, unknown>,
        }))
      );
    }

    // 2. Query PDF schedule rows
    const scheduleRows = await ctx.runQuery(
      internal.tools.queries.listScheduleRows,
      {
        projectId: input.projectId as never,
        scheduleType: input.scheduleType,
        limit: 500,
      }
    );

    if (scheduleRows.length === 0) {
      return JSON.stringify({
        status: "error",
        message: `No PDF schedule rows found for type '${input.scheduleType}'. ` +
          `The PDF may not have been processed yet, or this schedule type may not exist in the drawings.`,
      });
    }

    // 3. Build normalized mark lookup from schedule rows
    const scheduleByMark = new Map<
      string,
      { mark: string; properties: Record<string, unknown> }
    >();
    for (const row of scheduleRows) {
      const normalized = normalizeMark(row.mark);
      scheduleByMark.set(normalized, {
        mark: row.mark,
        properties: row.properties as Record<string, unknown>,
      });
    }

    // 4. Get property map for this schedule type
    const propertyMap = PROPERTY_MAPS[input.scheduleType] ?? [];

    // 5. Join and compare
    const details: Array<{
      globalId: string;
      name?: string;
      ifcMark: string | null;
      pdfMark: string | null;
      matched: boolean;
      comparisons: PropertyComparison[];
    }> = [];

    const matchedScheduleMarks = new Set<string>();
    let passCount = 0;
    let mismatchCount = 0;
    let absentCount = 0;
    let ifcOrphanCount = 0;

    for (const element of allElements) {
      const ifcMark = extractMark(element, input.matchBy);
      const normalizedIfcMark = ifcMark ? normalizeMark(ifcMark) : null;

      const scheduleRow = normalizedIfcMark
        ? scheduleByMark.get(normalizedIfcMark)
        : undefined;

      if (!scheduleRow) {
        ifcOrphanCount++;
        details.push({
          globalId: element.globalId,
          name: element.name,
          ifcMark,
          pdfMark: null,
          matched: false,
          comparisons: [],
        });
        continue;
      }

      matchedScheduleMarks.add(normalizedIfcMark!);

      // Compare properties
      const comparisons: PropertyComparison[] = [];
      for (const mapping of propertyMap) {
        const ifcVal = findProperty(element.properties, mapping.ifc);
        const pdfVal = findProperty(scheduleRow.properties, mapping.pdf);
        const result = compareProperty(ifcVal, pdfVal);

        comparisons.push({
          property: mapping.label,
          ifcValue: ifcVal != null ? String(ifcVal) : null,
          pdfValue: pdfVal != null ? String(pdfVal) : null,
          result,
        });

        if (result === "PASS") passCount++;
        else if (result === "MISMATCH") mismatchCount++;
        else if (result === "ABSENT") absentCount++;
      }

      details.push({
        globalId: element.globalId,
        name: element.name,
        ifcMark: ifcMark,
        pdfMark: scheduleRow.mark,
        matched: true,
        comparisons,
      });
    }

    // Count schedule orphans (rows with no IFC match)
    const pdfOrphanCount = scheduleRows.filter(
      (row) => !matchedScheduleMarks.has(normalizeMark(row.mark))
    ).length;

    const pdfOrphans = scheduleRows
      .filter((row) => !matchedScheduleMarks.has(normalizeMark(row.mark)))
      .map((row) => row.mark);

    // 6. Build summary
    const matchedCount = details.filter((d) => d.matched).length;
    const totalComparisons = passCount + mismatchCount + absentCount;

    const summary = {
      ifcType: input.ifcType,
      scheduleType: input.scheduleType,
      matchBy: input.matchBy,
      ifcElementCount: allElements.length,
      scheduleRowCount: scheduleRows.length,
      matched: matchedCount,
      ifcOrphans: ifcOrphanCount,
      pdfOrphans: pdfOrphanCount,
      totalComparisons,
      pass: passCount,
      mismatch: mismatchCount,
      absent: absentCount,
      passRate:
        totalComparisons > 0
          ? `${Math.round((passCount / totalComparisons) * 100)}%`
          : "N/A",
    };

    // 7. Truncate details for LLM context
    // Only show elements with mismatches/absences first, then passes
    const sortedDetails = [
      ...details.filter((d) =>
        d.comparisons.some((c) => c.result === "MISMATCH")
      ),
      ...details.filter(
        (d) =>
          d.comparisons.some((c) => c.result === "ABSENT") &&
          !d.comparisons.some((c) => c.result === "MISMATCH")
      ),
      ...details.filter((d) => !d.matched),
      ...details.filter(
        (d) =>
          d.matched &&
          d.comparisons.every((c) => c.result === "PASS")
      ),
    ];

    const truncatedDetails = sortedDetails.slice(0, MAX_DETAIL_ELEMENTS);

    const result = {
      status: "ok",
      summary,
      pdfOrphanMarks: pdfOrphans.slice(0, 20),
      details: truncatedDetails,
      detailsTruncated: sortedDetails.length > MAX_DETAIL_ELEMENTS,
    };

    // Final size check
    let resultStr = JSON.stringify(result);
    if (resultStr.length > MAX_RESULT_SIZE) {
      // Reduce details further
      result.details = truncatedDetails.slice(
        0,
        Math.max(10, Math.floor(MAX_DETAIL_ELEMENTS * 0.5))
      );
      result.detailsTruncated = true;
      resultStr = JSON.stringify(result);
    }

    return resultStr;
  },
});
