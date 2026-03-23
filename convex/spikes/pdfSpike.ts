"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Spike test: validate unpdf works inside a Convex Node.js action.
 *
 * Tests text extraction via getTextContent() and operator list parsing
 * via getOperatorList() for line/rectangle detection in construction drawings.
 */
export const extractPdfData = internalAction({
  args: {
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    // 1. Download file from Convex storage
    const blob = await ctx.storage.get(args.storageId);
    if (!blob) {
      throw new Error(`File not found in storage: ${args.storageId}`);
    }

    // 2. Convert Blob -> ArrayBuffer -> Uint8Array
    const arrayBuffer = await blob.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    // 3. Load PDF document
    let doc;
    try {
      const loadingTask = getDocument({
        data,
        useSystemFonts: false,
        disableFontFace: true,
        isEvalSupported: false,
        verbosity: 0,
      } as any);
      doc = await loadingTask.promise;
      const OPS = { constructPath: 91, save: 10, restore: 11, transform: 12 };
      const pageCount = doc.numPages;

      // 4. Process first 3 pages (or fewer if document is shorter)
      const pagesToProcess = Math.min(3, pageCount);
      const pages: Array<{
        pageNum: number;
        textLength: number;
        textPreview: string;
        lineCount: number;
        rectCount: number;
      }> = [];

      for (let i = 1; i <= pagesToProcess; i++) {
        const page = await doc.getPage(i);

        // 4a. Extract text via getTextContent()
        const textContent = await page.getTextContent();
        const textStr = textContent.items
          .filter((item: Record<string, unknown>) => "str" in item)
          .map((item: Record<string, unknown>) => item.str as string)
          .join(" ");

        // 4b. Get operator list and count drawing primitives
        const opList = await page.getOperatorList();

        let lineCount = 0;
        let rectCount = 0;

        // Walk operator list looking for constructPath ops (OPS code 91)
        for (let j = 0; j < opList.fnArray.length; j++) {
          if (opList.fnArray[j] === OPS.constructPath) {
            // constructPath args structure:
            //   args[0][j] = array of sub-op codes
            //   args[1][j] = flat array of coordinates
            // Sub-op codes: moveTo=13, lineTo=14, rectangle=19
            const subOps = opList.argsArray[j][0] as number[];
            let hasMoveToInSequence = false;

            for (const subOp of subOps) {
              if (subOp === 13) {
                // moveTo
                hasMoveToInSequence = true;
              } else if (subOp === 14 && hasMoveToInSequence) {
                // lineTo following moveTo = a line
                lineCount++;
                hasMoveToInSequence = false;
              } else if (subOp === 19) {
                // rectangle
                rectCount++;
              } else {
                hasMoveToInSequence = false;
              }
            }
          }
        }

        // 4c. Cleanup page to free memory
        page.cleanup();

        pages.push({
          pageNum: i,
          textLength: textStr.length,
          textPreview: textStr.slice(0, 200),
          lineCount,
          rectCount,
        });
      }

      return {
        pageCount,
        pages,
        success: true,
      };
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : String(err);
      return { success: false, error: errorMessage };
    } finally {
      if (doc) {
        doc.destroy();
      }
    }
  },
});
