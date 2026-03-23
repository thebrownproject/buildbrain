// ── Document Intelligence Pipeline — Orchestration ─────────────────────────
// Mutations and queries for pipeline status tracking and triggering.
// NO "use node" — this file contains mutations/queries only.

import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "../_generated/server";
import { internal } from "../_generated/api";

// ── Trigger Pipeline ────────────────────────────────────────────────────────

/**
 * Trigger the document intelligence pipeline for a newly uploaded file.
 *
 * Called after file upload. Sets extractionStatus to "scanning" and schedules
 * the appropriate Phase 0 scanner based on file type.
 */
export const triggerPipeline = internalMutation({
  args: {
    fileId: v.id("files"),
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId);
    if (!file) {
      throw new Error(`File not found: ${args.fileId}`);
    }

    // Set status to scanning
    await ctx.db.patch(args.fileId, {
      extractionStatus: "scanning",
    });

    // Schedule the appropriate scanner based on file type
    if (file.type === "ifc") {
      await ctx.scheduler.runAfter(
        0,
        internal.ingest.ifcScanner.scan,
        { fileId: args.fileId, projectId: args.projectId }
      );
    } else if (file.type === "pdf") {
      await ctx.scheduler.runAfter(
        0,
        internal.ingest.pdfScanner.scan,
        { fileId: args.fileId, projectId: args.projectId }
      );
    } else {
      // Unknown file type — mark as failed
      await ctx.db.patch(args.fileId, {
        extractionStatus: "failed",
        extractionError: `Unsupported file type: ${file.type}`,
      });
    }
  },
});

// ── Update Extraction Status ────────────────────────────────────────────────

/**
 * Update the extraction status of a file.
 *
 * Used by scanner and extractor actions to report progress, completion,
 * or failure. Optionally updates the manifest and/or error message.
 */
