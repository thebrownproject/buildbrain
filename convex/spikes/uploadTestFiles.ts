"use node";

import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

/**
 * Upload a test file from a URL into Convex storage and register it.
 * Usage: npx convex run spikes/uploadTestFiles:upload '{"url":"https://...","name":"file.ifc","type":"ifc"}'
 */
export const upload = action({
  args: {
    url: v.string(),
    name: v.string(),
    type: v.union(v.literal("ifc"), v.literal("pdf")),
    projectId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<any> => {
    // Download file from URL
    console.log(`Downloading ${args.name} from ${args.url}...`);
    const response = await fetch(args.url);
    if (!response.ok) {
      return { success: false, error: `Failed to fetch: ${response.statusText}` };
    }

    const blob = await response.blob();
    const storageId = await ctx.storage.store(blob);
    console.log(`Stored as ${storageId} (${(blob.size / 1024).toFixed(0)} KB)`);

    // If projectId provided, register as a file and trigger pipeline
    if (args.projectId) {
      try {
        await ctx.runMutation(internal.spikes.uploadTestFilesMutations.saveUploadInternal, {
          storageId,
          name: args.name,
          type: args.type,
          sizeBytes: blob.size,
          projectId: args.projectId as any,
        });
        return { success: true, storageId, name: args.name, registered: true };
      } catch (e: any) {
        return { success: true, storageId, name: args.name, registered: false, error: e.message };
      }
    }

    return { success: true, storageId, name: args.name, sizeBytes: blob.size };
  },
});

/**
 * Create a test project for E2E testing.
 * Usage: npx convex run spikes/uploadTestFiles:createProject '{"name":"E2E Test Project"}'
 */
export const createProject = action({
  args: { name: v.string() },
  handler: async (ctx, args): Promise<any> => {
    const projectId = await ctx.runMutation(internal.spikes.uploadTestFilesMutations.createTestProject, {
      name: args.name,
    });
    return { success: true, projectId };
  },
});
