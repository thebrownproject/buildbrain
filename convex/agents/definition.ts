"use node";

/**
 * BuildBrain Agent Definition
 *
 * Defines the core agent using @convex-dev/agent v0.6.x with:
 * - Anthropic Claude for language model
 * - OpenAI for embeddings (Anthropic does not offer embeddings)
 * - 6 tools for querying pre-extracted IFC/PDF data
 *
 * IMPORTANT: This file uses "use node" and can ONLY contain actions.
 * Queries and mutations must live in actions.ts (no "use node").
 */

import { Agent } from "@convex-dev/agent";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { components } from "../_generated/api";
import {
  queryIfcElementsTool,
  queryScheduleRowsTool,
  getDrawingRegisterTool,
  crossValidateTool,
  searchPagesTool,
  extractIfcElementsTool,
} from "../tools";

export const buildBrainAgent: any = new Agent(components.agent, {
  name: "BuildBrain",
  languageModel: anthropic("claude-haiku-4-5-20251001"),
  // embeddingModel: openai.embedding("text-embedding-3-small"), // Requires OPENAI_API_KEY
  instructions:
    "You are BuildBrain, a BIM Intelligence Agent for the Australian construction industry. " +
    "You help users query IFC building models and PDF construction documents, " +
    "cross-validate data between them, and generate construction deliverables.",
  tools: {
    queryIfcElements: queryIfcElementsTool,
    queryScheduleRows: queryScheduleRowsTool,
    getDrawingRegister: getDrawingRegisterTool,
    crossValidate: crossValidateTool,
    searchPages: searchPagesTool,
    extractIfcElements: extractIfcElementsTool,
  },
  maxSteps: 10,
  contextOptions: {
    recentMessages: 50,
    searchOtherThreads: false,
    searchOptions: {
      limit: 10,
      textSearch: true,
      vectorSearch: false,
    },
  },
});
