"use node";

/**
 * Search Tool
 *
 * Full-text search across PDF pages using Convex's built-in search index.
 * Returns matching pages with text context, drawing numbers, and classifications.
 *
 * Data flow: Agent tool -> ctx.runQuery -> pdfPages search index
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../_generated/api";

// Maximum text snippet length per page in results
const MAX_SNIPPET_LENGTH = 500;

export const searchPagesTool = createTool({
  description:
    "Search across PDF pages using full-text search. Returns matching pages with " +
    "text context, page numbers, drawing numbers, and classifications. " +
    "Use this to find information in construction drawings — e.g. search for " +
    "'acoustic requirements', 'fire rating', 'concrete specification', or any other term. " +
    "Optionally filter by a specific file.",
  inputSchema: z.object({
    projectId: z
      .string()
      .describe("The project ID to search within"),
    query: z
      .string()
      .describe(
        "Search query — terms to find across PDF page text"
      ),
    fileId: z
      .string()
      .optional()
      .describe("Optional file ID to restrict search to a specific PDF"),
    limit: z
      .number()
      .default(10)
      .describe("Maximum number of matching pages to return (default 10)"),
  }),
  execute: async (ctx, input) => {
    const limit = Math.min(input.limit ?? 10, 50);

    // Run full-text search
    const results = await ctx.runQuery(
      internal.tools.queries.searchPages,
      {
        query: input.query,
        projectId: input.projectId as never,
        fileId: input.fileId as never | undefined,
        limit,
      }
    );

    if (results.length === 0) {
      return JSON.stringify({
        status: "no_results",
        message: `No pages found matching '${input.query}'. ` +
          `Try different search terms, or check that the PDF has been processed.`,
        query: input.query,
      });
    }

    // Format results with text snippets
    const matches = results.map((page) => {
      // Extract a relevant snippet around the search terms
      const text = page.text ?? "";
      let snippet: string;

      // Try to find the query terms in the text for context
      const queryTerms = input.query.toLowerCase().split(/\s+/);
      const lowerText = text.toLowerCase();
      let bestIndex = -1;

      for (const term of queryTerms) {
        const idx = lowerText.indexOf(term);
        if (idx !== -1 && (bestIndex === -1 || idx < bestIndex)) {
          bestIndex = idx;
        }
      }

      if (bestIndex !== -1) {
        // Show context around the first match
        const start = Math.max(0, bestIndex - 100);
        const end = Math.min(text.length, bestIndex + MAX_SNIPPET_LENGTH - 100);
        snippet = (start > 0 ? "..." : "") + text.slice(start, end) + (end < text.length ? "..." : "");
      } else {
        // Fallback: show beginning of text
        snippet =
          text.slice(0, MAX_SNIPPET_LENGTH) +
          (text.length > MAX_SNIPPET_LENGTH ? "..." : "");
      }

      return {
        pageNumber: page.pageNumber,
        fileId: page.fileId,
        classification: page.classification ?? "unclassified",
        drawingNumber: page.drawingNumber ?? null,
        drawingTitle: page.drawingTitle ?? null,
        hasTable: page.hasTable,
        snippet,
      };
    });

    return JSON.stringify({
      status: "ok",
      query: input.query,
      totalMatches: matches.length,
      matches,
    });
  },
});
