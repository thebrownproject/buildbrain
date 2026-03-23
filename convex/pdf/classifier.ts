"use node";

// ============================================================
// PDF Extraction Library — Page Classification
// ============================================================
//
// Classifies PDF pages using a three-strategy approach:
//   1. Drawing number parsing (NCS type digit)
//   2. Title/text keyword matching
//   3. Content analysis (fallback)
//
// Classifications: schedule, plan, section, detail, elevation,
//                  notes, cover, legend

import type { PageClassification } from "./types";

// ============================================================
// Drawing Number Extraction
// ============================================================

/**
 * Regex to find drawing numbers in title block area.
 *
 * Common Australian/NCS patterns:
 *   A-101, A-601, S-201, M.301     (discipline-type-sequence)
 *   A1.01, A2.01, A6.01            (discipline+type.sequence)
 *   AR-101, STR-201                (multi-char discipline)
 *
 * Captures: [discipline] [type digit(s)] [sequence]
 */
const DRAWING_NUMBER_REGEX =
  /\b([A-Z]{1,3})[-.]?(\d{1,2})[.-]?(\d{2,3})\b/;

/**
 * Additional regex for slash-separated formats: A/101, S/201
 */
const DRAWING_NUMBER_SLASH_REGEX =
  /\b([A-Z]{1,3})\/(\d{1,2})(\d{2})\b/;

/**
 * Extract a drawing number from page text.
 *
 * Searches the text for patterns matching NCS-style drawing numbers.
 * Returns the first match found, or undefined if no drawing number
 * is detected.
 *
 * @param pageText - Full text content of the page
 */
export function extractDrawingNumber(
  pageText: string
): string | undefined {
  // Try primary regex first
  const match = DRAWING_NUMBER_REGEX.exec(pageText);
  if (match) {
    return match[0];
  }

  // Try slash-separated format
  const slashMatch = DRAWING_NUMBER_SLASH_REGEX.exec(pageText);
  if (slashMatch) {
    return slashMatch[0];
  }

  return undefined;
}

/**
 * Parse the NCS type digit from a drawing number.
 *
 * NCS (National CAD Standard) type digit mapping:
 *   0 = general/cover, 1 = plan, 2 = elevation, 3 = section,
 *   4 = enlarged plan, 5 = detail, 6 = schedule, 7 = diagram,
 *   8 = notes, 9 = 3D
 *
 * Returns the type digit as a number, or undefined if parsing fails.
 */
function parseTypeDigit(drawingNumber: string): number | undefined {
  const match = DRAWING_NUMBER_REGEX.exec(drawingNumber);
  if (!match) return undefined;

  // match[2] is the type digit(s) — take the first character
  const typeStr = match[2];
  const typeDigit = parseInt(typeStr.charAt(0), 10);
  if (isNaN(typeDigit)) return undefined;

  return typeDigit;
}

// ============================================================
// Drawing Title Extraction
// ============================================================

/**
 * Extract a drawing title from page text.
 *
 * Heuristic: looks for common title patterns near the bottom of the
 * page (title block area). Falls back to the first line of text that
 * looks like a title (starts with uppercase, reasonable length).
 *
 * @param pageText - Full text content of the page
 */
