/**
 * Internal queries used by agent tools.
 *
 * Tools run as Node.js actions ("use node") and cannot access ctx.db directly.
 * They call these internal queries via ctx.runQuery(internal.tools.queries.xxx).
 *
 * NO "use node" here — queries must run in the default Convex runtime.
 */

import { v } from "convex/values";
import { internalQuery } from "../_generated/server";

// ── Element Groups ─────────────────────────────────────────────

/** List element groups for a project, optionally filtered by elementType. */
export const listElementGroups = internalQuery({
  args: {
    projectId: v.id("projects"),
    elementType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const groups = await ctx.db
      .query("elementGroups")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(100);

    if (args.elementType) {
      return groups.filter((g) => g.elementType === args.elementType);
    }
    return groups;
  },
});

/** List element groups for a specific file, optionally filtered by elementType. */
export const listElementGroupsByFile = internalQuery({
  args: {
    fileId: v.id("files"),
    elementType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const groups = await ctx.db
      .query("elementGroups")
      .withIndex("by_file", (q) => q.eq("fileId", args.fileId))
      .take(100);

    if (args.elementType) {
      return groups.filter((g) => g.elementType === args.elementType);
    }
    return groups;
  },
});

// ── Elements ───────────────────────────────────────────────────

/** Get elements for a group (bounded to prevent overloading). */
export const listElementsByGroup = internalQuery({
  args: {
    groupId: v.id("elementGroups"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 200;
    return await ctx.db
      .query("elements")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .take(limit);
  },
});

// ── PDF Schedule Rows ──────────────────────────────────────────

/** List schedule rows for a project by schedule type. */
export const listScheduleRows = internalQuery({
  args: {
    projectId: v.id("projects"),
    scheduleType: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 500;
    return await ctx.db
      .query("pdfScheduleRows")
      .withIndex("by_project_schedule", (q) =>
        q.eq("projectId", args.projectId).eq("scheduleType", args.scheduleType)
      )
      .take(limit);
  },
});

// ── PDF Pages ──────────────────────────────────────────────────

/** List pages for a file, ordered by page number. */
export const listPagesByFile = internalQuery({
  args: {
    fileId: v.id("files"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 500;
    return await ctx.db
      .query("pdfPages")
      .withIndex("by_file_page", (q) => q.eq("fileId", args.fileId))
      .take(limit);
  },
});

/** Full-text search across PDF pages. */
export const searchPages = internalQuery({
  args: {
    query: v.string(),
    projectId: v.optional(v.id("projects")),
    fileId: v.optional(v.id("files")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;

    let q = ctx.db
      .query("pdfPages")
      .withSearchIndex("search_text", (search) => {
        let s = search.search("text", args.query);
        if (args.fileId) {
          s = s.eq("fileId", args.fileId);
        }
        if (args.projectId) {
          s = s.eq("projectId", args.projectId);
        }
        return s;
      });

    return await q.take(limit);
  },
});

// ── Files ──────────────────────────────────────────────────────

/** Get a file by ID (internal). */
export const getFile = internalQuery({
  args: { fileId: v.id("files") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.fileId);
  },
});

// ── Project Threads ────────────────────────────────────────────

/** Get a project thread by agent thread ID. */
export const getProjectThread = internalQuery({
  args: { agentThreadId: v.string() },
  handler: async (ctx, args) => {
    const thread = await ctx.db
      .query("projectThreads")
      .withIndex("by_thread", (q) => q.eq("agentThreadId", args.agentThreadId))
      .first();
    return thread;
  },
});
