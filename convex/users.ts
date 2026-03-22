import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getOrCreate = mutation({
  args: {
    clerkId: v.string(),
    name: v.string(),
    email: v.string(),
    avatarUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("users", {
      clerkId: args.clerkId,
      name: args.name,
      email: args.email,
      avatarUrl: args.avatarUrl,
    });
  },
});

export const getPreferences = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    return user?.preferences ?? {};
  },
});

export const updatePreferences = mutation({
  args: {
    userId: v.id("users"),
    preferences: v.object({
      dockviewLayout: v.optional(v.any()),
      lastProjectId: v.optional(v.id("projects")),
    }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { preferences: args.preferences });
  },
});
