import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.js";
import type { ConvexClientWrapper } from "./convex-client.js";

const activeJobs = new Map<string, string[]>(); // jobId -> file paths

export async function downloadFile(
  fileId: string,
  filename: string,
  jobId: string,
  convex: ConvexClientWrapper,
): Promise<string> {
  const jobDir = join(config.tempDir, jobId);
  await mkdir(jobDir, { recursive: true });

  const url = await convex.getDownloadUrl(fileId);
  const localPath = join(jobDir, filename);

  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(localPath, buffer);

      // Track for cleanup
      const tracked = activeJobs.get(jobId) ?? [];
      tracked.push(localPath);
      activeJobs.set(jobId, tracked);

      return localPath;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  throw new Error(`Failed to download file after 3 attempts: ${lastError?.message}`);
}

export async function cleanupJob(jobId: string): Promise<void> {
  const jobDir = join(config.tempDir, jobId);
  try {
    await rm(jobDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
  activeJobs.delete(jobId);
}

