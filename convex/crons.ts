import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Detect stale agent jobs every 60 seconds
// Requeues jobs with stale heartbeats, fails after 3 retries,
// cleans up orphaned stream deltas for error'd messages
crons.interval(
  "stale-job-detector",
  { seconds: 60 },
  internal.agentJobs.detectStaleJobs
);

export default crons;
