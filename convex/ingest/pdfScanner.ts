"use node";

// ── PDF Scanner — Phase 0: Manifest Generation ────────────────────────────
// Fast scan of PDF file to produce a manifest: page classifications,
// drawing numbers, table presence. The manifest gives the agent instant
// orientation about the document's contents.

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  loadPdf,
  extractPageText,
  processAllPages,
} from "../pdf/parser";
import type { PDFDocumentProxy } from "../pdf/parser";
import { classifyPage, extractDrawingNumber, extractDrawingTitle } from "../pdf/classifier";
import { pageHasTable } from "../pdf/tables";
import type { PDFManifest, PDFManifestEntry } from "../pdf/types";

/**
 * Phase 0: PDF manifest generation.
 *
 * Fast scan that:
 *   1. Downloads the PDF from Convex storage
 *   2. For each page: extracts text, classifies, finds drawing numbers, checks for tables
 *   3. Inserts pdfPage records for each page
 *   4. Builds and stores a PDFManifest
 *   5. Schedules Phase 1 table extraction
 *
 * Target: <5 seconds for typical construction PDFs.
 */
export const scan = internalAction({
  args: {
    fileId: v.id("files"),
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    let doc: PDFDocumentProxy | null = null;

    try {
      // Get file record to access storageId
      const file = await ctx.runQuery(internal.ingest.pipeline.getFile, {
        fileId: args.fileId,
      });

      // Download file from Convex storage
      const blob = await ctx.storage.get(file.storageId);
      if (!blob) {
        throw new Error("File not found in storage");
      }
      const arrayBuffer = await blob.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);

      // Delete old extraction data for idempotency
      await ctx.runMutation(internal.ingest.pipeline.deleteOldPdfData, {
        fileId: args.fileId,
      });

      // Load PDF
      doc = await loadPdf(data);

      // Process each page
      const manifestPages: PDFManifestEntry[] = [];
      const now = Date.now();

      await processAllPages(doc, async (page, pageNumber) => {
        // Extract text
        const text = await extractPageText(page);

        // Extract drawing number
        const drawingNumber = extractDrawingNumber(text);

        // Classify page
        const classification = classifyPage(text, drawingNumber);

        // Extract drawing title
        const drawingTitle = extractDrawingTitle(text);

        // Check for table presence (fast heuristic)
        const hasTable = await pageHasTable(page);

        // Insert pdfPage record
        await ctx.runMutation(internal.ingest.pipeline.insertPdfPage, {
          fileId: args.fileId,
          projectId: args.projectId,
          pageNumber,
          text,
          classification: classification ?? undefined,
          drawingNumber,
          drawingTitle,
          hasTable,
          extractedAt: now,
        });

        // Build manifest entry
        manifestPages.push({
          pageNumber,
          classification,
          drawingNumber,
          drawingTitle,
          hasTable,
          textPreview: text.slice(0, 100),
        });
      });

      // Build manifest
      const manifest: PDFManifest = {
        fileName: file.name,
        pageCount: doc.numPages,
        pages: manifestPages,
        schedules: [], // Will be populated during Phase 1
      };

      // Destroy PDF document before mutations
      await doc.destroy();
      doc = null;

      // Update file with manifest and status
      await ctx.runMutation(internal.ingest.pipeline.updateExtractionStatus, {
        fileId: args.fileId,
        status: "scanned",
        manifest,
      });

      // Also update legacy PDF metadata for backward compatibility
      await ctx.runMutation(internal.files.updatePdfMeta, {
        fileId: args.fileId,
        pageCount: manifest.pageCount,
      });

      // Schedule Phase 1: table extraction
      await ctx.scheduler.runAfter(
        0,
        internal.ingest.pdfExtractor.extract,
        { fileId: args.fileId, projectId: args.projectId }
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      await ctx.runMutation(internal.ingest.pipeline.updateExtractionStatus, {
        fileId: args.fileId,
        status: "failed",
        error: `PDF scan failed: ${errorMessage}`,
      });

      throw error;
    } finally {
      if (doc) {
        try { await doc.destroy(); } catch { /* ignore cleanup errors */ }
      }
    }
  },
});
