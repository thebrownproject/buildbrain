"use node";

// ============================================================
// PDF Extraction Library — Core pdf.js Lifecycle
// ============================================================
//
// Wraps unpdf (serverless-optimized pdfjs wrapper) to provide:
//   - loadPdf: open a PDF from a Uint8Array
//   - extractPageText: get full text from a page
//   - extractPageTextItems: get raw positioned text items
//   - getPageDimensions: get page width, height, orientation
//   - processAllPages: iterate all pages with a handler + cleanup
//
// Uses pdfjs-dist v4.x non-legacy build with explicit serverless options.
// The v5 legacy build has core-js polyfill conflicts with Node.js 22.

import { getDocument as _getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import path from "node:path";
import type { PageData } from "./types";

// pdfjs-dist types (TS declarations vary across versions, so we
// define minimal interfaces)

export interface TextItem {
  str: string;
  dir: string;
  transform: number[]; // [scaleX, skewX, skewY, scaleY, translateX, translateY]
  width: number;
  height: number;
  hasEOL: boolean;
}

export interface PDFPageProxy {
  pageNumber: number;
  getTextContent(): Promise<{ items: Array<TextItem | { type: string }> }>;
  getOperatorList(): Promise<{
    fnArray: number[];
    argsArray: unknown[][];
  }>;
  getViewport(params: { scale: number }): { width: number; height: number };
  cleanup(): void;
}

export interface PDFDocumentProxy {
  numPages: number;
  getPage(pageNumber: number): Promise<PDFPageProxy>;
  destroy(): Promise<void>;
}

// ============================================================
// Core Functions
// ============================================================

/**
 * Load a PDF document from raw binary data.
 *
 * Uses pdfjs-dist v4 non-legacy build with serverless-safe options.
 * The caller is responsible for calling doc.destroy() when done.
 */
export async function loadPdf(data: Uint8Array): Promise<PDFDocumentProxy> {
  const loadingTask = _getDocument({
    data,
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
    verbosity: 0,
  } as any);
  const doc = await loadingTask.promise;
  return doc as unknown as PDFDocumentProxy;
}

/**
 * Extract all text from a page as a single string.
 *
 * Joins text items with spaces, inserting newlines where the source
 * indicates end-of-line (hasEOL). Items without a `str` property
 * (e.g., marked content markers) are skipped.
 */
export async function extractPageText(page: PDFPageProxy): Promise<string> {
  const textContent = await page.getTextContent();
  const parts: string[] = [];

  for (const item of textContent.items) {
    // Skip non-text items (marked content begin/end markers)
    if (!("str" in item)) continue;
    const textItem = item as TextItem;

    parts.push(textItem.str);
    if (textItem.hasEOL) {
      parts.push("\n");
    }
  }

  return parts.join("").trim();
}

/**
 * Extract raw TextItem[] with positional data from a page.
 *
 * Each TextItem includes:
 *   - str: the text content
 *   - transform[4]: x position (in PDF coordinate space, bottom-left origin)
 *   - transform[5]: y position (in PDF coordinate space, bottom-left origin)
 *   - width, height: bounding box dimensions
 *
 * Use these for mapping text into grid cells during table extraction.
 */
export async function extractPageTextItems(
  page: PDFPageProxy
): Promise<TextItem[]> {
  const textContent = await page.getTextContent();
  const items: TextItem[] = [];

  for (const item of textContent.items) {
    if (!("str" in item)) continue;
    const textItem = item as TextItem;
    // Skip empty text items
    if (textItem.str.trim().length === 0 && !textItem.hasEOL) continue;
    items.push(textItem);
  }

  return items;
}

/**
 * Get page dimensions and orientation.
 *
 * Uses scale=1.0 so dimensions are in PDF points (1pt = 1/72 inch).
 */
export function getPageDimensions(page: PDFPageProxy): {
  width: number;
  height: number;
  orientation: "portrait" | "landscape";
} {
  const viewport = page.getViewport({ scale: 1.0 });
  return {
    width: viewport.width,
    height: viewport.height,
    orientation: viewport.width > viewport.height ? "landscape" : "portrait",
  };
}

/**
 * Convert PDF coordinate (bottom-left origin) to top-left origin.
 *
 * PDF uses bottom-left as (0,0). For grid/table work we want top-left.
 *
 * @param pdfY - Y coordinate in PDF space (bottom-left origin)
 * @param pageHeight - Total page height in PDF points
 * @returns Y coordinate in top-left-origin space
 */
export function pdfYToTopLeft(pdfY: number, pageHeight: number): number {
  return pageHeight - pdfY;
}

/**
 * Process all pages in a document sequentially.
 *
 * Calls the handler for each page, then cleans up the page to free memory.
 * This is critical for large PDFs where holding all pages in memory would
 * exceed the 512MB Convex action limit.
 *
 * @param doc - The PDF document
 * @param handler - Async function called for each page
 */
export async function processAllPages(
  doc: PDFDocumentProxy,
  handler: (page: PDFPageProxy, pageNumber: number) => Promise<void>
): Promise<void> {
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    try {
      await handler(page, i);
    } finally {
      page.cleanup();
    }
  }
}

/**
 * Process all pages and collect results into an array.
 *
 * Convenience wrapper around processAllPages that accumulates handler
 * return values. Each page is cleaned up after the handler completes.
 */
export async function processAllPagesCollect<T>(
  doc: PDFDocumentProxy,
  handler: (page: PDFPageProxy, pageNumber: number) => Promise<T>
): Promise<T[]> {
  const results: T[] = [];
  await processAllPages(doc, async (page, pageNumber) => {
    const result = await handler(page, pageNumber);
    results.push(result);
  });
  return results;
}

/**
 * Extract basic page data (text, dimensions, orientation) for all pages.
 *
 * This is the Phase 0 scanner: fast text extraction without table detection.
 * Returns PageData[] with hasTable=false (set later by table detection).
 */
export async function extractAllPageData(
  doc: PDFDocumentProxy
): Promise<PageData[]> {
  return processAllPagesCollect(doc, async (page, pageNumber) => {
    const text = await extractPageText(page);
    const dims = getPageDimensions(page);
    return {
      pageNumber,
      text,
      width: dims.width,
      height: dims.height,
      orientation: dims.orientation,
      hasTable: false,
    };
  });
}
