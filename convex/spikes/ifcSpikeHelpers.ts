import { internalQuery } from "../_generated/server";

/**
 * Helper query for the IFC spike test runner.
 * Separate file because queries must not be in a "use node" file.
 */
export const listIfcFiles = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Scan files table for IFC entries
    const allFiles = await ctx.db.query("files").take(100);
    const ifcFiles = allFiles.filter((f) => f.type === "ifc");

    return ifcFiles.map((f) => ({
      storageId: f.storageId,
      name: f.name,
      type: f.type,
    }));
  },
});
