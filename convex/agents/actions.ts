/**
 * BuildBrain Agent Mutations & Queries
 *
 * Thread creation, message sending, and message listing for the agent.
 * Uses standalone functions from @convex-dev/agent (not Agent class methods)
 * because mutations/queries run in the default Convex runtime, not Node.js.
 *
 * IMPORTANT: This file must NOT have "use node" and must NOT import from
 * definition.ts or streaming.ts (which are "use node" files).
 */

import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query } from "../_generated/server";
import { components, internal } from "../_generated/api";
import {
  createThread,
  saveMessage,
  listUIMessages,
  syncStreams,
  vStreamArgs,
} from "@convex-dev/agent";

// ── Create Thread ────────────────────────────────────────────────────────
// Creates a new agent thread and links it to a project via the projectThreads table.
export const createNewThread = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // createThread (standalone) returns the threadId string
    const threadId = await createThread(ctx, components.agent, {
      userId: args.userId,
    });

    // Link the agent thread to the project
    await ctx.db.insert("projectThreads", {
      projectId: args.projectId,
      agentThreadId: threadId,
      userId: args.userId,
      createdAt: Date.now(),
    });

    return { threadId };
  },
});

// ── Send Message ─────────────────────────────────────────────────────────
// Saves the user message into the agent thread, then schedules the
// streaming action to generate the agent response.
export const sendMessage = mutation({
  args: {
    threadId: v.string(),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    // Save the user's message to the agent thread
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      message: {
        role: "user" as const,
        content: args.prompt,
      },
    });

    // Schedule the streaming action (in streaming.ts, a "use node" file)
    await ctx.scheduler.runAfter(
      0,
      internal.agents.streaming.streamResponse,
      {
        threadId: args.threadId,
        promptMessageId: messageId,
      },
    );

    return { messageId };
  },
});

// ── List Messages ────────────────────────────────────────────────────────
// Returns paginated UIMessages merged with any active stream deltas.
// The frontend calls this via useUIMessages from @convex-dev/agent/react.
export const listMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    // Merge in any active streaming data so the frontend sees real-time tokens
    const streams = await syncStreams(ctx, components.agent, {
      threadId: args.threadId,
      streamArgs: args.streamArgs,
    });

    // Get paginated messages in UIMessage format
    const paginated = await listUIMessages(ctx, components.agent, {
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
    });

    return { ...paginated, streams };
  },
});

// ── Get Threads by Project ───────────────────────────────────────────────
// Returns all agent threads linked to a project.
export const getThreadsByProject = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projectThreads")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(50);
  },
});
