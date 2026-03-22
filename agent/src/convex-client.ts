import { ConvexHttpClient, ConvexClient } from "convex/browser";
import { config } from "./config.js";

// Until Convex types are generated, we use anyApi as a placeholder.
// Once `npx convex dev` runs and generates _generated/api.ts, replace
// these with typed imports: `import { api, internal } from "../../convex/_generated/api"`
import { anyApi } from "convex/server";

const internalApi = anyApi;
const publicApi = anyApi;

export interface ConvexClientWrapper {
  client: ConvexClient;

  // Job lifecycle
  claimJob(jobId: string): Promise<{ claimed: boolean }>;
  heartbeat(jobId: string): Promise<void>;
  updateProgress(
    jobId: string,
    progress: number,
    message: string,
  ): Promise<void>;
  completeJob(jobId: string, output: unknown): Promise<void>;
  failJob(jobId: string, error: string): Promise<void>;

  // Chat messages
  createAssistantMessage(threadId: string): Promise<string>;
  finalizeMessage(args: {
    messageId: string;
    content: string;
    toolCalls?: ToolCallRecord[];
    artifactIds?: string[];
    elementRefs?: ElementRef[];
    suggestions?: Suggestion[];
  }): Promise<void>;
  setMessageError(messageId: string, error: string): Promise<void>;

  // Streaming
  writeDelta(messageId: string, text: string, index: number): Promise<void>;

  // Data writes
  createArtifact(args: ArtifactCreateArgs): Promise<string>;
  createIssue(args: IssueCreateArgs): Promise<string>;
  createElementGroup(args: ElementGroupCreateArgs): Promise<string>;
  batchInsertElements(
    groupId: string,
    projectId: string,
    elements: ElementRecord[],
  ): Promise<void>;
  markElementGroupComplete(groupId: string): Promise<void>;

  // File metadata
  updateIfcMeta(args: IfcMetaArgs): Promise<void>;
  updatePdfMeta(args: PdfMetaArgs): Promise<void>;
  getDownloadUrl(fileId: string): Promise<string>;

  // Context
  getMessage(messageId: string): Promise<MessageRecord>;
  getThreadContext(threadId: string): Promise<ThreadContext>;
  updateThreadSummary(threadId: string, summary: string): Promise<void>;

  // Subscription
  subscribeToPendingJobs(
    callback: (jobs: PendingJob[]) => void,
  ): () => void;

  dispose(): void;
}

// Type definitions for Convex data shapes
export interface ToolCallRecord {
  id: string;
  tool: string;
  args: unknown;
  result?: string;
  status: "pending" | "running" | "complete" | "error";
  ephemeral?: boolean;
}

export interface ElementRef {
  globalId: string;
  label?: string;
}

export interface Suggestion {
  label: string;
  prompt: string;
}

export interface ArtifactCreateArgs {
  projectId: string;
  threadId?: string;
  messageId?: string;
  name: string;
  type:
    | "element_list"
    | "quantity_takeoff"
    | "pdf_schedule"
    | "cross_validation"
    | "compliance_check"
    | "model_summary";
  format: "csv" | "md" | "pdf" | "json";
  status: "generating" | "complete" | "failed";
  summary?: string;
  contentInline?: unknown;
  contentStorageId?: string;
  elementType?: string;
  sourceFile?: string;
  createdBy: "user" | "agent";
}

export interface IssueCreateArgs {
  projectId: string;
  artifactId?: string;
  severity: "error" | "warning" | "info" | "pass";
  title: string;
  description: string;
  source: string;
  elementRef?: string;
  elementGuid?: string;
}

export interface ElementGroupCreateArgs {
  projectId: string;
  fileId: string;
  elementType: string;
  displayName: string;
  count: number;
  columnOrder: string[];
  columnLabels?: Record<string, string>;
}

export interface ElementRecord {
  globalId: string;
  name?: string;
  properties: Record<string, unknown>;
}

export interface IfcMetaArgs {
  fileId: string;
  ifcSchema?: string;
  elementCounts?: Record<string, number>;
  storeyNames?: string[];
  validationScore?: number;
}

export interface PdfMetaArgs {
  fileId: string;
  pageCount?: number;
  schedulesFound?: Array<{ type: string; page: number; rowCount: number }>;
}

