import { hostname } from "node:os";
import { resolve } from "node:path";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

const projectRoot = resolve(import.meta.dirname, "../..");

export const config = {
  convexUrl: required("CONVEX_URL"),
  convexDeployKey: required("CONVEX_DEPLOY_KEY"),
  anthropicApiKey: required("ANTHROPIC_API_KEY"),

  vmInstanceId: optional("VM_INSTANCE_ID", hostname()),
  model: optional("AGENT_MODEL", "claude-sonnet-4-20250514"),
  thinkingLevel: optional("AGENT_THINKING", "medium") as
    | "off"
    | "minimal"
    | "low"
    | "medium"
    | "high"
    | "xhigh",

  cliToolsDir: optional(
    "CLI_TOOLS_DIR",
    resolve(projectRoot, ".claude/skills/cli-tools/scripts"),
  ),
  buildkitToolsDir: optional(
    "BUILDKIT_TOOLS_DIR",
    resolve(projectRoot, "../buildkit/cli-tools"),
  ),
  tempDir: optional("TEMP_DIR", "/tmp/buildbrain"),

  healthPort: parseInt(optional("HEALTH_PORT", "8080"), 10),
  heartbeatIntervalMs: 30_000,
  defaultToolTimeoutMs: 60_000,
  quantitiesToolTimeoutMs: 300_000,
  streamFlushIntervalMs: 50,
  elementBatchSize: 50,
  maxResultChars: 50_000,
} as const;
