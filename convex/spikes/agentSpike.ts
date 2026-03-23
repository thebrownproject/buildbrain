"use node";

/**
 * Spike Test: @convex-dev/agent core agent definition
 *
 * Validates that Agent + createTool from @convex-dev/agent v0.6.x
 * works with AI SDK v6 (ai@^6.0.35), Anthropic for language model,
 * and OpenAI for embeddings.
 */

import { Agent, createTool } from "@convex-dev/agent";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { components } from "../_generated/api";
import { z } from "zod";

// ── Test Tool ───────────────────────────────────────────────────────────
// A minimal tool to validate createTool's v0.6.x API surface:
// - inputSchema (not args)
// - execute (not handler)
const echoTool = createTool({
  description: "Echo back a message for testing",
  inputSchema: z.object({
    message: z.string().describe("Message to echo"),
  }),
  execute: async (_ctx, input) => {
    return `Echo: ${input.message}`;
  },
});

// ── Test Agent ──────────────────────────────────────────────────────────
// Anthropic provides the language model; OpenAI provides embeddings
// (Anthropic does NOT offer an embedding model).
export const spikeTestAgent = new Agent(components.agent, {
  name: "SpikeTest",
  languageModel: anthropic("claude-sonnet-4-6"),
  embeddingModel: openai.embedding("text-embedding-3-small"),
  instructions:
    "You are a test agent for the BuildBrain spike. " +
    "When asked to test, use the echo tool to echo the user's message back.",
  tools: { echo: echoTool },
  maxSteps: 3,
});
