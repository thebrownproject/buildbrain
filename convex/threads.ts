import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";

export const getByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("threads")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
  },
});

export const create = mutation({
  args: { projectId: v.id("projects"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("threads", {
      projectId: args.projectId,
      userId: args.userId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Agent VM: get full context for a thread
export const getContext = internalQuery({
  args: { threadId: v.id("threads"), messageLimit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("Thread not found");

    const project = await ctx.db.get(thread.projectId);

    const files = await ctx.db
      .query("files")
      .withIndex("by_project", (q) => q.eq("projectId", thread.projectId))
      .collect();

    const limit = args.messageLimit ?? 10;
    const recentMessages = await ctx.db
      .query("messages")
      .withIndex("by_thread_time", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(limit);

    return {
      thread,
      project,
      files,
      recentMessages: recentMessages.reverse(),
    };
  },
});

export const updateSummary = internalMutation({
  args: { threadId: v.id("threads"), contextSummary: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.threadId, {
      contextSummary: args.contextSummary,
      updatedAt: Date.now(),
    });
  },
});
