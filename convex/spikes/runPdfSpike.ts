"use node";

import { action } from "../_generated/server";
import { internal } from "../_generated/api";

/**
 * Public test runner for the PDF spike test.
 *
 * Usage from CLI:
 *   npx convex run spikes/runPdfSpike
 *
 * Lists files in the "files" table, picks the first PDF, and runs
 * the spike extraction action against it.
 */
export const run: any = action({
  args: {},
  handler: async (ctx): Promise<any> => {
    // 1. Query the files table for PDF files
    const files: any[] = await ctx.runQuery(internal.files.listAllInternal);

    const pdfFile: any = files.find(
      (f: { type: string }) => f.type === "pdf"
    );

    if (!pdfFile) {
      return {
        success: false,
        error: "No PDF files found in storage. Upload a PDF first.",
      };
    }

    console.log(
      `Found PDF: "${pdfFile.name}" (${Math.round(pdfFile.sizeBytes / 1024)}KB)`
    );

    // 2. Run the spike test action
    const result: any = await ctx.runAction(
      internal.spikes.pdfSpike.extractPdfData,
      { storageId: pdfFile.storageId }
    );

    console.log("Spike result:", JSON.stringify(result, null, 2));

    return {
      fileName: pdfFile.name,
      fileSizeKB: Math.round(pdfFile.sizeBytes / 1024),
      ...result,
    };
  },
});