export function extractDrawingTitle(
  pageText: string
): string | undefined {
  // Strategy 1: Look for explicit title labels
  const titleLabelPatterns = [
    /(?:drawing\s+title|title)\s*[:=]\s*(.+)/i,
    /(?:sheet\s+title|sheet\s+name)\s*[:=]\s*(.+)/i,
  ];

  for (const pattern of titleLabelPatterns) {
    const match = pattern.exec(pageText);
    if (match && match[1]) {
      const title = match[1].trim();
      if (title.length > 2 && title.length < 100) {
        return title;
      }
    }
  }

  // Strategy 2: Look for known drawing type titles
  const titlePatterns = [
    /\b((?:GROUND\s+)?(?:FLOOR\s+)?PLAN\b.{0,40})/i,
    /\b((?:DOOR|WINDOW|FINISH(?:ES)?)\s+SCHEDULE\b.{0,40})/i,
    /\b((?:NORTH|SOUTH|EAST|WEST)\s+ELEVATION\b.{0,40})/i,
    /\b(SECTION\s+[A-Z0-9-]+.{0,40})/i,
    /\b(DETAIL\s+[A-Z0-9-]+.{0,40})/i,
    /\b(GENERAL\s+NOTES?\b.{0,40})/i,
    /\b(COVER\s+(?:SHEET|PAGE)\b.{0,40})/i,
    /\b(LEGEND\b.{0,40})/i,
  ];

  for (const pattern of titlePatterns) {
    const match = pattern.exec(pageText);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return undefined;
}

// ============================================================
// Page Classification
// ============================================================

/**
 * NCS type digit to classification mapping.
 */
const TYPE_DIGIT_MAP: Record<number, PageClassification> = {
  0: "cover",
  1: "plan",
  2: "elevation",
  3: "section",
  4: "plan", // enlarged plan is still a plan
  5: "detail",
  6: "schedule",
  // 7 = diagram (no direct classification, falls through)
  8: "notes",
  // 9 = 3D (no direct classification, falls through)
};

/**
 * Keyword patterns for text-based classification.
 * Ordered by specificity (more specific patterns first).
 */
const KEYWORD_PATTERNS: Array<{
  classification: PageClassification;
  patterns: RegExp[];
}> = [
  {
    classification: "schedule",
    patterns: [
      /\bschedule\b/i,
      /\bdoor\s+schedule\b/i,
      /\bwindow\s+schedule\b/i,
      /\bfinish(?:es)?\s+schedule\b/i,
    ],
  },
  {
    classification: "cover",
    patterns: [
      /\bcover\s+(?:sheet|page)\b/i,
      /\bindex\b/i,
      /\btable\s+of\s+contents\b/i,
      /\bdrawing\s+(?:list|index|register)\b/i,
    ],
  },
  {
    classification: "notes",
    patterns: [
      /\bgeneral\s+notes?\b/i,
      /\bspecification\s+notes?\b/i,
      /\babbreviations?\b/i,
    ],
  },
  {
    classification: "legend",
    patterns: [
      /\blegend\b/i,
      /\bsymbol(?:s)?\s+(?:legend|key)\b/i,
    ],
  },
  {
    classification: "plan",
    patterns: [
      /\bfloor\s+plan\b/i,
      /\bsite\s+plan\b/i,
      /\broof\s+plan\b/i,
      /\bdemolition\s+plan\b/i,
      /\bplan\b/i,
    ],
  },
  {
    classification: "elevation",
    patterns: [
      /\belevation\b/i,
      /\b(?:north|south|east|west)\s+elevation\b/i,
    ],
  },
  {
    classification: "section",
    patterns: [
      /\bcross[\s-]?section\b/i,
      /\bsection\b/i,
      /\blongitudinal\s+section\b/i,
    ],
  },
  {
    classification: "detail",
    patterns: [/\bdetail\b/i, /\benlarged\b/i, /\btypical\s+detail\b/i],
  },
];

/**
 * Classify a PDF page based on drawing number, keywords, and content.
 *
 * Three-strategy approach (in priority order):
 *
 * **Strategy 1: Drawing number type digit (highest confidence)**
 *   Parse the NCS-format drawing number for its type digit.
 *   A-601 -> type 6 -> schedule. A1.01 -> type 1 -> plan.
 *
 * **Strategy 2: Title/text keyword matching (medium confidence)**
 *   Scan page text for known classification keywords like
 *   "floor plan", "door schedule", "general notes", etc.
 *
 * **Strategy 3: Content analysis (fallback, lowest confidence)**
 *   Analyze text density and structure for broad classification.
 *
 * @param pageText - Full text content of the page
 * @param drawingNumber - Pre-extracted drawing number (optional)
 */
export function classifyPage(
  pageText: string,
  drawingNumber?: string
): PageClassification | undefined {
  // Strategy 1: Drawing number type digit
  if (drawingNumber) {
    const typeDigit = parseTypeDigit(drawingNumber);
    if (typeDigit !== undefined && typeDigit in TYPE_DIGIT_MAP) {
      return TYPE_DIGIT_MAP[typeDigit];
    }
  }

  // Strategy 2: Keyword matching
  for (const { classification, patterns } of KEYWORD_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(pageText)) {
        return classification;
      }
    }
  }

  // Strategy 3: Content analysis (fallback heuristics)
  return classifyByContent(pageText);
}

/**
 * Fallback classification using content analysis.
 *
 * Heuristics:
 *   - Very little text (< 50 chars) on first page -> likely cover
 *   - Dense text with many lines (> 30 lines, > 500 chars) -> likely notes
 *   - Otherwise, no classification (returns undefined)
 */
function classifyByContent(
  pageText: string
): PageClassification | undefined {
  const trimmed = pageText.trim();

  // Very sparse page
  if (trimmed.length < 50) {
    return undefined;
  }

  // Count lines
  const lines = trimmed.split("\n").filter((l) => l.trim().length > 0);

  // Dense text = likely notes
  if (lines.length > 30 && trimmed.length > 500) {
    return "notes";
  }

  return undefined;
}
