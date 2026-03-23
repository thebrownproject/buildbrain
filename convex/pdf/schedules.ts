"use node";

// ============================================================
// PDF Extraction Library — Schedule Classification & Merging
// ============================================================
//
// Ported from pdf_extract.py — pure string matching for schedule
// detection in Australian construction drawings.
//
// Schedule types: door_schedule, window_schedule, finish_schedule
// Scoring: primary header match +0.3, title regex +0.3, secondary +0.1
// Threshold: > 0.35 to classify, capped at 1.0

import { SCHEDULE_PATTERNS } from "./types";
import type { Schedule, ScheduleRow, Table } from "./types";

// ============================================================
// Header Normalization & Matching
// ============================================================

/**
 * Normalize a header string for fuzzy comparison.
 *
 * Strips whitespace, lowercases, replaces common punctuation with spaces,
 * and collapses multiple whitespace into single spaces.
 *
 * Examples:
 *   "Door No."     -> "door no"
 *   "FIRE-RATING"  -> "fire rating"
 *   "  Mark  "     -> "mark"
 */
export function normalizeHeader(header: string | null | undefined): string {
  if (header == null) return "";
  let h = header.trim().toLowerCase();
  h = h.replace(/[.\-_/\\()#*:]/g, " ");
  h = h.replace(/\s+/g, " ").trim();
  return h;
}

/**
 * Check if an actual header matches a pattern string.
 *
 * Matching strategies (in order):
 *   1. Exact match after normalization
 *   2. Substring match (pattern is within header, or header is within pattern)
 *   3. Starts-with match (header starts with pattern)
 *
 * @param actualHeader - The header text from the extracted table
 * @param pattern - The pattern to match against (from SCHEDULE_PATTERNS)
 */
export function headerMatches(
  actualHeader: string | null | undefined,
  pattern: string
): boolean {
  const norm = normalizeHeader(actualHeader);
  const patternNorm = pattern.toLowerCase().trim();

  if (norm.length === 0) return false;

  // Exact match
  if (norm === patternNorm) return true;

  // Substring match (either direction)
  if (patternNorm.length > 2 && (norm.includes(patternNorm) || patternNorm.includes(norm))) {
    return true;
  }

  // Starts-with match
  if (norm.startsWith(patternNorm)) return true;

  return false;
}

// ============================================================
// Table Classification
// ============================================================

/**
 * Classify a table as a specific schedule type.
 *
 * Scoring system (ported from pdf_extract.py):
 *   - Primary header match: +0.3 per match
 *   - Title regex match in page text: +0.3 base
 *   - Secondary header match: +0.1 per match
 *   - Score is capped at 1.0
 *   - Must exceed 0.35 threshold to classify
 *
 * Returns the schedule type with the highest score, or null if
 * no type exceeds the threshold.
 *
 * @param headers - Table header strings
 * @param pageText - Full text of the page (for title matching)
 */
export function classifyTable(
  headers: string[],
  pageText: string
): { type: string; confidence: number } | null {
  let bestType: string | null = null;
  let bestScore = 0;

  for (const [schedType, patterns] of Object.entries(SCHEDULE_PATTERNS)) {
    let score = 0;

    // Count primary header matches
    const primaryMatches = patterns.primary.filter((p) =>
      headers.some((h) => headerMatches(h, p))
    ).length;

    if (primaryMatches === 0) {
      // No primary header match — check if title regex matches
      const titleMatch = patterns.titlePatterns.some((tp) =>
        tp.test(pageText)
      );
      if (!titleMatch) {
        // Neither primary headers nor title match — skip this type
        continue;
      }
      score += 0.3;
    } else {
      score += primaryMatches * 0.3;
    }

    // Count secondary header matches
    const secondaryMatches = patterns.secondary.filter((p) =>
      headers.some((h) => headerMatches(h, p))
    ).length;
    score += secondaryMatches * 0.1;

    // Cap at 1.0
    score = Math.min(score, 1.0);

    if (score > 0.35 && score > bestScore) {
      bestScore = score;
      bestType = schedType;
    }
  }

  if (bestType === null) return null;

  return {
    type: bestType,
    confidence: Math.round(bestScore * 100) / 100,
  };
}

// ============================================================
// Schedule Continuation Merging
// ============================================================

/**
 * Merge schedule tables that span consecutive pages.
 *
 * Construction schedules commonly continue across multiple pages. Two
 * tables are considered continuations if:
 *   1. Same schedule type
 *   2. On consecutive pages
 *   3. Identical headers (after normalization)
 *
 * When merging:
 *   - Rows from continuation pages are appended
 *   - Duplicate header rows (re-printed on continuation pages) are removed
 *   - The source pages array tracks all contributing pages
 *   - Confidence is set to the maximum of merged tables
 *
 * @param schedules - Array of classified schedule tables, sorted by page
 */
export function mergeSchedules(schedules: Schedule[]): Schedule[] {
  if (schedules.length <= 1) return [...schedules];

  // Sort by first page number
  const sorted = [...schedules].sort((a, b) => a.pages[0] - b.pages[0]);

  const merged: Schedule[] = [
    {
      ...sorted[0],
      pages: [...sorted[0].pages],
      rows: [...sorted[0].rows],
    },
  ];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const prev = merged[merged.length - 1];

    // Check merge conditions
    const sameType = current.type === prev.type;
    const consecutivePages =
      current.pages[0] === prev.pages[prev.pages.length - 1] + 1;
    const sameHeaders = headersMatch(current.headers, prev.headers);

    if (sameType && consecutivePages && sameHeaders) {
      // Filter out duplicate header rows from continuation page
      const newRows = filterDuplicateHeaderRows(current.rows, prev.headers);
      prev.rows.push(...newRows);
      prev.rowCount = prev.rows.length;
      prev.pages.push(...current.pages);
      prev.confidence = Math.max(prev.confidence, current.confidence);
    } else {
      merged.push({
        ...current,
        pages: [...current.pages],
        rows: [...current.rows],
      });
    }
  }

  return merged;
}

/**
 * Check if two header arrays match after normalization.
 */
function headersMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((h, i) => normalizeHeader(h) === normalizeHeader(b[i]));
}

