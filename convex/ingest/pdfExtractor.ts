"use node";

// ── PDF Extractor — Phase 1: Table Extraction ─────────────────────────────
// Deep extraction of schedule tables from pages identified by Phase 0.
// Extracts grid-based tables, classifies them as schedules, merges
// multi-page continuations, and stores structured rows for querying.

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  loadPdf,
  extractPageText,
} from "../pdf/parser";
import type { PDFDocumentProxy } from "../pdf/parser";
import { extractTables } from "../pdf/tables";
import {
  classifyTables,
  mergeSchedules,
  extractScheduleRows,
} from "../pdf/schedules";
import type { Schedule } from "../pdf/types";

/** Maximum schedule rows per batch insert mutation call. */
const BATCH_SIZE = 50;

/**
 * Phase 1: PDF table extraction.
 *
 * Processes pages identified as schedule pages by Phase 0:
 *   1. Queries pdfPages for pages with hasTable=true AND classification="schedule"
 *   2. Downloads the PDF and extracts tables from those pages
 *   3. Classifies tables as door/window/finish schedules
 *   4. Merges multi-page schedule continuations
 *   5. Extracts structured rows with mark + properties
 *   6. Batch-inserts pdfScheduleRow records
 *   7. Updates the manifest with schedule details
 */
export const extract = internalAction({
  args: {
    fileId: v.id("files"),
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    let doc: PDFDocumentProxy | null = null;

    try {
      // Update status to extracting
      await ctx.runMutation(internal.ingest.pipeline.updateExtractionStatus, {
        fileId: args.fileId,
        status: "extracting",
      });

      // Query pdfPages to find schedule pages with tables
      const allPages = await ctx.runQuery(
        internal.ingest.pipeline.getPdfPagesForFile,
        { fileId: args.fileId }
      );

      // Filter to pages that have tables AND are classified as schedules
      const schedulePages = allPages.filter(
        (p) => p.hasTable && p.classification === "schedule"
      );

      // If no schedule pages, skip to extracted
      if (schedulePages.length === 0) {
        await ctx.runMutation(internal.ingest.pipeline.updateExtractionStatus, {
          fileId: args.fileId,
          status: "extracted",
        });
        return;
      }

      // Get file record
      const file = await ctx.runQuery(internal.ingest.pipeline.getFile, {
        fileId: args.fileId,
      });

      // Download PDF
      const blob = await ctx.storage.get(file.storageId);
      if (!blob) {
        throw new Error("File not found in storage");
      }
      const arrayBuffer = await blob.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);

      // Load PDF
      doc = await loadPdf(data);

      // Extract tables from each schedule page
      const allSchedules: Schedule[] = [];

      for (const pageRecord of schedulePages) {
        const page = await doc.getPage(pageRecord.pageNumber);
        try {
          // Extract tables from this page
          const tables = await extractTables(page);
          if (tables.length === 0) continue;

          // Get page text for title matching
          const pageText = await extractPageText(page);

          // Classify tables
          const classified = classifyTables(
            tables,
            pageText,
            pageRecord.pageNumber
          );
          allSchedules.push(...classified);
        } finally {
          page.cleanup();
        }
      }

      // Merge multi-page schedules
      const mergedSchedules = mergeSchedules(allSchedules);

      // Extract rows and insert into database
      const scheduleSummaries: Array<{
        type: string;
        pages: number[];
        rowCount: number;
        headers: string[];
        confidence: number;
      }> = [];

      for (const schedule of mergedSchedules) {
        // Extract structured rows
        const rows = extractScheduleRows(schedule);
        if (rows.length === 0) continue;

        // Batch insert schedule rows
        const now = Date.now();
        let batch: Array<{
          fileId: typeof args.fileId;
          projectId: typeof args.projectId;
          scheduleType: string;
          mark: string;
          properties: Record<string, string>;
          sourcePages: number[];
          extractedAt: number;
        }> = [];

        for (const row of rows) {
          batch.push({
            fileId: args.fileId,
            projectId: args.projectId,
            scheduleType: schedule.type,
            mark: row.mark,
            properties: row.properties,
            sourcePages: row.sourcePages,
            extractedAt: now,
          });

          if (batch.length >= BATCH_SIZE) {
            await ctx.runMutation(
              internal.ingest.pipeline.insertPdfScheduleRows,
              { rows: batch }
            );
            batch = [];
          }
        }

        // Flush remaining rows
        if (batch.length > 0) {
          await ctx.runMutation(
            internal.ingest.pipeline.insertPdfScheduleRows,
            { rows: batch }
          );
          batch = [];
        }

        // Record schedule summary
        scheduleSummaries.push({
          type: schedule.type,
          pages: schedule.pages,
          rowCount: rows.length,
          headers: schedule.headers,
          confidence: schedule.confidence,
        });
      }

      // Destroy PDF document before mutations
      await doc.destroy();
      doc = null;

      // Update manifest with schedule details
      const currentFile = await ctx.runMutation(
        internal.ingest.pipeline.getFile,
        { fileId: args.fileId }
      );
      const updatedManifest = {
        ...(currentFile.manifest ?? {}),
        schedules: scheduleSummaries,
      };

      // Update file status to extracted
      await ctx.runMutation(internal.ingest.pipeline.updateExtractionStatus, {
        fileId: args.fileId,
        status: "extracted",
        manifest: updatedManifest,
      });

      // Also update legacy PDF metadata
      if (scheduleSummaries.length > 0) {
        await ctx.runMutation(internal.files.updatePdfMeta, {
          fileId: args.fileId,
          schedulesFound: scheduleSummaries.map((s) => ({
            type: s.type,
            page: s.pages[0],
            rowCount: s.rowCount,
          })),
        });
      }
    } catch (error) {
      // Clean up on error
      if (doc) {
        try {
          await doc.destroy();
        } catch {
          // Ignore destroy errors during cleanup
        }
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      await ctx.runMutation(internal.ingest.pipeline.updateExtractionStatus, {
        fileId: args.fileId,
        status: "failed",
        error: `PDF extraction failed: ${errorMessage}`,
      });
    }
  },
});
