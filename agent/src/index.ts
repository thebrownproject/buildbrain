import { createServer } from "node:http";
import { config } from "./config.js";
import { createConvexClient, type PendingJob } from "./convex-client.js";
import { processJob } from "./job-processor.js";

let activeJobId: string | null = null;
let shuttingDown = false;

async function main() {
  console.log("BuildBrain Agent VM starting...");
  console.log(`  VM Instance: ${config.vmInstanceId}`);
  console.log(`  Model: ${config.model}`);
  console.log(`  Thinking: ${config.thinkingLevel}`);
  console.log(`  CLI Tools: ${config.cliToolsDir}`);
  console.log(`  Buildkit Tools: ${config.buildkitToolsDir}`);
  console.log(`  Temp Dir: ${config.tempDir}`);

  // Connect to Convex
  const convex = createConvexClient();
  console.log("Connected to Convex");

  // Job queue: process one at a time
  const pendingQueue: PendingJob[] = [];
  let processing = false;

  async function processNext() {
    if (processing || shuttingDown) return;
    const job = pendingQueue.shift();
    if (!job) return;

    processing = true;
    activeJobId = job._id;

    try {
      await processJob(job, convex);
    } catch (err) {
      console.error(`Unhandled error processing job ${job._id}:`, err);
    } finally {
      processing = false;
      activeJobId = null;
      // Process next job if available
      void processNext();
    }
  }

  // Subscribe to pending jobs
  const unsubscribe = convex.subscribeToPendingJobs((jobs) => {
    // Add new jobs we haven't seen
    for (const job of jobs) {
      const alreadyQueued = pendingQueue.some((q) => q._id === job._id);
      const isActive = activeJobId === job._id;
      if (!alreadyQueued && !isActive) {
        console.log(`[queue] New job: ${job._id} (${job.type})`);
        pendingQueue.push(job);
      }
    }
    // Start processing if idle
    void processNext();
  });

  // Health check server
  const server = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          vmInstanceId: config.vmInstanceId,
          activeJob: activeJobId,
          queueLength: pendingQueue.length,
          uptime: process.uptime(),
        }),
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(config.healthPort, () => {
    console.log(`Health check listening on :${config.healthPort}/health`);
  });

  // Graceful shutdown
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received. Shutting down gracefully...`);

    if (activeJobId) {
      console.log(`Waiting for active job ${activeJobId} to complete...`);
      // Wait up to 30s for current job to finish
      const deadline = Date.now() + 30_000;
      while (activeJobId && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (activeJobId) {
        console.log(`Job ${activeJobId} still running after 30s, forcing shutdown`);
      }
    }

    unsubscribe();
    convex.dispose();
    server.close();
    console.log("Shutdown complete");
    process.exit(0);
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  console.log("Agent VM ready. Waiting for jobs...");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
