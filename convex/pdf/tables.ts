"use node";

// ============================================================
// PDF Extraction Library — Grid-Based Table Detection
// ============================================================
//
// Ported from pdf-table-extractor's algorithm using unpdf (serverless pdfjs).
//
// Construction schedules use visible grid lines (drawn as PDF path
// operations). The algorithm:
//
//   1. page.getOperatorList() -> iterate fnArray
//   2. Find OPS.constructPath containing moveTo/lineTo/rectangle sub-ops
//   3. Track the current transformation matrix (CTM) via save/restore/transform
//   4. Classify edges as horizontal or vertical
//   5. Sort and merge overlapping edges
//   6. Find intersections -> build grid coordinates
//   7. Map text items into grid cells via position matching
//   8. Return Table[] with headers (first row) and data rows

// OPS constants — hardcoded because they are stable across all pdfjs versions.
// This avoids async initialization and works with any pdfjs build.
const OPS = {
  constructPath: 91,
  save: 10,
  restore: 11,
  transform: 12,
  setLineWidth: 2,
} as const;

// Kept for API compat with code that calls await getOPS()
async function getOPS(): Promise<typeof OPS> {
  return OPS;
}
import type { PDFPageProxy, TextItem } from "./parser";
import { extractPageTextItems, getPageDimensions } from "./parser";
import type { Edge, Table } from "./types";

// ============================================================
// Constants
// ============================================================

/** Maximum width/height for an edge to be classified as a line (not a filled rect). */
const LINE_MAX_WIDTH = 2;

/** Tolerance for merging overlapping edges (in PDF points). */
const MERGE_TOLERANCE = 3;

/** Tolerance for finding intersections between edges (in PDF points). */
const INTERSECTION_TOLERANCE = 3;

/** Minimum edges required to form a plausible table. */
const MIN_EDGES_FOR_TABLE = 4;

/** Minimum grid cells (rows * cols) for a valid table. */
const MIN_GRID_CELLS = 4;

// Sub-operation codes within OPS.constructPath
const SUB_OP_MOVE_TO = 13;
const SUB_OP_LINE_TO = 14;
const SUB_OP_RECTANGLE = 19;

// ============================================================
// 2D Affine Transform
// ============================================================

/**
 * 6-element affine transform matrix: [a, b, c, d, e, f]
 * Represents the matrix:
 *   | a  c  e |
 *   | b  d  f |
 *   | 0  0  1 |
 */
type Matrix = [number, number, number, number, number, number];

const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0];

/**
 * Multiply two 2D affine transform matrices.
 * Result = m1 * m2 (m2 applied first, then m1).
 */
function multiplyMatrix(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/**
 * Apply an affine transform to a point.
 */
function transformPoint(
  matrix: Matrix,
  x: number,
  y: number
): { x: number; y: number } {
  return {
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5],
  };
}

// ============================================================
// Step 1-6: Extract Edges from PDF Operator List
// ============================================================

/**
 * Extract geometric edges from a PDF page's operator list.
 *
 * Walks the operator list looking for:
 *   - OPS.constructPath: contains moveTo, lineTo, rectangle sub-operations
 *   - OPS.save / OPS.restore: push/pop the current transformation matrix
 *   - OPS.transform: multiply the current transformation matrix
 *
 * For each rectangle or moveTo+lineTo pair, determines if it represents
 * a line edge (thin stroke) vs a filled rectangle. Line edges form the
 * grid structure of construction schedule tables.
 *
 * All coordinates are transformed to page space using the accumulated CTM.
 */
