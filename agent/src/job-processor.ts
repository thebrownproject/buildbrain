import type { ConvexClientWrapper, PendingJob } from "./convex-client.js";
import { config } from "./config.js";
import { downloadFile, cleanupJob } from "./file-manager.js";
import { StreamWriter } from "./stream-writer.js";
import { runAgent } from "./agent-session.js";

export async function processJob(
  job: PendingJob,
  convex: ConvexClientWrapper,
): Promise<void> {
  const jobId = job._id;
  console.log(`[job:${jobId}] Processing ${job.type} job`);

  // 1. Claim the job
  const { claimed } = await convex.claimJob(jobId);
  if (!claimed) {
    console.log(`[job:${jobId}] Already claimed by another VM, skipping`);
    return;
  }

  // 2. Start heartbeat
  const heartbeat = setInterval(() => {
    convex.heartbeat(jobId).catch((err) => {
      console.error(`[job:${jobId}] Heartbeat failed:`, err);
    });
  }, config.heartbeatIntervalMs);

  let messageId: string | undefined;

  try {
    await convex.updateProgress(jobId, 5, "Starting...");

    // 3. Get threadId and message from job input
    const input = job.input as { threadId: string; messageId: string; message: string };
    const threadId = input.threadId;
    if (!threadId) throw new Error("Job missing threadId in input");

    const context = await convex.getThreadContext(threadId);
    await convex.updateProgress(jobId, 10, "Loading project context...");

    // 4. Download files to temp directory
    for (const file of context.files) {
      try {
        const localPath = await downloadFile(file._id, file.name, jobId, convex);
        console.log(`[job:${jobId}] Downloaded ${file.name} -> ${localPath}`);
      } catch (err) {
        console.warn(`[job:${jobId}] Failed to download ${file.name}:`, err);
        // Non-fatal: not all files may be needed for every job
      }
    }
    await convex.updateProgress(jobId, 20, "Files ready, starting agent...");

    // 5. Create assistant message
    messageId = await convex.createAssistantMessage(threadId);

    // 6. Set up stream writer
    const streamWriter = new StreamWriter(messageId, convex);

    // 7. Get user message text
    const userMessageText = input.message ?? "What can you help me with?";

    // 8. Run the agent
    await convex.updateProgress(jobId, 30, "Agent processing...");
    const result = await runAgent(
      userMessageText,
      context,
      messageId,
      convex,
      streamWriter,
    );

    // 9. Finalize message
    await convex.updateProgress(jobId, 90, "Finalizing response...");
    await streamWriter.finalize({
      toolCalls: result.toolCalls,
      artifactIds: result.artifactIds,
      elementRefs: result.elementRefs,
      suggestions: result.suggestions,
    });

    // 10. Update thread summary if conversation is getting long
    if (context.recentMessages.length >= 18) {
      try {
        const summary = buildContextSummary(context, result);
        await convex.updateThreadSummary(threadId, summary);
      } catch {
        // Non-critical
      }
    }

    // 11. Complete the job
    await convex.completeJob(jobId, {
      messageId,
      artifactIds: result.artifactIds,
      toolCallCount: result.toolCalls.length,
    });

    console.log(
      `[job:${jobId}] Completed. ${result.toolCalls.length} tool calls, ${result.artifactIds.length} artifacts`,
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[job:${jobId}] Failed:`, error);

    // Set message to error state if we created one
    if (messageId) {
      try {
        await convex.setMessageError(messageId, error);
      } catch {
        // Best-effort
      }
    }

    // Fail the job
    try {
      await convex.failJob(jobId, error);
    } catch {
      // Best-effort
    }
  } finally {
    // Always: stop heartbeat and clean up temp files
    clearInterval(heartbeat);
    await cleanupJob(jobId);
  }
}

function buildContextSummary(
  context: any,
  result: any,
): string {
  const parts: string[] = [];

  parts.push(`Project: ${context.project?.name ?? "Unknown"}`);

  if (context.files?.length) {
    parts.push(
      `Files: ${context.files.map((f: any) => `${f.name} (${f.type})`).join(", ")}`,
    );
  }

  if (result.toolCalls?.length) {
    const tools = result.toolCalls
      .filter((t: any) => t.status === "complete")
      .map((t: any) => `${t.tool} ${(t.args as any)?.command ?? ""}`.trim());
    if (tools.length) {
      parts.push(`Tools used: ${tools.join(", ")}`);
    }
  }

  if (result.artifactIds?.length) {
    parts.push(`${result.artifactIds.length} artifacts generated`);
  }

  return parts.join("\n");
}
