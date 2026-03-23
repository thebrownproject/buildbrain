import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

export const listByGroup = query({
  args: {
    groupId: v.id("elementGroups"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("elements")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .take(200);
  },
});

// Internal mutation for agent VM: batch insert elements
export const batchInsert = internalMutation({
  args: {
    groupId: v.id("elementGroups"),
    projectId: v.id("projects"),
    elements: v.array(
      v.object({
        globalId: v.string(),
        name: v.optional(v.string()),
        properties: v.any(),
      })
    ),
  },
  handler: async (ctx, args) => {
    for (const element of args.elements) {
      await ctx.db.insert("elements", {
        groupId: args.groupId,
        projectId: args.projectId,
        globalId: element.globalId,
        name: element.name,
        properties: element.properties,
      });
    }
  },
});