export async function extractEdges(page: PDFPageProxy): Promise<Edge[]> {
  const OPS = await getOPS();
  const opList = await page.getOperatorList();
  const edges: Edge[] = [];

  // Transformation matrix stack
  let ctm: Matrix = [...IDENTITY_MATRIX] as Matrix;
  const matrixStack: Matrix[] = [];

  for (let i = 0; i < opList.fnArray.length; i++) {
    const op = opList.fnArray[i];

    if (op === OPS.save) {
      // Push current CTM onto stack
      matrixStack.push([...ctm] as Matrix);
    } else if (op === OPS.restore) {
      // Pop CTM from stack
      const prev = matrixStack.pop();
      if (prev) {
        ctm = prev;
      }
    } else if (op === OPS.transform) {
      // Multiply CTM by the new transform args
      const args = opList.argsArray[i];
      const newMatrix: Matrix = [
        args[0] as number,
        args[1] as number,
        args[2] as number,
        args[3] as number,
        args[4] as number,
        args[5] as number,
      ];
      ctm = multiplyMatrix(ctm, newMatrix);
    } else if (op === OPS.constructPath) {
      // Parse sub-operations and coordinates
      const subOps = opList.argsArray[i][0] as number[];
      const coords = opList.argsArray[i][1] as number[];

      let coordIdx = 0;
      let moveX = 0;
      let moveY = 0;

      for (const subOp of subOps) {
        if (subOp === SUB_OP_MOVE_TO) {
          // moveTo(x, y) — 2 coordinate values
          moveX = coords[coordIdx++];
          moveY = coords[coordIdx++];
        } else if (subOp === SUB_OP_LINE_TO) {
          // lineTo(x, y) — draws a line from previous moveTo
          const lineX = coords[coordIdx++];
          const lineY = coords[coordIdx++];

          // Transform both endpoints to page space
          const p1 = transformPoint(ctm, moveX, moveY);
          const p2 = transformPoint(ctm, lineX, lineY);

          // Determine if this is a horizontal or vertical line
          const dx = Math.abs(p2.x - p1.x);
          const dy = Math.abs(p2.y - p1.y);

          if (dx > LINE_MAX_WIDTH || dy > LINE_MAX_WIDTH) {
            // It's a meaningful line (not just a dot)
            const minX = Math.min(p1.x, p2.x);
            const minY = Math.min(p1.y, p2.y);
            edges.push({
              x: minX,
              y: minY,
              width: dx,
              height: dy,
            });
          }

          // Update move position for potential chained lineTo
          moveX = lineX;
          moveY = lineY;
        } else if (subOp === SUB_OP_RECTANGLE) {
          // rectangle(x, y, w, h) — 4 coordinate values
          const rx = coords[coordIdx++];
          const ry = coords[coordIdx++];
          const rw = coords[coordIdx++];
          const rh = coords[coordIdx++];

          // Transform all four corners to page space
          const p1 = transformPoint(ctm, rx, ry);
          const p2 = transformPoint(ctm, rx + rw, ry + rh);

          const absW = Math.abs(p2.x - p1.x);
          const absH = Math.abs(p2.y - p1.y);

          // If one dimension is very thin, it's a line edge (not a filled rect)
          if (Math.min(absW, absH) < LINE_MAX_WIDTH) {
            const minX = Math.min(p1.x, p2.x);
            const minY = Math.min(p1.y, p2.y);
            edges.push({
              x: minX,
              y: minY,
              width: absW,
              height: absH,
            });
          }
        } else {
          // Unknown sub-op — some ops consume coordinates, some don't.
          // curveTo (sub-op 15/16) consumes 6/4 coords respectively.
          // We skip unknown sub-ops but this may cause coord misalignment
          // for complex paths. For construction schedules (mostly lines
          // and rectangles), this is acceptable.
          // curveTo: 6 coords (3 control points)
          if (subOp === 15) {
            coordIdx += 6;
          } else if (subOp === 16) {
            // curveTo variant: 4 coords
            coordIdx += 4;
          }
          // closePath (subOp === 18) consumes 0 coords
        }
      }
    }
  }

  return edges;
}

// ============================================================
// Step 7: Classify Edges as Horizontal or Vertical
// ============================================================

/**
 * Classify edges into horizontal and vertical sets.
 *
 * An edge is horizontal if its width > height, vertical if height > width.
 * Edges with width === height (perfect diagonals) are skipped as they
 * don't form grid lines.
 */
