import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const get = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.projectId);
  },
});

export const listByUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.userId))
      .collect();
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    ownerId: v.id("users"),
    metadata: v.optional(
      v.object({
        buildingClass: v.optional(v.string()),
        state: v.optional(v.string()),
        constructionType: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("projects", {
      name: args.name,
      description: args.description,
      ownerId: args.ownerId,
      metadata: args.metadata,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    metadata: v.optional(
      v.object({
        buildingClass: v.optional(v.string()),
        state: v.optional(v.string()),
        constructionType: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const { projectId, ...fields } = args;
    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (fields.name !== undefined) updates.name = fields.name;
    if (fields.description !== undefined) updates.description = fields.description;
    if (fields.metadata !== undefined) updates.metadata = fields.metadata;
    await ctx.db.patch(projectId, updates);
  },
});
