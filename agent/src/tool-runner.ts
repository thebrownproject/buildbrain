import { spawn } from "node:child_process";
import { config } from "./config.js";

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  stderr?: string;
  exitCode: number | null;
}

export async function runTool(
  script: string,
  args: string[],
  options?: { timeout?: number; cwd?: string },
): Promise<ToolResult> {
  const timeout = options?.timeout ?? config.defaultToolTimeoutMs;
  const cwd = options?.cwd ?? process.cwd();

  return new Promise((resolve) => {
    const proc = spawn("python3", [script, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const chunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let killed = false;

    proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      killed = true;
      proc.kill("SIGKILL");
    }, timeout);

    proc.on("close", (code) => {
      clearTimeout(timer);

      const stdout = Buffer.concat(chunks).toString("utf-8").trim();
      const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();

      if (killed) {
        resolve({
          success: false,
          error: `Tool timed out after ${timeout / 1000}s`,
          stderr,
          exitCode: code,
        });
        return;
      }

      if (code !== 0) {
        // Try parsing stdout as JSON error response
        try {
          const parsed = JSON.parse(stdout);
          if (parsed.error) {
            resolve({
              success: false,
              data: parsed,
              error: parsed.message || `Tool exited with code ${code}`,
              stderr,
              exitCode: code,
            });
            return;
          }
        } catch {
          // Not JSON, use raw output
        }

        resolve({
          success: false,
          error: stderr || stdout || `Tool exited with code ${code}`,
          stderr,
          exitCode: code,
        });
        return;
      }

      // Parse JSON output
      try {
        const data = JSON.parse(stdout);
        resolve({ success: true, data, exitCode: 0 });
      } catch {
        resolve({
          success: false,
          error: `Failed to parse tool output as JSON: ${stdout.slice(0, 200)}`,
          stderr,
          exitCode: 0,
        });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        error: `Failed to spawn tool: ${err.message}`,
        exitCode: null,
      });
    });
  });
}

/** Truncate large JSON results for LLM context, keeping structure */
export function truncateResult(data: unknown, maxChars: number): string {
  const json = JSON.stringify(data, null, 2);
  if (json.length <= maxChars) return json;

  // For arrays (element lists), truncate the array
  if (Array.isArray(data)) {
    const preview = data.slice(0, 20);
    const truncated = JSON.stringify(preview, null, 2);
    return `${truncated}\n\n... (${data.length} total items, showing first 20. Full results saved as artifact.)`;
  }

  // For objects with an elements array, truncate that
  if (
    data &&
    typeof data === "object" &&
    "elements" in data &&
    Array.isArray((data as Record<string, unknown>).elements)
  ) {
    const obj = data as Record<string, unknown>;
    const elements = obj.elements as unknown[];
    const preview = { ...obj, elements: elements.slice(0, 20) };
    const truncated = JSON.stringify(preview, null, 2);
    return `${truncated}\n\n... (${elements.length} total elements, showing first 20. Full results saved as artifact.)`;
  }

  return json.slice(0, maxChars) + "\n\n... (truncated, full results saved as artifact.)";
}