export function classifyEdges(edges: Edge[]): {
  horizontal: Edge[];
  vertical: Edge[];
} {
  const horizontal: Edge[] = [];
  const vertical: Edge[] = [];

  for (const edge of edges) {
    if (edge.width > edge.height) {
      horizontal.push(edge);
    } else if (edge.height > edge.width) {
      vertical.push(edge);
    }
    // Skip edges where width === height (diagonals / dots)
  }

  return { horizontal, vertical };
}

// ============================================================
// Step 8: Merge Overlapping Edges
// ============================================================

/**
 * Merge overlapping or nearly-overlapping edges.
 *
 * Edges that are close together (within tolerance) on the same axis
 * are merged into a single edge spanning the combined range. This
 * handles construction drawings where grid lines may be drawn as
 * multiple segments.
 *
 * @param edges - Array of edges (all horizontal or all vertical)
 * @param tolerance - Maximum gap between edges to merge (default: MERGE_TOLERANCE)
 */
export function mergeOverlappingEdges(
  edges: Edge[],
  tolerance: number = MERGE_TOLERANCE
): Edge[] {
  if (edges.length <= 1) return [...edges];

  // Determine if these are horizontal or vertical edges
  // (horizontal: constant-ish Y, variable X; vertical: constant-ish X, variable Y)
  const isHorizontal =
    edges.length > 0 && edges[0].width >= edges[0].height;

  if (isHorizontal) {
    // Sort by Y position (group lines on same row), then by X
    const sorted = [...edges].sort((a, b) => {
      const yDiff = a.y - b.y;
      return Math.abs(yDiff) < tolerance ? a.x - b.x : yDiff;
    });

    const merged: Edge[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i];
      const last = merged[merged.length - 1];

      // Same row (Y within tolerance) and overlapping/adjacent X ranges
      if (
        Math.abs(current.y - last.y) < tolerance &&
        current.x <= last.x + last.width + tolerance
      ) {
        // Extend the existing edge
        const newRight = Math.max(
          last.x + last.width,
          current.x + current.width
        );
        last.width = newRight - last.x;
        last.height = Math.max(last.height, current.height);
      } else {
        merged.push({ ...current });
      }
    }

    return merged;
  } else {
    // Vertical edges: sort by X position, then by Y
    const sorted = [...edges].sort((a, b) => {
      const xDiff = a.x - b.x;
      return Math.abs(xDiff) < tolerance ? a.y - b.y : xDiff;
    });

    const merged: Edge[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i];
      const last = merged[merged.length - 1];

      // Same column (X within tolerance) and overlapping/adjacent Y ranges
      if (
        Math.abs(current.x - last.x) < tolerance &&
        current.y <= last.y + last.height + tolerance
      ) {
        const newBottom = Math.max(
          last.y + last.height,
          current.y + current.height
        );
        last.height = newBottom - last.y;
        last.width = Math.max(last.width, current.width);
      } else {
        merged.push({ ...current });
      }
    }

    return merged;
  }
}

// ============================================================
// Step 9: Find Intersections
// ============================================================

interface Intersection {
  x: number;
  y: number;
}

/**
 * Find intersection points between horizontal and vertical edges.
 *
 * Two edges intersect if:
 *   - The horizontal edge's Y is within the vertical edge's Y range
 *   - The vertical edge's X is within the horizontal edge's X range
 * (within tolerance)
 */
export function findIntersections(
  horizontal: Edge[],
  vertical: Edge[],
  tolerance: number = INTERSECTION_TOLERANCE
): Intersection[] {
  const intersections: Intersection[] = [];

  for (const h of horizontal) {
    const hY = h.y;
    const hXStart = h.x;
    const hXEnd = h.x + h.width;

    for (const v of vertical) {
      const vX = v.x;
      const vYStart = v.y;
      const vYEnd = v.y + v.height;

      // Check if the vertical edge's X is within the horizontal edge's X range
      // and the horizontal edge's Y is within the vertical edge's Y range
      if (
        vX >= hXStart - tolerance &&
        vX <= hXEnd + tolerance &&
        hY >= vYStart - tolerance &&
        hY <= vYEnd + tolerance
      ) {
        intersections.push({ x: vX, y: hY });
      }
    }
  }

  return intersections;
}

// ============================================================
// Step 10: Build Grid from Intersections
// ============================================================

