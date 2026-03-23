"use node";

/**
 * BuildBrain Agent Definition
 *
 * Defines the core agent using @convex-dev/agent v0.6.x with:
 * - Anthropic Claude for language model
 * - OpenAI for embeddings (Anthropic does not offer embeddings)
 * - No tools yet (added in Wave 3)
 *
 * IMPORTANT: This file uses "use node" and can ONLY contain actions.
 * Queries and mutations must live in actions.ts (no "use node").
 */

import { Agent } from "@convex-dev/agent";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { components } from "../_generated/api";

export const buildBrainAgent = new Agent(components.agent, {
  name: "BuildBrain",
  languageModel: anthropic("claude-sonnet-4-6"),
  embeddingModel: openai.embedding("text-embedding-3-small"),
  instructions:
    "You are BuildBrain, a BIM Intelligence Agent for the Australian construction industry. " +
    "You help users query IFC building models and PDF construction documents, " +
    "cross-validate data between them, and generate construction deliverables.",
  tools: {},
  maxSteps: 10,
  contextOptions: {
    recentMessages: 50,
    searchOtherThreads: false,
    searchOptions: {
      limit: 10,
      textSearch: true,
      vectorSearch: true,
    },
  },
});