/**
 * Filter out rows that appear to be duplicated header rows.
 *
 * Continuation pages often reprint the header row. If a data row's
 * normalized cells match the headers exactly, it's a duplicate header.
 */
function filterDuplicateHeaderRows(
  rows: string[][],
  headers: string[]
): string[][] {
  const normalizedHeaders = headers.map(normalizeHeader);

  return rows.filter((row) => {
    if (row.length !== headers.length) return true;
    const normalizedRow = row.map(normalizeHeader);
    // Keep the row if it differs from the headers
    return !normalizedRow.every((cell, i) => cell === normalizedHeaders[i]);
  });
}

// ============================================================
// Schedule Row Extraction
// ============================================================

/**
 * Convert table rows to ScheduleRow[] with mark + properties dict.
 *
 * The "mark" is identified by finding the first header that matches a
 * primary pattern for the schedule type. If no primary header is found,
 * the first column is used as the mark.
 *
 * Each row becomes a ScheduleRow with:
 *   - mark: the row's identifier (e.g., "D-01", "W-14")
 *   - properties: a Record<string, string> mapping header names to values
 *   - sourcePages: the pages this schedule spans
 *
 * Empty marks are skipped (likely empty/separator rows).
 */
export function extractScheduleRows(schedule: Schedule): ScheduleRow[] {
  const { headers, rows, type, pages } = schedule;

  // Find the mark column index
  const markIndex = findMarkColumnIndex(headers, type);

  const scheduleRows: ScheduleRow[] = [];

  for (const row of rows) {
    const mark = (row[markIndex] || "").trim();

    // Skip rows with empty marks
    if (mark.length === 0) continue;

    // Build properties dict from all non-mark columns
    const properties: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      if (i === markIndex) continue;
      const headerName = headers[i].trim();
      if (headerName.length === 0) continue;
      properties[headerName] = (row[i] || "").trim();
    }

    scheduleRows.push({
      mark,
      properties,
      sourcePages: [...pages],
    });
  }

  return scheduleRows;
}

/**
 * Find the column index that contains the mark/identifier.
 *
 * Checks headers against the schedule type's primary patterns.
 * Falls back to index 0 if no primary header is found.
 */
function findMarkColumnIndex(headers: string[], scheduleType: string): number {
  const patterns = SCHEDULE_PATTERNS[scheduleType];
  if (!patterns) return 0;

  for (let i = 0; i < headers.length; i++) {
    for (const primary of patterns.primary) {
      if (headerMatches(headers[i], primary)) {
        return i;
      }
    }
  }

  // Fallback: first column
  return 0;
}

// ============================================================
// High-Level: Classify & Structure Tables from a Page
// ============================================================

/**
 * Classify extracted tables and convert to Schedule objects.
 *
 * Takes raw Table[] from the table extractor and page text, classifies
 * each table, and returns Schedule[] for those that match a known type.
 *
 * @param tables - Extracted tables from a page
 * @param pageText - Full page text for title matching
 * @param pageNumber - Page number (1-indexed)
 */
export function classifyTables(
  tables: Table[],
  pageText: string,
  pageNumber: number
): Schedule[] {
  const schedules: Schedule[] = [];

  for (const table of tables) {
    const result = classifyTable(table.headers, pageText);
    if (result) {
      schedules.push({
        type: result.type,
        pages: [pageNumber],
        headers: table.headers,
        rows: table.rows,
        confidence: result.confidence,
        rowCount: table.rows.length,
      });
    }
  }

  return schedules;
}