export interface GridCell {
  row: number;
  col: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

export interface Grid {
  rows: number;
  cols: number;
  xPositions: number[];
  yPositions: number[];
  cells: GridCell[][];
}

/**
 * Deduplicate values with a tolerance, returning sorted unique values.
 */
function deduplicatePositions(
  values: number[],
  tolerance: number
): number[] {
  if (values.length === 0) return [];

  const sorted = [...values].sort((a, b) => a - b);
  const unique: number[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - unique[unique.length - 1] > tolerance) {
      unique.push(sorted[i]);
    }
  }

  return unique;
}

/**
 * Build a grid structure from intersection points.
 *
 * Extracts unique X and Y positions from intersections, deduplicates
 * them with tolerance, and creates a 2D array of cells.
 *
 * Returns null if the grid is too small (< 2 rows or < 2 cols).
 */
export function buildGrid(intersections: Intersection[]): Grid | null {
  if (intersections.length < MIN_GRID_CELLS) return null;

  const xValues = intersections.map((p) => p.x);
  const yValues = intersections.map((p) => p.y);

  const xPositions = deduplicatePositions(xValues, MERGE_TOLERANCE);
  const yPositions = deduplicatePositions(yValues, MERGE_TOLERANCE);

  // Need at least 2 positions on each axis to form cells
  if (xPositions.length < 2 || yPositions.length < 2) return null;

  const rows = yPositions.length - 1;
  const cols = xPositions.length - 1;

  if (rows * cols < MIN_GRID_CELLS) return null;

  // Create empty cell grid
  const cells: GridCell[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: GridCell[] = [];
    for (let c = 0; c < cols; c++) {
      row.push({
        row: r,
        col: c,
        x: xPositions[c],
        y: yPositions[r],
        width: xPositions[c + 1] - xPositions[c],
        height: yPositions[r + 1] - yPositions[r],
        text: "",
      });
    }
    cells.push(row);
  }

  return { rows, cols, xPositions, yPositions, cells };
}

// ============================================================
// Step 11: Map Text Items into Grid Cells
// ============================================================

/**
 * Map text items into grid cells using position matching.
 *
 * For each text item, finds the cell whose bounding box contains the
 * text item's position (using the text item's transform[4] for X and
 * transform[5] for Y). Text is appended to the cell with space separators.
 *
 * @param textItems - Raw TextItem[] from extractPageTextItems()
 * @param grid - Grid structure from buildGrid()
 * @param pageHeight - Page height for Y-coordinate conversion
 */
export function mapTextToCells(
  textItems: TextItem[],
  grid: Grid,
  pageHeight: number
): void {
  const tolerance = MERGE_TOLERANCE;

  for (const item of textItems) {
    if (!item.str.trim()) continue;

    // Text item position in PDF coordinates (bottom-left origin)
    const textX = item.transform[4];
    // Convert PDF Y (bottom-left) to top-left for grid matching
    const textY = pageHeight - item.transform[5];

    // Find which cell contains this text item
    let bestRow = -1;
    let bestCol = -1;

    // Binary search for row (Y position)
    for (let r = 0; r < grid.rows; r++) {
      const cellTop = grid.yPositions[r];
      const cellBottom = grid.yPositions[r + 1];
      if (textY >= cellTop - tolerance && textY < cellBottom + tolerance) {
        bestRow = r;
        break;
      }
    }

    // Binary search for column (X position)
    for (let c = 0; c < grid.cols; c++) {
      const cellLeft = grid.xPositions[c];
      const cellRight = grid.xPositions[c + 1];
      if (textX >= cellLeft - tolerance && textX < cellRight + tolerance) {
        bestCol = c;
        break;
      }
    }

    if (bestRow >= 0 && bestCol >= 0) {
      const cell = grid.cells[bestRow][bestCol];
      if (cell.text.length > 0) {
        cell.text += " ";
      }
      cell.text += item.str.trim();
    }
  }
}

// ============================================================
// Orchestrator: Extract Tables from a Page
// ============================================================