export const updateExtractionStatus = internalMutation({
  args: {
    fileId: v.id("files"),
    status: v.string(),
    manifest: v.optional(v.any()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {
      extractionStatus: args.status,
    };

    if (args.manifest !== undefined) {
      patch.manifest = args.manifest;
    }

    if (args.error !== undefined) {
      patch.extractionError = args.error;
    }

    await ctx.db.patch(args.fileId, patch);
  },
});

// ── Insert PDF Page ─────────────────────────────────────────────────────────

/**
 * Insert a single pdfPage record during Phase 0 scanning.
 */
export const insertPdfPage = internalMutation({
  args: {
    fileId: v.id("files"),
    projectId: v.id("projects"),
    pageNumber: v.number(),
    text: v.string(),
    classification: v.optional(v.string()),
    drawingNumber: v.optional(v.string()),
    drawingTitle: v.optional(v.string()),
    hasTable: v.boolean(),
    extractedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("pdfPages", args);
  },
});

// ── Batch Insert PDF Schedule Rows ──────────────────────────────────────────

/**
 * Insert a batch of pdfScheduleRow records during Phase 1 extraction.
 * Bounded to prevent mutation size limit issues.
 */
export const insertPdfScheduleRows = internalMutation({
  args: {
    rows: v.array(
      v.object({
        fileId: v.id("files"),
        projectId: v.id("projects"),
        scheduleType: v.string(),
        mark: v.string(),
        properties: v.any(),
        sourcePages: v.array(v.number()),
        extractedAt: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    for (const row of args.rows) {
      await ctx.db.insert("pdfScheduleRows", row);
    }
  },
});

// ── Create Element Group ────────────────────────────────────────────────────

/**
 * Create an elementGroup record during Phase 1 IFC extraction.
 */
export const createElementGroup = internalMutation({
  args: {
    projectId: v.id("projects"),
    fileId: v.id("files"),
    elementType: v.string(),
    displayName: v.string(),
    count: v.number(),
    columnOrder: v.array(v.string()),
    columnLabels: v.optional(v.any()),
    extractedAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("elementGroups", {
      projectId: args.projectId,
      fileId: args.fileId,
      elementType: args.elementType,
      displayName: args.displayName,
      count: args.count,
      columnOrder: args.columnOrder,
      columnLabels: args.columnLabels,
      status: "partial",
      extractedAt: args.extractedAt,
    });
  },
});

// ── Batch Insert Elements ───────────────────────────────────────────────────

/**
 * Insert a batch of element records during Phase 1 IFC extraction.
 * Bounded to 50 per call to stay within mutation size limits.
 */
export const insertElements = internalMutation({
  args: {
    elements: v.array(
      v.object({
        groupId: v.id("elementGroups"),
        projectId: v.id("projects"),
        globalId: v.string(),
        name: v.optional(v.string()),
        properties: v.any(),
      })
    ),
  },
  handler: async (ctx, args) => {
    for (const element of args.elements) {
      await ctx.db.insert("elements", element);
    }
  },
});

// ── Mark Element Group Complete ─────────────────────────────────────────────

/**
 * Update an elementGroup's status to "complete" after all elements are inserted.
 */
export const markGroupComplete = internalMutation({
  args: {
    groupId: v.id("elementGroups"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.groupId, { status: "complete" });
  },
});

// ── Query: Get PDF Pages for File ───────────────────────────────────────────

/**
 * Query pdfPages for a specific file, used by the PDF extractor to find
 * schedule pages that need table extraction.
 */
export const getPdfPagesForFile = internalQuery({
  args: {
    fileId: v.id("files"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("pdfPages")
      .withIndex("by_file_page", (q) => q.eq("fileId", args.fileId))
      .take(500);
  },
});

// ── Query: Get File Record ──────────────────────────────────────────────────

/**
 * Internal query to get a file record by ID. Used by scanners to access
 * storageId and file metadata.
 */
export const getFile = internalQuery({
  args: {
    fileId: v.id("files"),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId);
    if (!file) throw new Error(`File not found: ${args.fileId}`);
    return file;
  },
});

// ── Delete Old Extraction Data ──────────────────────────────────────────────

/**
 * Delete existing pdfPages and pdfScheduleRows for a file.
 * Called before re-running the pipeline to make it idempotent.
 */
export const deleteOldPdfData = internalMutation({
  args: {
    fileId: v.id("files"),
  },
  handler: async (ctx, args) => {
    // Delete pdfPages
    const pages = await ctx.db
      .query("pdfPages")
      .withIndex("by_file_page", (q) => q.eq("fileId", args.fileId))
      .take(500);
    for (const page of pages) {
      await ctx.db.delete(page._id);
    }

    // Delete pdfScheduleRows
    const rows = await ctx.db
      .query("pdfScheduleRows")
      .withIndex("by_file", (q) => q.eq("fileId", args.fileId))
      .take(500);
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
  },
});

/**
 * Delete existing element groups and elements for a file.
 * Called before re-running IFC extraction to make it idempotent.
 */
export const deleteOldIfcData = internalMutation({
  args: {
    fileId: v.id("files"),
  },
  handler: async (ctx, args) => {
    // Find all element groups for this file
    const groups = await ctx.db
      .query("elementGroups")
      .withIndex("by_file", (q) => q.eq("fileId", args.fileId))
      .take(100);

    for (const group of groups) {
      // Delete elements in this group (batch)
      const elements = await ctx.db
        .query("elements")
        .withIndex("by_group", (q) => q.eq("groupId", group._id))
        .take(500);
      for (const element of elements) {
        await ctx.db.delete(element._id);
      }
      // Delete the group itself
      await ctx.db.delete(group._id);
    }
  },
});

// ── Public Query: Get Extraction Status ─────────────────────────────────────

/**
 * Get the extraction status for a file.
 * Public query for frontend to display pipeline progress.
 */
export const getExtractionStatus = query({
  args: {
    fileId: v.id("files"),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId);
    if (!file) return null;

    return {
      status: file.extractionStatus ?? "pending",
      manifest: file.manifest ?? null,
      error: file.extractionError ?? null,
    };
  },
});
