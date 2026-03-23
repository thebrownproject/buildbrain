"use node";

/**
 * Spike Test: streaming internalAction (Node.js runtime required)
 *
 * Separated from agentSpikeActions.ts because:
 * - This file needs "use node" for LLM API calls via @convex-dev/agent
 * - Queries/mutations cannot live in "use node" files
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { spikeTestAgent } from "./agentSpike";

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
