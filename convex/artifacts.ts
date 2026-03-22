import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

export const listByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const artifacts = await ctx.db
      .query("artifacts")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(200);
    // Return metadata only (no content) for list view
    return artifacts.map(({ contentInline, contentStorageId, ...meta }) => ({
      ...meta,
      hasContent: contentInline !== undefined || contentStorageId !== undefined,
    }));
  },
});

export const getContent = query({
  args: { artifactId: v.id("artifacts") },
  handler: async (ctx, args) => {
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact) throw new Error("Artifact not found");

    if (artifact.contentInline !== undefined) {
      return artifact.contentInline;
    }

    if (artifact.contentStorageId) {
      const url = await ctx.storage.getUrl(artifact.contentStorageId);
      return { storageUrl: url };
    }

    return null;
  },
});

// Internal mutations for agent VM
export const create = internalMutation({
  args: {
    projectId: v.id("projects"),
    threadId: v.optional(v.id("threads")),
    messageId: v.optional(v.id("messages")),
    name: v.string(),
    type: v.union(
      v.literal("element_list"),
      v.literal("quantity_takeoff"),
      v.literal("pdf_schedule"),
      v.literal("cross_validation"),
      v.literal("compliance_check"),
      v.literal("model_summary")
    ),
    format: v.union(
      v.literal("csv"),
      v.literal("md"),
      v.literal("pdf"),
      v.literal("json")
    ),
    status: v.union(
      v.literal("generating"),
      v.literal("complete"),
      v.literal("failed")
    ),
    summary: v.optional(v.string()),
    contentInline: v.optional(v.any()),
    contentStorageId: v.optional(v.id("_storage")),
    elementType: v.optional(v.string()),
    sourceFile: v.optional(v.string()),
    createdBy: v.union(v.literal("user"), v.literal("agent")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("artifacts", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const updateStatus = internalMutation({
  args: {
    artifactId: v.id("artifacts"),
    status: v.union(
      v.literal("generating"),
      v.literal("complete"),
      v.literal("failed")
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.artifactId, { status: args.status });
  },
});
