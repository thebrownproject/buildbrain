import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";

export const list = query({
  args: {
    threadId: v.id("threads"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_thread_time", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const get = query({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.messageId);
  },
});

const MAX_QUEUED_JOBS_PER_THREAD = 3;

export const send = mutation({
  args: {
    threadId: v.id("threads"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("Thread not found");

    // Check queued job limit (query each active status via index)
    const queued = await ctx.db
      .query("agentJobs")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", thread.projectId).eq("status", "queued")
      )
      .take(MAX_QUEUED_JOBS_PER_THREAD);
    const claimed = await ctx.db
      .query("agentJobs")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", thread.projectId).eq("status", "claimed")
      )
      .take(MAX_QUEUED_JOBS_PER_THREAD);
    const running = await ctx.db
      .query("agentJobs")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", thread.projectId).eq("status", "running")
      )
      .take(MAX_QUEUED_JOBS_PER_THREAD);
    const queuedCount = queued.length + claimed.length + running.length;
    if (queuedCount >= MAX_QUEUED_JOBS_PER_THREAD) {
      throw new Error(
        "Agent is busy processing previous requests. Please wait."
      );
    }

    // Create user message
    const messageId = await ctx.db.insert("messages", {
      threadId: args.threadId,
      role: "user",
      content: args.content,
      status: "complete",
      createdAt: Date.now(),
    });

    // Queue agent job
    await ctx.db.insert("agentJobs", {
      projectId: thread.projectId,
      type: "chat_response",
      status: "queued",
      input: { threadId: args.threadId, messageId, message: args.content },
      messageId,
      queuedAt: Date.now(),
    });

    // Update thread timestamp
    await ctx.db.patch(args.threadId, { updatedAt: Date.now() });

    return messageId;
  },
});

// Internal mutations for agent VM
export const createAssistant = internalMutation({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    return await ctx.db.insert("messages", {
      threadId: args.threadId,
      role: "assistant",
      content: "",
      status: "streaming",
      createdAt: Date.now(),
    });
  },
});

export const finalize = internalMutation({
  args: {
    messageId: v.id("messages"),
    content: v.string(),
    toolCalls: v.optional(
      v.array(
        v.object({
          id: v.string(),
          tool: v.string(),
          displayName: v.optional(v.string()),
          args: v.any(),
          result: v.optional(v.string()),
          status: v.union(
            v.literal("pending"),
            v.literal("running"),
            v.literal("complete"),
            v.literal("error")
          ),
          ephemeral: v.optional(v.boolean()),
        })
      )
    ),
    artifactIds: v.optional(v.array(v.id("artifacts"))),
    elementRefs: v.optional(
      v.array(
        v.object({
          globalId: v.string(),
          label: v.optional(v.string()),
        })
      )
    ),
    suggestions: v.optional(
      v.array(
        v.object({
          label: v.string(),
          prompt: v.string(),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    const { messageId, ...fields } = args;
    await ctx.db.patch(messageId, { ...fields, status: "complete" });

    // Clean up stream deltas (bounded to stay within transaction limits)
    const deltas = await ctx.db
      .query("streamDeltas")
      .withIndex("by_message", (q) => q.eq("messageId", messageId))
      .take(500);
    for (const delta of deltas) {
      await ctx.db.delete(delta._id);
    }
  },
});

export const setError = internalMutation({
  args: { messageId: v.id("messages"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, {
      status: "error",
      content: args.error,
    });
  },
});
