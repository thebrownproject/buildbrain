import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

export const listByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("elementGroups")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

// Internal mutations for agent VM
export const create = internalMutation({
  args: {
    projectId: v.id("projects"),
    fileId: v.id("files"),
    elementType: v.string(),
    displayName: v.string(),
    count: v.number(),
    columnOrder: v.array(v.string()),
    columnLabels: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("elementGroups", {
      ...args,
      status: "partial",
      extractedAt: Date.now(),
    });
  },
});

export const markComplete = internalMutation({
  args: { groupId: v.id("elementGroups") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.groupId, { status: "complete" });
  },
});
