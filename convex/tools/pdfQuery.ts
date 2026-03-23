"use node";

/**
 * PDF Query Tools
 *
 * Tools for querying pre-extracted PDF data:
 * - queryScheduleRowsTool: Query structured schedule data (door/window/finish schedules)
 * - getDrawingRegisterTool: Get a page index with classifications and drawing numbers
 *
 * Data flow: Agent tool -> ctx.runQuery -> pdfScheduleRows/pdfPages tables
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import type { GenericId } from "convex/values";
import { internal } from "../_generated/api";

// ── queryScheduleRowsTool ──────────────────────────────────────

export const queryScheduleRowsTool: any = createTool({
  description:
    "Query extracted PDF schedule data (door/window/finish schedules). " +
    "Returns structured rows with mark and properties. " +
    "Use this to look up schedule information from construction drawings — " +
    "door sizes, fire ratings, hardware, glazing types, room finishes, etc.",
  inputSchema: z.object({
    projectId: z.string().describe("The project ID to query schedules from"),
    scheduleType: z
      .enum(["door_schedule", "window_schedule", "finish_schedule"])
      .describe("Type of schedule to query"),
    filter: z
      .object({
        property: z.string().describe("Property name to filter by, e.g. 'FireRating'"),
        value: z.string().describe("Value to match, e.g. 'FRL-30'"),
      })
      .optional()
      .describe("Optional filter to narrow results by a specific property value"),
    limit: z
      .number()
      .optional()
      .describe("Maximum number of rows to return (default 100)"),
  }),
  execute: async (ctx, input): Promise<string> => {
    const limit = input.limit ?? 100;

    // 1. Query schedule rows
    const rows: any[] = await ctx.runQuery(
      internal.tools.queries.listScheduleRows,
      {
        projectId: input.projectId as GenericId<"projects">,
        scheduleType: input.scheduleType,
        limit: limit * 2, // Fetch extra for filtering
      }
    );

    if (rows.length === 0) {
      return JSON.stringify({
        status: "no_data",
        message: `No ${input.scheduleType.replace("_", " ")} data found in this project. ` +
          `The PDF may not have been processed yet, or the document may not contain this schedule type.`,
        scheduleType: input.scheduleType,
      });
    }

    // 2. Apply property filter if provided
    let filtered: any[] = rows;
    if (input.filter) {
      filtered = rows.filter((row: any) => {
        const props = row.properties as Record<string, unknown>;
        const propValue = props[input.filter!.property];
        if (propValue == null) return false;
        return (
          String(propValue).toLowerCase() ===
          input.filter!.value.toLowerCase()
        );
      });
    }

    const totalCount: number = filtered.length;
    const truncated = filtered.length > limit;
    filtered = filtered.slice(0, limit);

    // 3. Format response
    const resultRows = filtered.map((row: any) => ({
      mark: row.mark,
      properties: row.properties,
      sourcePages: row.sourcePages,
    }));

    return JSON.stringify({
      status: "ok",
      scheduleType: input.scheduleType,
      totalRows: totalCount,
      returned: resultRows.length,
      truncated,
      rows: resultRows,
    });
  },
});

// ── getDrawingRegisterTool ─────────────────────────────────────

export const getDrawingRegisterTool: any = createTool({
  description:
    "Get the drawing register — a list of all pages in a PDF file with their " +
    "classifications, drawing numbers, and titles. Use this to understand what " +
    "drawings are available, find specific drawing types, or orient yourself in " +
    "a large drawing set.",
  inputSchema: z.object({
    fileId: z
      .string()
      .describe("The file ID of the PDF to get the drawing register for"),
  }),
  execute: async (ctx, input): Promise<string> => {
    // 1. Query pages for this file
    const pages: any[] = await ctx.runQuery(
      internal.tools.queries.listPagesByFile,
      { fileId: input.fileId as GenericId<"files"> }
    );

    if (pages.length === 0) {
      return JSON.stringify({
        status: "no_data",
        message:
          "No page data found for this file. The PDF may not have been processed yet.",
        fileId: input.fileId,
      });
    }

    // 2. Group pages by classification
    const groups: Record<
      string,
      Array<{
        page: number;
        drawingNumber?: string;
        title?: string;
        hasTable: boolean;
      }>
    > = {};

    for (const page of pages) {
      const classification = page.classification ?? "unclassified";
      if (!groups[classification]) {
        groups[classification] = [];
      }
      groups[classification].push({
        page: page.pageNumber,
        drawingNumber: page.drawingNumber ?? undefined,
        title: page.drawingTitle ?? undefined,
        hasTable: page.hasTable,
      });
    }

    // 3. Build formatted summary
    const lines: string[] = [];
    lines.push(`Drawing Register (${pages.length} pages)`);
    lines.push("─".repeat(50));

    const classificationOrder = [
      "cover",
      "notes",
      "plan",
      "elevation",
      "section",
      "detail",
      "schedule",
      "legend",
      "unclassified",
    ];

    for (const classification of classificationOrder) {
      const group = groups[classification];
      if (!group || group.length === 0) continue;

      lines.push("");
      lines.push(
        `${classification.toUpperCase()} (${group.length} page${group.length > 1 ? "s" : ""})`
      );

      for (const page of group) {
        const parts: string[] = [`  p${page.page}`];
        if (page.drawingNumber) parts.push(`(${page.drawingNumber})`);
        if (page.title) parts.push(`— ${page.title}`);
        if (page.hasTable) parts.push("[table]");
        lines.push(parts.join(" "));
      }
    }

    return JSON.stringify({
      status: "ok",
      fileId: input.fileId,
      totalPages: pages.length,
      classifications: Object.fromEntries(
        Object.entries(groups).map(([k, v]) => [k, v.length])
      ),
      register: lines.join("\n"),
    });
  },
});
