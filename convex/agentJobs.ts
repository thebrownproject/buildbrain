import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";

export const getActive = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const queued = await ctx.db
      .query("agentJobs")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", args.projectId).eq("status", "queued")
      )
      .take(10);
    const claimed = await ctx.db
      .query("agentJobs")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", args.projectId).eq("status", "claimed")
      )
      .take(10);
    const running = await ctx.db
      .query("agentJobs")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", args.projectId).eq("status", "running")
      )
      .take(10);
    return [...queued, ...claimed, ...running];
  },
});

// Agent VM: get pending jobs (internal, for HTTP client with admin auth)
export const getPending = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("agentJobs")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .order("asc")
      .collect();
  },
});

// Agent VM: public subscription target for real-time job watching
// Used by ConvexClient (WebSocket) which doesn't support admin auth
export const getPendingPublic = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("agentJobs")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .order("asc")
      .collect();
  },
});

// Agent VM: claim a job (atomic check-and-set)
export const claim = internalMutation({
  args: {
    jobId: v.id("agentJobs"),
    vmInstanceId: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "queued") {
      return { claimed: false };
    }
    await ctx.db.patch(args.jobId, {
      status: "claimed",
      claimedBy: args.vmInstanceId,
      claimedAt: Date.now(),
      lastHeartbeat: Date.now(),
    });
    return { claimed: true };
  },
});

export const heartbeat = internalMutation({
  args: { jobId: v.id("agentJobs") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, { lastHeartbeat: Date.now() });
  },
});

export const updateProgress = internalMutation({
  args: {
    jobId: v.id("agentJobs"),
    progress: v.number(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: "running",
      progress: args.progress,
      progressMessage: args.message,
      lastHeartbeat: Date.now(),
    });
  },
});

export const complete = internalMutation({
  args: {
    jobId: v.id("agentJobs"),
    output: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: "completed",
      output: args.output,
      completedAt: Date.now(),
      progress: 100,
    });
  },
});

export const fail = internalMutation({
  args: {
    jobId: v.id("agentJobs"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: "failed",
      error: args.error,
      completedAt: Date.now(),
    });
  },
});

const STALE_THRESHOLD_MS = 90_000; // 90 seconds
const MAX_RETRIES = 3;

export const detectStaleJobs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Find all claimed/running jobs
    const claimedJobs = await ctx.db
      .query("agentJobs")
      .withIndex("by_status", (q) => q.eq("status", "claimed"))
      .collect();
    const runningJobs = await ctx.db
      .query("agentJobs")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .collect();
    const activeJobs = [...claimedJobs, ...runningJobs];

    for (const job of activeJobs) {
      const lastHeartbeat = job.lastHeartbeat ?? job.claimedAt ?? job.queuedAt;
      if (now - lastHeartbeat < STALE_THRESHOLD_MS) continue;

      const retryCount = (job.retryCount ?? 0) + 1;

      if (retryCount > MAX_RETRIES) {
        // Max retries exceeded, mark as failed
        await ctx.db.patch(job._id, {
          status: "failed",
          error: "Max retries exceeded - agent VM unresponsive",
          completedAt: now,
          retryCount,
        });
        // Mark associated message as error
        if (job.messageId) {
          const message = await ctx.db.get(job.messageId);
          if (message && message.status === "streaming") {
            await ctx.db.patch(job.messageId, {
              status: "error",
              content: "Processing failed after multiple retries.",
            });
          }
        }
      } else {
        // Requeue for retry
        await ctx.db.patch(job._id, {
          status: "queued",
          claimedBy: undefined,
          claimedAt: undefined,
          lastHeartbeat: undefined,
          retryCount,
        });
      }
    }

    // Clean up orphaned stream deltas for error'd messages (bounded to 20 per tick)
    const errorMessages = await ctx.db
      .query("messages")
      .withIndex("by_status", (q) => q.eq("status", "error"))
      .take(20);
    for (const msg of errorMessages) {
      const deltas = await ctx.db
        .query("streamDeltas")
        .withIndex("by_message", (q) => q.eq("messageId", msg._id))
        .take(100);
      if (deltas.length === 0) continue;
      for (const delta of deltas) {
        await ctx.db.delete(delta._id);
      }
    }
  },
});
