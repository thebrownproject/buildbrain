import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

export const list = query({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("streamDeltas")
      .withIndex("by_message_index", (q) => q.eq("messageId", args.messageId))
      .collect();
  },
});

// Internal mutations for agent VM
export const write = internalMutation({
  args: {
    messageId: v.id("messages"),
    text: v.string(),
    index: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("streamDeltas", {
      messageId: args.messageId,
      text: args.text,
      index: args.index,
      createdAt: Date.now(),
    });
  },
});

export const cleanup = internalMutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const deltas = await ctx.db
      .query("streamDeltas")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .collect();
    for (const delta of deltas) {
      await ctx.db.delete(delta._id);
    }
  },
});
