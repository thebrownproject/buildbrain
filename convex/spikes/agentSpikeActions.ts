/**
 * Spike Test: @convex-dev/agent thread + message mutations/queries
 *
 * Demonstrates the complete flow:
 *   1. Create a thread (mutation)
 *   2. Send a user message + kick off streaming (mutation -> scheduled action)
 *   3. Query messages with streaming support (query)
 *
 * NOTE: The streaming internalAction lives in agentSpikeStream.ts (a "use node"
 * file) because it calls LLM APIs. This file must NOT use "use node" since it
 * exports queries and mutations.
 */

import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query } from "../_generated/server";
import { internal } from "../_generated/api";
import { components } from "../_generated/api";
import {
  createThread,
  saveMessage,
  listUIMessages,
  syncStreams,
  vStreamArgs,
} from "@convex-dev/agent";

// ── 1. Create Thread ────────────────────────────────────────────────────
// Uses the standalone `createThread` function from @convex-dev/agent.
// This works in a mutation (no LLM call needed).
export const createSpikeThread = mutation({
  args: {
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // createThread (standalone) returns the threadId string directly
    const threadId = await createThread(ctx, components.agent, {
      userId: args.userId ?? undefined,
      title: "Spike Test Thread",
    });
    return { threadId };
  },
});

// ── 2. Send Message ─────────────────────────────────────────────────────
// Saves the user message into the agent's thread, then schedules the
// streaming action to generate the agent response.
export const sendSpikeMessage = mutation({
  args: {
    threadId: v.string(),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    // Save the user's message to the agent thread
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      message: {
        role: "user",
        content: args.prompt,
      },
    });

    // Schedule the streaming action (in agentSpikeStream.ts, a "use node" file)
    await ctx.scheduler.runAfter(0, internal.spikes.agentSpikeStream.streamResponse, {
      threadId: args.threadId,
      promptMessageId: messageId,
    });

    return { messageId };
  },
});

// ── 3. List Messages (query) ────────────────────────────────────────────
// Returns paginated UIMessages merged with any active stream deltas.
// The frontend calls this via useUIMessages (see SPIKE_NOTES.md).
export const listSpikeMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    const result = await listUIMessages(ctx, components.agent, {
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
    });

    // Merge in any active streaming data so the frontend sees real-time tokens
    const streams = await syncStreams(ctx, components.agent, {
      threadId: args.threadId,
      streamArgs: args.streamArgs,
    });

    return { ...result, streams };
  },
});