/**
 * Extract all tables from a PDF page using grid-based line detection.
 *
 * Orchestrates the full pipeline:
 *   1. Extract edges from the operator list
 *   2. Classify edges as horizontal/vertical
 *   3. Merge overlapping edges
 *   4. Find intersections
 *   5. Build grid
 *   6. Map text into cells
 *   7. Convert grid to Table[]
 *
 * Returns an empty array if no valid tables are detected.
 */
export async function extractTables(page: PDFPageProxy): Promise<Table[]> {
  // Step 1: Extract all edges
  const rawEdges = await extractEdges(page);
  if (rawEdges.length < MIN_EDGES_FOR_TABLE) return [];

  // Step 2: Classify as horizontal/vertical
  const classified = classifyEdges(rawEdges);
  if (classified.horizontal.length < 2 || classified.vertical.length < 2) {
    return [];
  }

  // Step 3: Merge overlapping edges
  const horizontal = mergeOverlappingEdges(classified.horizontal);
  const vertical = mergeOverlappingEdges(classified.vertical);

  // Step 4: Find intersections
  const intersections = findIntersections(horizontal, vertical);
  if (intersections.length < MIN_GRID_CELLS) return [];

  // Step 5: Build grid
  const grid = buildGrid(intersections);
  if (!grid) return [];

  // Step 6: Get text items and map to cells
  const { width: _w, height: pageHeight } = getPageDimensions(page);
  const textItems = await extractPageTextItems(page);
  mapTextToCells(textItems, grid, pageHeight);

  // Step 7: Convert grid to Table format
  return gridToTables(grid, page.pageNumber);
}

/**
 * Convert a grid to one or more Table objects.
 *
 * The first row of the grid is treated as headers. Rows where all
 * cells are empty are skipped. If the grid has no non-empty data rows,
 * no table is returned.
 *
 * For future enhancement: detect multiple tables within a single grid
 * by looking for empty-row separators.
 */
function gridToTables(grid: Grid, pageNumber?: number): Table[] {
  if (grid.rows < 2 || grid.cols < 1) return [];

  // Extract header row (first row)
  const headers = grid.cells[0].map((cell) => cell.text.trim());

  // Skip tables where all headers are empty
  if (!headers.some((h) => h.length > 0)) return [];

  // Extract data rows (skip first row = headers)
  const rows: string[][] = [];
  for (let r = 1; r < grid.rows; r++) {
    const row = grid.cells[r].map((cell) => cell.text.trim());
    // Skip entirely empty rows
    if (row.some((cell) => cell.length > 0)) {
      rows.push(row);
    }
  }

  // Skip tables with no data rows
  if (rows.length === 0) return [];

  // Compute bounding box from grid positions
  const bbox = {
    x: grid.xPositions[0],
    y: grid.yPositions[0],
    width:
      grid.xPositions[grid.xPositions.length - 1] - grid.xPositions[0],
    height:
      grid.yPositions[grid.yPositions.length - 1] - grid.yPositions[0],
  };

  return [
    {
      headers,
      rows,
      bbox,
      pageNumber,
    },
  ];
}

/**
 * Quick check: does a page likely contain a table?
 *
 * Performs a fast scan of the operator list counting constructPath
 * operations. If there are enough lines/rectangles, the page likely
 * has a grid-based table. This is faster than full extractTables()
 * and is used during Phase 0 scanning.
 *
 * @param page - PDF page proxy
 * @param threshold - Minimum number of path edges to consider as "has table" (default: 20)
 */
export async function pageHasTable(
  page: PDFPageProxy,
  threshold: number = 20
): Promise<boolean> {
  const OPS = await getOPS();
  const opList = await page.getOperatorList();
  let edgeCount = 0;

  for (let i = 0; i < opList.fnArray.length; i++) {
    if (opList.fnArray[i] === OPS.constructPath) {
      const subOps = opList.argsArray[i][0] as number[];
      for (const subOp of subOps) {
        if (
          subOp === SUB_OP_LINE_TO ||
          subOp === SUB_OP_RECTANGLE
        ) {
          edgeCount++;
          if (edgeCount >= threshold) return true;
        }
      }
    }
  }

  return false;
}
