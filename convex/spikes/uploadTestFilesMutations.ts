import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

export const createTestProject = internalMutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    // Create a test user first
    const userId = await ctx.db.insert("users", {
      clerkId: "test_e2e_user",
      name: "E2E Test User",
      email: "test@buildbrain.dev",
    });

    const projectId = await ctx.db.insert("projects", {
      name: args.name,
      description: "E2E test project for V3 migration",
      ownerId: userId,
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return projectId;
  },
});

export const saveUploadInternal = internalMutation({
  args: {
    storageId: v.id("_storage"),
    name: v.string(),
    type: v.union(v.literal("ifc"), v.literal("pdf")),
    sizeBytes: v.number(),
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const fileId = await ctx.db.insert("files", {
      projectId: args.projectId,
      storageId: args.storageId,
      name: args.name,
      type: args.type,
      sizeBytes: args.sizeBytes,
      uploadedBy: (await ctx.db.query("users").first())!._id,
      uploadedAt: Date.now(),
      extractionStatus: "pending",
    });

    // Trigger the ingest pipeline
    await ctx.scheduler.runAfter(0, internal.ingest.pipeline.triggerPipeline, {
      fileId,
      projectId: args.projectId,
    });

    return fileId;
  },
});
