/**
 * Spike Test: @convex-dev/agent thread + message mutations/actions
 *
 * Demonstrates the complete flow:
 *   1. Create a thread (mutation)
 *   2. Send a user message + kick off streaming (mutation -> scheduled action)
 *   3. Stream the agent response (internal action)
 *   4. Query messages with streaming support (query)
 */

import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, internalAction, query } from "../_generated/server";
import { internal } from "../_generated/api";
import { components } from "../_generated/api";
import {
  createThread,
  saveMessage,
  listUIMessages,
  syncStreams,
  vStreamArgs,
} from "@convex-dev/agent";
import { spikeTestAgent } from "./agentSpike";

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

    // Schedule the streaming action to run in the background
    await ctx.scheduler.runAfter(0, internal.spikes.agentSpikeActions.streamResponse, {
      threadId: args.threadId,
      promptMessageId: messageId,
    });

    return { messageId };
  },
});

// ── 3. Stream Response (internal action) ────────────────────────────────
// Continues the thread and calls streamText with saveStreamDeltas enabled.
// This runs in a Convex action (Node.js runtime) because it calls the LLM.
export const streamResponse = internalAction({
  args: {
    threadId: v.string(),
    promptMessageId: v.string(),
  },
  handler: async (ctx, args) => {
    const { thread } = await spikeTestAgent.continueThread(ctx, {
      threadId: args.threadId,
    });

    // streamText with delta persistence for real-time streaming to the frontend
    const result = await thread.streamText(
      { promptMessageId: args.promptMessageId },
      { saveStreamDeltas: true },
    );

    // Consume the full stream so all steps complete and messages are saved.
    // In a real app you might also do something with the text, e.g. log it.
    const _text = await result.text;
    return { text: _text };
  },
});

// ── 4. List Messages (query) ────────────────────────────────────────────
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
