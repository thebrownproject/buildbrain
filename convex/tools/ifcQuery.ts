"use node";

/**
 * IFC Query Tool
 *
 * Queries IFC building elements from the pre-extracted structured store.
 * Returns element properties, materials, and quantities grouped by type.
 *
 * Data flow: Agent tool -> ctx.runQuery -> elementGroups/elements tables
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import type { GenericId } from "convex/values";
import { internal } from "../_generated/api";

// Maximum payload size for LLM context (bytes)
const MAX_RESULT_SIZE = 50_000;
const MAX_ELEMENTS = 50;

/**
 * Resolve a dot-notation property path on an element's properties object.
 * E.g. "Pset_DoorCommon.FireRating" -> element.properties.Pset_DoorCommon.FireRating
 */
function resolvePropertyPath(
  properties: Record<string, unknown>,
  path: string
): unknown {
  const parts = path.split(".");
  let current: unknown = properties;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export const queryIfcElementsTool: any = createTool({
  description:
    "Query IFC building elements from the pre-extracted structured store. " +
    "Returns element properties, materials, and quantities grouped by type. " +
    "Use this to answer questions about IFC model data — element counts, property values, " +
    "material assignments, and quantities. Filter by elementType (e.g. 'IfcDoor', 'IfcWall') " +
    "and optionally by a specific property path (e.g. 'Pset_DoorCommon.FireRating').",
  inputSchema: z.object({
    projectId: z.string().describe("The project ID to query elements from"),
    elementType: z
      .string()
      .describe(
        "IFC element type to query, e.g. 'IfcDoor', 'IfcWall', 'IfcWindow', 'IfcColumn'"
      ),
    property: z
      .string()
      .optional()
      .describe(
        "Dot-notation property path to filter/extract, e.g. 'Pset_DoorCommon.FireRating' or 'Tag'"
      ),
    value: z
      .string()
      .optional()
      .describe(
        "If provided with property, only return elements where the property equals this value"
      ),
    notNull: z
      .boolean()
      .optional()
      .describe(
        "If true, only return elements where the specified property is not null/undefined"
      ),
    limit: z
      .number()
      .optional()
      .describe("Maximum number of elements to return (default 50, max 200)"),
  }),
  execute: async (ctx, input): Promise<string> => {
    const limit = Math.min(input.limit ?? MAX_ELEMENTS, 200);

    // 1. Find element groups matching the type
    const groups: any[] = await ctx.runQuery(
      internal.tools.queries.listElementGroups,
      {
        projectId: input.projectId as GenericId<"projects">,
        elementType: input.elementType,
      }
    );

    if (groups.length === 0) {
      return JSON.stringify({
        status: "no_data",
        message: `No extracted data found for element type '${input.elementType}' in this project. ` +
          `The data may not have been extracted yet — use extractIfcElements to trigger extraction.`,
        elementType: input.elementType,
      });
    }

    // 2. Collect elements from all matching groups
    let allElements: Array<{
      globalId: string;
      name?: string;
      properties: Record<string, unknown>;
    }> = [];

    for (const group of groups) {
      const elements: any[] = await ctx.runQuery(
        internal.tools.queries.listElementsByGroup,
        {
          groupId: group._id,
          limit: limit * 2, // Fetch extra to account for filtering
        }
      );
      allElements.push(
        ...elements.map((e) => ({
          globalId: e.globalId,
          name: e.name ?? undefined,
          properties: e.properties as Record<string, unknown>,
        }))
      );
    }

    // 3. Apply property filters
    if (input.property) {
      if (input.value !== undefined) {
        // Exact match filter
        allElements = allElements.filter((el) => {
          const propValue = resolvePropertyPath(el.properties, input.property!);
          return String(propValue) === input.value;
        });
      } else if (input.notNull) {
        // Not-null filter
        allElements = allElements.filter((el) => {
          const propValue = resolvePropertyPath(el.properties, input.property!);
          return propValue != null && propValue !== "";
        });
      }
    }

    const totalCount = allElements.length;

    // 4. Truncate for LLM context
    const truncated = allElements.length > limit;
    allElements = allElements.slice(0, limit);

    // 5. If a specific property was requested, extract just that property for a cleaner response
    let resultElements: Array<Record<string, unknown>>;
    if (input.property) {
      resultElements = allElements.map((el) => ({
        globalId: el.globalId,
        name: el.name,
        [input.property!]: resolvePropertyPath(el.properties, input.property!),
      }));
    } else {
      resultElements = allElements.map((el) => ({
        globalId: el.globalId,
        name: el.name,
        properties: el.properties,
      }));
    }

    // 6. Estimate result size and further truncate if needed
    let resultStr = JSON.stringify(resultElements);
    if (resultStr.length > MAX_RESULT_SIZE) {
      // Progressively reduce until we fit
      while (resultElements.length > 1 && resultStr.length > MAX_RESULT_SIZE) {
        resultElements = resultElements.slice(
          0,
          Math.floor(resultElements.length * 0.7)
        );
        resultStr = JSON.stringify(resultElements);
      }
    }

    const groupInfo = groups.map((g) => ({
      elementType: g.elementType,
      displayName: g.displayName,
      totalInGroup: g.count,
      status: g.status,
      fileId: g.fileId,
    }));

    return JSON.stringify({
      status: "ok",
      elementType: input.elementType,
      groups: groupInfo,
      totalMatching: totalCount,
      returned: resultElements.length,
      truncated,
      elements: resultElements,
    });
  },
});
