"use node";

// ============================================================
// PDF Extraction Library — Type Definitions
// ============================================================

/**
 * Extracted data for a single PDF page.
 */
export interface PageData {
  pageNumber: number;
  text: string;
  width: number;
  height: number;
  orientation: "portrait" | "landscape";
  classification?: PageClassification;
  drawingNumber?: string;
  drawingTitle?: string;
  hasTable: boolean;
}

/**
 * A table extracted from a PDF page via grid-based line detection.
 */
export interface Table {
  headers: string[];
  rows: string[][];
  bbox?: { x: number; y: number; width: number; height: number };
  confidence?: number;
  pageNumber?: number;
}

/**
 * A classified schedule after table detection and header matching.
 */
export interface Schedule {
  type: string;
  pages: number[];
  headers: string[];
  rows: string[][];
  confidence: number;
  rowCount: number;
}

/**
 * A single row from a schedule, keyed by its mark/tag identifier.
 */
export interface ScheduleRow {
  mark: string;
  properties: Record<string, string>;
  sourcePages: number[];
}

/**
 * Page classification based on drawing number, title keywords, and content analysis.
 */
export type PageClassification =
  | "schedule"
  | "plan"
  | "section"
  | "detail"
  | "elevation"
  | "notes"
  | "cover"
  | "legend";

/**
 * A geometric edge extracted from PDF path operations.
 * Coordinates are in page space (top-left origin after conversion).
 */
export interface Edge {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Drawing register entry for the agent system prompt manifest.
 */
export interface PDFManifestEntry {
  pageNumber: number;
  classification?: PageClassification;
  drawingNumber?: string;
  drawingTitle?: string;
  hasTable: boolean;
  textPreview?: string;
}

/**
 * PDF manifest format for the agent system prompt.
 * Provides file-level orientation: page count, drawing register, schedule summaries.
 */
export interface PDFManifest {
  fileName: string;
  pageCount: number;
  pages: PDFManifestEntry[];
  schedules: Array<{
    type: string;
    pages: number[];
    rowCount: number;
    headers: string[];
    confidence: number;
  }>;
}

/**
 * Pattern definition for schedule classification.
 */
export interface SchedulePatternDef {
  primary: string[];
  secondary: string[];
  titlePatterns: RegExp[];
}

/**
 * Classification patterns for door/window/finish schedules.
 * Primary headers are strong signals (mark/identifier columns).
 * Secondary headers are supporting signals (property columns).
 * Title regexes match against the full page text.
 */
export const SCHEDULE_PATTERNS: Record<string, SchedulePatternDef> = {
  door_schedule: {
    primary: ["mark", "door no", "door number", "door ref"],
    secondary: [
      "size", "width", "height",
      "type", "door type",
      "fire rating", "fire", "frl", "fire resistance",
      "hardware", "ironmongery", "hardware set",
      "material", "construction",
      "finish",
      "frame", "frame type",
      "leaf", "no. of leaves",
      "threshold",
      "glazing", "vision panel",
      "acoustic", "acoustic rating", "rw",
      "lock", "lockset",
      "closer",
      "smoke seal",
      "undercut",
    ],
    titlePatterns: [
      /door\s+schedule/i,
      /door\s+and\s+frame\s+schedule/i,
      /internal\s+door\s+schedule/i,
      /external\s+door\s+schedule/i,
    ],
  },
  window_schedule: {
    primary: ["mark", "window no", "window number", "window ref", "window id"],
    secondary: [
      "size", "width", "height",
      "type", "window type",
      "glazing", "glass", "glass type",
      "u-value", "u value", "thermal",
      "operability", "operation", "opening type",
      "frame", "frame material", "frame type",
      "sill", "sill height",
      "head height",
      "acoustic", "acoustic rating", "rw",
      "bushfire", "bal", "bal rating",
      "flyscreen", "fly screen",
      "security", "security screen",
    ],
    titlePatterns: [
      /window\s+schedule/i,
      /glazing\s+schedule/i,
    ],
  },
  finish_schedule: {
    primary: ["room", "room no", "room name", "space", "area"],
    secondary: [
      "floor", "floor finish",
      "wall", "wall finish",
      "ceiling", "ceiling finish",
      "skirting", "skirting board",
      "cornice",
      "dado",
      "wet area",
      "paint", "paint colour", "paint color",
      "base",
    ],
    titlePatterns: [
      /finish\s+schedule/i,
      /finishes\s+schedule/i,
      /room\s+finish/i,
      /internal\s+finish/i,
    ],
  },
};