export interface ThreadContext {
  thread: { _id: string; projectId: string; contextSummary?: string };
  project: { _id: string; name: string; metadata?: unknown };
  files: Array<{
    _id: string;
    name: string;
    type: "ifc" | "pdf";
    elementCounts?: Record<string, number>;
    storeyNames?: string[];
    schedulesFound?: Array<{ type: string; page: number; rowCount: number }>;
  }>;
  recentMessages: Array<{
    role: "user" | "assistant";
    content: string;
    createdAt: number;
  }>;
}

export interface PendingJob {
  _id: string;
  projectId: string;
  type: "scan" | "extract" | "cross_validate" | "report" | "chat_response";
  status: string;
  input: { threadId: string; messageId: string; message: string };
  messageId?: string;
  queuedAt: number;
}

export interface MessageRecord {
  _id: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  status: string;
  createdAt: number;
}

export function createConvexClient(): ConvexClientWrapper {
  // HTTP client for internal mutations (supports admin auth / deploy key)
  const httpClient = new ConvexHttpClient(config.convexUrl);
  httpClient.setAdminAuth(config.convexDeployKey);

  // WebSocket client for reactive subscriptions (public queries only)
  const wsClient = new ConvexClient(config.convexUrl);

  function ref(path: string) {
    const [mod, fn] = path.split(".");
    return internalApi[mod!]?.[fn!] as any;
  }

  function pubRef(path: string) {
    const [mod, fn] = path.split(".");
    return publicApi[mod!]?.[fn!] as any;
  }

  return {
    client: wsClient,

    // Job lifecycle (internal mutations via HTTP client)
    async claimJob(jobId) {
      return httpClient.mutation(ref("agentJobs.claim"), {
        jobId,
        vmInstanceId: config.vmInstanceId,
      });
    },
    async heartbeat(jobId) {
      await httpClient.mutation(ref("agentJobs.heartbeat"), { jobId });
    },
    async updateProgress(jobId, progress, message) {
      await httpClient.mutation(ref("agentJobs.updateProgress"), {
        jobId,
        progress,
        message,
      });
    },
    async completeJob(jobId, output) {
      await httpClient.mutation(ref("agentJobs.complete"), { jobId, output });
    },
    async failJob(jobId, error) {
      await httpClient.mutation(ref("agentJobs.fail"), { jobId, error });
    },

    // Chat messages
    async createAssistantMessage(threadId) {
      return httpClient.mutation(ref("messages.createAssistant"), { threadId });
    },
    async finalizeMessage(args) {
      await httpClient.mutation(ref("messages.finalize"), args);
    },
    async setMessageError(messageId, error) {
      await httpClient.mutation(ref("messages.setError"), { messageId, error });
    },

    // Streaming
    async writeDelta(messageId, text, index) {
      await httpClient.mutation(ref("streamDeltas.write"), { messageId, text, index });
    },

    // Data writes
    async createArtifact(args) {
      return httpClient.mutation(ref("artifacts.create"), args);
    },
    async createIssue(args) {
      return httpClient.mutation(ref("issues.create"), args);
    },
    async createElementGroup(args) {
      return httpClient.mutation(ref("elementGroups.create"), args);
    },
    async batchInsertElements(groupId, projectId, elements) {
      await httpClient.mutation(ref("elements.batchInsert"), { groupId, projectId, elements });
    },
    async markElementGroupComplete(groupId) {
      await httpClient.mutation(ref("elementGroups.markComplete"), { groupId });
    },

    // File metadata
    async updateIfcMeta(args) {
      await httpClient.mutation(ref("files.updateIfcMeta"), args);
    },
    async updatePdfMeta(args) {
      await httpClient.mutation(ref("files.updatePdfMeta"), args);
    },
    async getDownloadUrl(fileId) {
      return httpClient.query(ref("files.getDownloadUrl"), { fileId });
    },

    // Context
    async getMessage(messageId) {
      return httpClient.query(pubRef("messages.get"), { messageId });
    },
    async getThreadContext(threadId) {
      // getContext is an internalQuery -- safe to call via query
      return httpClient.query(ref("threads.getContext"), { threadId });
    },
    async updateThreadSummary(threadId, contextSummary) {
      await httpClient.mutation(ref("threads.updateSummary"), { threadId, contextSummary });
    },

    // Subscription: uses public query over WebSocket for real-time push
    // BuildBrain-Backend added agentJobs.getPendingPublic for this purpose
    subscribeToPendingJobs(callback) {
      return wsClient.onUpdate(
        pubRef("agentJobs.getPendingPublic"),
        {},
        callback,
      );
    },

    dispose() {
      wsClient.close();
    },
  };
}
