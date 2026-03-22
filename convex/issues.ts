import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";

export const listByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("issues")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

// Public mutation: user resolves/dismisses issues
export const updateStatus = mutation({
  args: {
    issueId: v.id("issues"),
    status: v.union(
      v.literal("open"),
      v.literal("resolved"),
      v.literal("dismissed")
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.issueId, { status: args.status });
  },
});

// Internal mutations for agent VM
export const create = internalMutation({
  args: {
    projectId: v.id("projects"),
    artifactId: v.optional(v.id("artifacts")),
    severity: v.union(
      v.literal("error"),
      v.literal("warning"),
      v.literal("info"),
      v.literal("pass")
    ),
    title: v.string(),
    description: v.string(),
    source: v.string(),
    elementRef: v.optional(v.string()),
    elementGuid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("issues", {
      ...args,
      status: "open",
      createdAt: Date.now(),
    });
  },
});

export const internalUpdateStatus = internalMutation({
  args: {
    issueId: v.id("issues"),
    status: v.union(
      v.literal("open"),
      v.literal("resolved"),
      v.literal("dismissed")
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.issueId, { status: args.status });
  },
});
