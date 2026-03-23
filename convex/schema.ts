import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ── Users ──────────────────────────────────────────────────
  users: defineTable({
    clerkId: v.string(),
    name: v.string(),
    email: v.string(),
    avatarUrl: v.optional(v.string()),
    preferences: v.optional(
      v.object({
        dockviewLayout: v.optional(v.any()),
        lastProjectId: v.optional(v.id("projects")),
      })
    ),
  }).index("by_clerk_id", ["clerkId"]),

  // ── Projects ───────────────────────────────────────────────
  projects: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    ownerId: v.id("users"),
    metadata: v.optional(
      v.object({
        buildingClass: v.optional(v.string()),
        state: v.optional(v.string()),
        constructionType: v.optional(v.string()),
      })
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_owner", ["ownerId"]),

  // ── Files (IFC + PDF) ─────────────────────────────────────
  files: defineTable({
    projectId: v.id("projects"),
    storageId: v.id("_storage"),
    name: v.string(),
    type: v.union(v.literal("ifc"), v.literal("pdf")),
    sizeBytes: v.number(),
    uploadedBy: v.id("users"),
    uploadedAt: v.number(),
    revisionNumber: v.optional(v.number()),
    // IFC metadata (populated after scan)
    ifcSchema: v.optional(v.string()),
    elementCounts: v.optional(v.any()),
    storeyNames: v.optional(v.array(v.string())),
    validationScore: v.optional(v.number()),
    // PDF metadata (populated after scan)
    pageCount: v.optional(v.number()),
    schedulesFound: v.optional(
      v.array(
        v.object({
          type: v.string(),
          page: v.number(),
          rowCount: v.number(),
        })
      )
    ),
    // V3: Document intelligence pipeline fields
    extractionStatus: v.optional(v.string()), // pending|scanning|scanned|extracting|extracted|indexing|ready|failed
    manifest: v.optional(v.any()),            // JSON object with file manifest data (element counts, drawing register, etc.)
    extractionError: v.optional(v.string()),  // error message if extraction failed
  })
    .index("by_project", ["projectId"])
    .index("by_project_type", ["projectId", "type"]),

  // ── Threads ────────────────────────────────────────────────
  threads: defineTable({
    projectId: v.id("projects"),
    userId: v.id("users"),
    title: v.optional(v.string()),
    contextSummary: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_user", ["projectId", "userId"]),

  // ── Messages ───────────────────────────────────────────────
  messages: defineTable({
    threadId: v.id("threads"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    status: v.union(
      v.literal("complete"),
      v.literal("streaming"),
      v.literal("error")
    ),
    toolCalls: v.optional(
      v.array(
        v.object({
          id: v.string(),
          tool: v.string(),
          displayName: v.optional(v.string()),
          args: v.any(),
          result: v.optional(v.string()),
          status: v.union(
            v.literal("pending"),
            v.literal("running"),
            v.literal("complete"),
            v.literal("error")
          ),
          ephemeral: v.optional(v.boolean()),
        })
      )
    ),
    artifactIds: v.optional(v.array(v.id("artifacts"))),
    elementRefs: v.optional(
      v.array(
        v.object({
          globalId: v.string(),
          label: v.optional(v.string()),
        })
      )
    ),
    suggestions: v.optional(
      v.array(
        v.object({
          label: v.string(),
          prompt: v.string(),
        })
      )
    ),
    createdAt: v.number(),
  })
    .index("by_thread", ["threadId"])
    .index("by_thread_time", ["threadId", "createdAt"])
    .index("by_status", ["status"]),

  // ── Stream Deltas (ephemeral) ──────────────────────────────
  streamDeltas: defineTable({
    messageId: v.id("messages"),
    text: v.string(),
    index: v.number(),
    createdAt: v.number(),
  })
    .index("by_message", ["messageId"])
    .index("by_message_index", ["messageId", "index"]),

  // ── Agent Jobs ─────────────────────────────────────────────
  agentJobs: defineTable({
    projectId: v.id("projects"),
    type: v.union(
      v.literal("scan"),
      v.literal("extract"),
      v.literal("cross_validate"),
      v.literal("report"),
      v.literal("chat_response")
    ),
    status: v.union(
      v.literal("queued"),
      v.literal("claimed"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed")
    ),
    claimedBy: v.optional(v.string()),
    progress: v.optional(v.number()),
    progressMessage: v.optional(v.string()),
    estimatedDurationMs: v.optional(v.number()),
    input: v.any(),
    output: v.optional(v.any()),
    error: v.optional(v.string()),
    messageId: v.optional(v.id("messages")),
    retryCount: v.optional(v.number()),
    queuedAt: v.number(),
    claimedAt: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    lastHeartbeat: v.optional(v.number()),
  })
    .index("by_project", ["projectId"])
    .index("by_status", ["status"])
    .index("by_project_status", ["projectId", "status"]),

  // ── Artifacts ──────────────────────────────────────────────
  artifacts: defineTable({
    projectId: v.id("projects"),
    threadId: v.optional(v.id("threads")),
    messageId: v.optional(v.id("messages")),
    name: v.string(),
    type: v.union(
      v.literal("element_list"),
      v.literal("quantity_takeoff"),
      v.literal("pdf_schedule"),
      v.literal("cross_validation"),
      v.literal("compliance_check"),
      v.literal("model_summary")
    ),
    format: v.union(
      v.literal("csv"),
      v.literal("md"),
      v.literal("pdf"),
      v.literal("json")
    ),
    status: v.union(
      v.literal("generating"),
      v.literal("complete"),
      v.literal("failed")
    ),
    summary: v.optional(v.string()),
    contentInline: v.optional(v.any()),
    contentStorageId: v.optional(v.id("_storage")),
    elementType: v.optional(v.string()),
    sourceFile: v.optional(v.string()),
    createdAt: v.number(),
    createdBy: v.union(v.literal("user"), v.literal("agent")),
  })
    .index("by_project", ["projectId"])
    .index("by_project_type", ["projectId", "type"])
    .index("by_thread", ["threadId"]),

  // ── Issues ─────────────────────────────────────────────────
  issues: defineTable({
    projectId: v.id("projects"),
    artifactId: v.optional(v.id("artifacts")),
    severity: v.union(
      v.literal("error"),
      v.literal("warning"),
      v.literal("info"),
      v.literal("pass")
    ),
    title: v.string(),
    description: v.string(),
    source: v.string(),
    elementRef: v.optional(v.string()),
    elementGuid: v.optional(v.string()),
    status: v.union(
      v.literal("open"),
      v.literal("resolved"),
      v.literal("dismissed")
    ),
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_status", ["projectId", "status"])
    .index("by_artifact", ["artifactId"]),

  // ── Element Groups ─────────────────────────────────────────
  elementGroups: defineTable({
    projectId: v.id("projects"),
    fileId: v.id("files"),
    elementType: v.string(),
    displayName: v.string(),
    count: v.number(),
    columnOrder: v.array(v.string()),
    columnLabels: v.optional(v.any()),
    status: v.union(v.literal("partial"), v.literal("complete")),
    extractedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_file", ["fileId"]),

  // ── Elements ───────────────────────────────────────────────
  elements: defineTable({
    groupId: v.id("elementGroups"),
    projectId: v.id("projects"),
    globalId: v.string(),
    name: v.optional(v.string()),
    properties: v.any(),
  })
    .index("by_group", ["groupId"])
    .index("by_project", ["projectId"])
    .index("by_project_and_global_id", ["projectId", "globalId"]),

  // ── V3: PDF Pages (document intelligence, Phase 0 output) ─
  pdfPages: defineTable({
    fileId: v.id("files"),
    projectId: v.id("projects"),
    pageNumber: v.number(),
    text: v.string(),
    classification: v.optional(v.string()),   // schedule|plan|notes|detail|cover|elevation|section
    drawingNumber: v.optional(v.string()),    // "A5.01" from title block
    drawingTitle: v.optional(v.string()),     // "Door Schedule Level 1"
    hasTable: v.boolean(),
    extractedAt: v.number(),
  })
    .index("by_file_page", ["fileId", "pageNumber"])
    .index("by_project_classification", ["projectId", "classification"])
    .searchIndex("search_text", {
      searchField: "text",
      filterFields: ["projectId", "fileId"],
    }),

  // ── V3: PDF Schedule Rows (document intelligence, Phase 1 output) ─
  pdfScheduleRows: defineTable({
    fileId: v.id("files"),
    projectId: v.id("projects"),
    scheduleType: v.string(),               // door_schedule|window_schedule|finish_schedule
    mark: v.string(),                        // "D-01", "W-14" — the cross-validation join key
    properties: v.any(),                     // { Size: "820x2040", FireRating: "FRL-30", ... }
    sourcePages: v.array(v.number()),
    extractedAt: v.number(),
  })
    .index("by_project_schedule", ["projectId", "scheduleType"])
    .index("by_project_mark", ["projectId", "mark"])
    .index("by_file", ["fileId"]),

  // ── V3: Project Threads (link Convex Agent threads to projects) ─
  projectThreads: defineTable({
    projectId: v.id("projects"),
    agentThreadId: v.string(),
    userId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_user", ["projectId", "userId"]),
});
