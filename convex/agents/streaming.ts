"use node";

/**
 * BuildBrain Streaming Action
 *
 * Internal action that continues an agent thread and streams the LLM response.
 * Runs in the Node.js runtime because it makes LLM API calls.
 *
 * IMPORTANT: This file uses "use node" and can ONLY contain actions.
 * Queries and mutations must live in actions.ts (no "use node").
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { buildBrainAgent } from "./definition";

export const streamResponse = internalAction({
  args: {
    threadId: v.string(),
    promptMessageId: v.string(),
  },
  handler: async (ctx, args) => {
    // Continue the existing thread — this loads context + history automatically
    const { thread } = await buildBrainAgent.continueThread(ctx, {
      threadId: args.threadId,
    });

    // Stream the LLM response with real-time delta persistence.
    // saveStreamDeltas writes word-chunked deltas to the agent component's
    // internal tables, which syncStreams merges into query results for the frontend.
    const result = await thread.streamText(
      { promptMessageId: args.promptMessageId },
      {
        saveStreamDeltas: {
          chunking: "word",
          throttleMs: 100,
        },
      },
    );

    // Consume the full stream so all steps complete and messages are persisted.
    await result.consumeStream();
  },
});
