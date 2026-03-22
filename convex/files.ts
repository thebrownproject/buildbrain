import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";

const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500MB

export const listByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("files")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(50);
  },
});

export const getUrl = query({
  args: { fileId: v.id("files") },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId);
    if (!file) throw new Error("File not found");
    return await ctx.storage.getUrl(file.storageId);
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const saveUpload = mutation({
  args: {
    projectId: v.id("projects"),
    storageId: v.id("_storage"),
    name: v.string(),
    type: v.union(v.literal("ifc"), v.literal("pdf")),
    sizeBytes: v.number(),
    uploadedBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    if (args.sizeBytes > MAX_FILE_SIZE_BYTES) {
      throw new Error(
        `File too large (${Math.round(args.sizeBytes / 1024 / 1024)}MB). Maximum is ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB.`
      );
    }

    // Determine revision number
    const existingFiles = await ctx.db
      .query("files")
      .withIndex("by_project_type", (q) =>
        q.eq("projectId", args.projectId).eq("type", args.type)
      )
      .collect();
    const sameNameFiles = existingFiles.filter((f) => f.name === args.name);
    const revisionNumber = sameNameFiles.length + 1;

    return await ctx.db.insert("files", {
      projectId: args.projectId,
      storageId: args.storageId,
      name: args.name,
      type: args.type,
      sizeBytes: args.sizeBytes,
      uploadedBy: args.uploadedBy,
      uploadedAt: Date.now(),
      revisionNumber,
    });
  },
});

// Internal mutations for agent VM
export const updateIfcMeta = internalMutation({
  args: {
    fileId: v.id("files"),
    ifcSchema: v.optional(v.string()),
    elementCounts: v.optional(v.any()),
    storeyNames: v.optional(v.array(v.string())),
    validationScore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { fileId, ...meta } = args;
    await ctx.db.patch(fileId, meta);
  },
});

export const updatePdfMeta = internalMutation({
  args: {
    fileId: v.id("files"),
    pageCount: v.optional(v.number()),
    schedulesFound: v.optional(
      v.array(
        v.object({
          type: v.string(),
          page: v.number(),
          rowCount: v.number(),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    const { fileId, ...meta } = args;
    await ctx.db.patch(fileId, meta);
  },
});

export const getDownloadUrl = internalQuery({
  args: { fileId: v.id("files") },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId);
    if (!file) throw new Error("File not found");
    const url = await ctx.storage.getUrl(file.storageId);
    if (!url) throw new Error("File storage URL unavailable");
    return url;
  },
});
