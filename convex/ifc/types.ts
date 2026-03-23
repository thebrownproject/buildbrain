"use node";

// ── IFC Data Types ──────────────────────────────────────────────────────────
// TypeScript types for the IFC extraction library.
// No Convex actions/mutations — pure type definitions.

/**
 * Extracted data for a single IFC element.
 */
export interface ElementData {
  guid: string;
  name: string | null;
  typeName: string | null;
  storey: string | null;
  ifcClass: string;
  properties: PropertySets;
  quantities: Record<string, unknown>;
  material: string | null;
}

/**
 * Property sets: map of pset name to map of property name to value.
 * e.g. { "Pset_DoorCommon": { "FireRating": "FRL-30", "IsExternal": true } }
 */
export type PropertySets = Record<string, Record<string, unknown>>;

/**
 * Result of quantity extraction for an element type.
 */
export interface QuantityResult {
  totals: {
    count: number;
    area: number | null;
    volume: number | null;
  };
  byStorey: Record<
    string,
    { count: number; area: number | null; volume: number | null }
  >;
  byType: Record<
    string,
    { count: number; area: number | null; volume: number | null }
  >;
  qtoCoverage: number;
  geometryFallbackCount: number;
}

/**
 * Result of IFC model summary.
 */
export interface SummaryResult {
  schema: string;
  projectName: string | null;
  elementCounts: Record<string, number>;
  storeys: string[];
  fileSizeMb: number;
  parseTimeMs: number;
}

/**
 * Result of model validation.
 */
export interface ValidationResult {
  issues: ValidationIssue[];
  completeness: Record<
    string,
    { total: number; withPset: number; score: number }
  >;
}

/**
 * A single validation issue.
 */
export interface ValidationIssue {
  severity: "error" | "warning" | "info";
  type: string;
  message: string;
  affectedCount: number;
  elementType?: string;
  elements?: string[];
}

/**
 * Manifest format for the agent system prompt.
 * Provides a compact overview of the IFC file's contents.
 */
export interface IFCManifest {
  fileName: string;
  schema: string;
  fileSizeMb: number;
  storeys: string[];
  elementCounts: Record<string, number>;
  psetCoverage: number;
  qtoCoverage: number;
  parseTimeMs: number;
}

// ── Type Shorthand Map ──────────────────────────────────────────────────────
// Maps user-friendly shorthand names to IFC class names.

export const TYPE_SHORTHAND: Record<string, string> = {
  door: "IfcDoor",
  wall: "IfcWall",
  window: "IfcWindow",
  beam: "IfcBeam",
  column: "IfcColumn",
  slab: "IfcSlab",
  roof: "IfcRoof",
  stair: "IfcStair",
  stairflight: "IfcStairFlight",
  railing: "IfcRailing",
  covering: "IfcCovering",
  proxy: "IfcBuildingElementProxy",
  space: "IfcSpace",
  storey: "IfcBuildingStorey",
  floor: "IfcSlab",
  room: "IfcSpace",
};

// ── QTO Preferences Map ─────────────────────────────────────────────────────
// Maps each element type to its expected Qto property set name and key properties.

export interface QtoPreference {
  qtoSetName: string;
  areaProp: string | null;
  volumeProp: string | null;
}

export const QTO_PREFERENCES: Record<string, QtoPreference> = {
  IfcWall: {
    qtoSetName: "Qto_WallBaseQuantities",
    areaProp: "NetSideArea",
    volumeProp: "NetVolume",
  },
  IfcDoor: {
    qtoSetName: "Qto_DoorBaseQuantities",
    areaProp: "Area",
    volumeProp: null,
  },
  IfcWindow: {
    qtoSetName: "Qto_WindowBaseQuantities",
    areaProp: "Area",
    volumeProp: null,
  },
  IfcSlab: {
    qtoSetName: "Qto_SlabBaseQuantities",
    areaProp: "NetArea",
    volumeProp: "NetVolume",
  },
  IfcBeam: {
    qtoSetName: "Qto_BeamBaseQuantities",
    areaProp: "CrossSectionArea",
    volumeProp: "NetVolume",
  },
  IfcColumn: {
    qtoSetName: "Qto_ColumnBaseQuantities",
    areaProp: "CrossSectionArea",
    volumeProp: "NetVolume",
  },
  IfcRoof: {
    qtoSetName: "Qto_RoofBaseQuantities",
    areaProp: "NetArea",
    volumeProp: null,
  },
  IfcStair: {
    qtoSetName: "Qto_StairBaseQuantities",
    areaProp: null,
    volumeProp: "NetVolume",
  },
  IfcStairFlight: {
    qtoSetName: "Qto_StairFlightBaseQuantities",
    areaProp: null,
    volumeProp: "NetVolume",
  },
  IfcRailing: {
    qtoSetName: "Qto_RailingBaseQuantities",
    areaProp: null,
    volumeProp: null,
  },
  IfcCovering: {
    qtoSetName: "Qto_CoveringBaseQuantities",
    areaProp: "NetArea",
    volumeProp: null,
  },
  IfcSpace: {
    qtoSetName: "Qto_SpaceBaseQuantities",
    areaProp: "NetFloorArea",
    volumeProp: "NetVolume",
  },
  IfcBuildingElementProxy: {
    qtoSetName: "Qto_BuildingElementProxyBaseQuantities",
    areaProp: null,
    volumeProp: null,
  },
};
