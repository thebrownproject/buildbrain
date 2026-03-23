# BuildBrain V3 Architecture Spec

**Date:** 2026-03-23
**Status:** Implemented (MVP deployed to Convex, E2E tested)
**Author:** Fraser + Hal

## Summary

Eliminate the agent VM and Python dependency entirely. Rebuild BuildBrain as a single-stack TypeScript application using Convex for agent orchestration, file storage, real-time streaming, and persistent memory. Replace IfcOpenShell with web-ifc (WASM). Replace pdfplumber with pdf.js + custom grid-based table detection.

**New in this revision:** Document Intelligence Pipeline architecture -- files are processed on upload into a structured store. The agent queries pre-extracted data, never raw files. File manifests give the agent orientation (like a CLAUDE.md for each document).

## Architecture

```
Next.js 15 (Vercel)  <-->  Convex (everything else)
```

No VM. No Docker. No Python. No Pi SDK. No separate microservice.

### What Convex Handles

| Concern | V2 (Current) | V3 (Proposed) |
|---------|-------------|---------------|
| Agent orchestration | Pi SDK on VM | Convex Agent (`@convex-dev/agent` v0.6.x) |
| LLM calls | Anthropic API from VM | AI SDK v6 provider from Convex action |
| Conversation threads | Custom tables + manual code | Convex Agent threads (built-in) |
| Message persistence | Custom messages table + streaming | Convex Agent messages (built-in) |
| Streaming | Custom streamDeltas table + flush loop | Convex Agent streaming (WebSocket deltas, built-in) |
| Context/memory | Manual recent messages + contextSummary | Convex Agent contextOptions (auto vector + text search) |
| Tool execution | Python subprocess on VM | Convex Node.js actions (web-ifc WASM, pdf.js) |
| File storage | Convex _storage (unchanged) | Convex _storage (unchanged) |
| Job queue | Custom agentJobs table + cron | Convex Agent workflows / scheduled actions |
| IFC parsing | IfcOpenShell (Python + C++) | web-ifc (WASM, runs in Node.js action) |
| PDF extraction | pdfplumber (Python, on-demand) | pdf.js + custom table detection (background pipeline) |
| Document intelligence | None (re-parse every time) | Extract-on-upload pipeline with structured cache |

### Component Map

```
buildbrain/
├── app/                          # Next.js 15 pages (unchanged)
├── components/                   # React components (unchanged)
├── hooks/                        # React hooks (simplified - Convex Agent handles more)
├── lib/                          # Utils, types, contexts
├── convex/
│   ├── convex.config.ts          # App config + agent component registration
│   ├── schema.ts                 # Simplified schema (agent manages threads/messages)
│   ├── agents.ts                 # BuildBrain agent definition
│   ├── tools/                    # Agent tools (Convex actions) — query pre-extracted data
│   │   ├── ifc-query.ts          # Query IFC elements from structured store
│   │   ├── pdf-query.ts          # Query PDF pages/schedules from structured store
│   │   ├── cross-validate.ts     # Cross-validation: join elements against schedule rows
│   │   ├── search.ts             # Full-text + semantic search across project files
│   │   └── ifc-extract.ts        # On-demand IFC extraction (if not yet cached)
│   ├── ingest/                   # Document intelligence pipeline (background)
│   │   ├── ifc-scanner.ts        # Phase 0: IFC manifest generation
│   │   ├── ifc-extractor.ts      # Phase 1: Deep IFC extraction
│   │   ├── pdf-scanner.ts        # Phase 0: PDF manifest generation
│   │   ├── pdf-extractor.ts      # Phase 1: Table extraction + schedule classification
│   │   └── pipeline.ts           # Pipeline orchestration + status tracking
│   ├── ifc/                      # web-ifc extraction library
│   │   ├── parser.ts             # Core IFC parsing with web-ifc
│   │   ├── properties.ts         # Pset/Qto extraction (uses Properties helper)
│   │   ├── materials.ts          # Material traversal (all 6 patterns)
│   │   ├── quantities.ts         # Qto extraction (geometry deferred from MVP)
│   │   ├── spatial.ts            # Spatial hierarchy + storey resolution
│   │   ├── validate.ts           # Data quality checks
│   │   └── types.ts              # TypeScript types for IFC data
│   ├── pdf/                      # PDF extraction library
│   │   ├── parser.ts             # pdf.js text extraction (pdfjs-dist legacy build)
│   │   ├── tables.ts             # Grid-based table detection (ported from pdf-table-extractor)
│   │   ├── schedules.ts          # Schedule classification + multi-page merging
│   │   ├── classifier.ts         # Page classification (schedule/plan/notes/detail/cover)
│   │   └── types.ts              # TypeScript types for PDF data
│   ├── files.ts                  # File upload/download + pipeline trigger
│   ├── projects.ts               # Project CRUD (unchanged)
│   ├── users.ts                  # User identity (unchanged)
│   ├── artifacts.ts              # Generated outputs (unchanged)
│   ├── issues.ts                 # Validation issues (unchanged)
│   ├── elements.ts               # Element records (unchanged)
│   └── elementGroups.ts          # Element groups (unchanged)
├── convex.json                   # External packages config (web-ifc, pdfjs-dist)
├── public/
│   └── web-ifc/                  # web-ifc WASM files (for client-side IFC viewer)
└── package.json
```

## Document Intelligence Pipeline

### Core Concept: File Manifests

Every uploaded file produces a **manifest** -- a lightweight summary that the agent loads into its system prompt. The manifest is like a CLAUDE.md for each document: it gives the agent complete orientation about what data is available and where to find it, without stuffing raw content into context.

**IFC Manifest** (~200 tokens):
```
Office_Building.ifc | IFC4 | 2.3 MB
Storeys: Ground Floor, Level 1, Level 2, Roof
Elements: 142 walls, 47 doors, 63 windows, 24 columns, 18 beams, 12 slabs
Types: 8 door types, 5 window types, 3 wall types
Pset coverage: 94% (some IfcDoor missing Pset_DoorCommon)
Qto coverage: 98%
```

**PDF Manifest** (~300 tokens):
```
A-Series_Drawings.pdf | 42 pages
p1      Cover (A0.01)
p2-3    General Notes (A0.02-03)
p4-8    Floor Plans (A1.01-05)
p12-13  Door Schedule — 47 rows | Mark|Size|Type|FRL|Hardware|Finish
p14-15  Window Schedule — 31 rows | Mark|Size|Glazing|U-Value|Frame
p16     Finish Schedule — 24 rows | Room|Floor|Walls|Ceiling
p17-42  Details and Sections
```

The agent reads these manifests and immediately knows:
- "47 doors in the IFC, 47 rows in the PDF door schedule -- I can cross-validate"
- "The door schedule has a Fire Rating column -- I can check against Pset_DoorCommon.FireRating"
- "General notes are on pages 2-3 if the user asks about project specs"

### Pipeline Architecture

```
Upload file to Convex storage
        │
        ▼
Phase 0: MANIFEST (sync or fast background, <5s)
  IFC: open model, count element types, list storeys, check schema
  PDF: text per page, classify pages, detect title blocks, find schedules
  → Store manifest on files table
  → Agent context now includes this file
        │
        ▼
Phase 1: DEEP EXTRACTION (background, 1-5 min)
  IFC: full property/material/quantity extraction → elements + elementGroups tables
  PDF: table grid detection on schedule pages → pdfScheduleRows table
  → Update manifest with richer metadata (column names, coverage stats)
        │
        ▼
Phase 2: SEARCH INDEX (background)
  Embed page text for semantic search (Convex Agent vector store)
  Full-text index on pdfPages.text for keyword search
```

### Pipeline Status Tracking

The `files` table gains an `extractionStatus` field:

```
"pending"    → file uploaded, pipeline not started
"scanning"   → Phase 0 running
"scanned"    → Phase 0 complete, manifest available
"extracting" → Phase 1 running
"extracted"  → Phase 1 complete, structured data available
"indexing"   → Phase 2 running
"ready"      → fully processed, all queries available
"failed"     → pipeline error (with error message)
```

The frontend shows extraction progress. The agent can answer questions as soon as Phase 0 completes (using manifest + page text), with richer answers available after Phase 1.

### Agent Tool Architecture

The agent's tools query pre-extracted data. They are database queries, not parsers.

**V2 flow (re-parse every time):**
```
User asks → Agent → spawn Python subprocess → parse file → answer
```

**V3 flow (query structured store):**
```
User asks → Agent reads manifest → Agent calls query tool → database lookup → answer
```

Agent tools:
```typescript
// Structured access (instant, preferred path)
queryScheduleRows({ scheduleType: "door", filter?: { property: "FireRating", value: "FRL-30" } })
queryIfcElements({ elementType: "IfcDoor", property?: "Pset_DoorCommon.FireRating" })
getDrawingRegister({ fileId })  // returns page index from manifest

// Cross-validation (the money feature)
crossValidate({ ifcType: "IfcDoor", scheduleType: "door", matchBy: "mark" })
  // → joins elements against pdfScheduleRows by mark/tag
  // → returns PASS/MISMATCH/ABSENT per property per element

// Search (fallback for unstructured questions)
searchPages({ query: "acoustic requirements", fileId? })
getPageText({ fileId, pageNumber })

// On-demand extraction (if pipeline hasn't completed yet)
extractIfcElements({ fileId, elementType })  // triggers Phase 1 for specific type
```

### Cross-Validation via Mark/Tag Join

The **mark/tag** is the universal join key between IFC elements and PDF schedule rows:
- IFC: `IfcDoor.Tag = "101"` or `Pset_DoorCommon.Reference = "101"`
- PDF: Door schedule row with Mark column = "101"

The `crossValidate` tool performs this join server-side:
1. Query `elements` by type → get all doors with properties
2. Query `pdfScheduleRows` by schedule type → get all schedule rows
3. Match by normalized mark (strip prefixes, separators, leading zeros)
4. Compare properties → PASS (match), MISMATCH (conflict), ABSENT (one source missing value)
5. Return structured discrepancy report

## Agent Definition

```typescript
// convex/agents.ts
import { Agent } from "@convex-dev/agent";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { components } from "./_generated/api";
import {
  queryIfcElementsTool,
  queryScheduleRowsTool,
  crossValidateTool,
  searchPagesTool,
  getDrawingRegisterTool,
  extractIfcElementsTool,
} from "./tools";

export const buildBrainAgent = new Agent(components.agent, {
  name: "BuildBrain",
  languageModel: anthropic("claude-sonnet-4-6"),
  embeddingModel: openai.embedding("text-embedding-3-small"), // Anthropic doesn't serve embeddings
  instructions: buildSystemPrompt, // dynamically built per-thread, see below
  tools: {
    queryIfcElements: queryIfcElementsTool,
    queryScheduleRows: queryScheduleRowsTool,
    crossValidate: crossValidateTool,
    searchPages: searchPagesTool,
    getDrawingRegister: getDrawingRegisterTool,
    extractIfcElements: extractIfcElementsTool,
  },
  maxSteps: 10,
  contextOptions: {
    recentMessages: 50,
    searchOtherThreads: false,
    searchOptions: {
      limit: 10,
      textSearch: true,
      vectorSearch: true,
      messageRange: { before: 2, after: 1 },
    },
  },
});
```

### Agent Entry Point

```typescript
// convex/agents.ts (continued)
export const sendMessage = mutation({
  args: { prompt: v.string(), threadId: v.string() },
  handler: async (ctx, { prompt, threadId }) => {
    const { messageId } = await buildBrainAgent.saveMessage(ctx, {
      threadId, prompt, skipEmbeddings: true,
    });
    await ctx.scheduler.runAfter(0, internal.agents.streamResponse, {
      threadId, promptMessageId: messageId,
    });
  },
});

export const streamResponse = internalAction({
  args: { promptMessageId: v.string(), threadId: v.string() },
  handler: async (ctx, { promptMessageId, threadId }) => {
    const result = await buildBrainAgent.streamText(
      ctx,
      { threadId },
      { promptMessageId },
      { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
    );
    await result.consumeStream();
  },
});

export const listMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    const streams = await syncStreams(ctx, components.agent, {
      threadId: args.threadId, streamArgs: args.streamArgs,
    });
    const paginated = await listUIMessages(ctx, components.agent, args);
    return { ...paginated, streams };
  },
});
```

### System Prompt (with File Manifests)

Dynamically built per-thread from project metadata + file manifests:

```
You are BuildBrain, a BIM Intelligence Agent for the Australian construction industry.

## Project
Name: {project.name}
Building Class: {metadata.buildingClass}, State: {metadata.state}

## Files

### Office_Building.ifc
IFC4 | 2.3 MB | Status: ready
Storeys: Ground Floor, Level 1, Level 2, Roof
Elements: 142 walls, 47 doors, 63 windows, 24 columns, 18 beams, 12 slabs
Types: 8 door types, 5 window types, 3 wall types
Pset coverage: 94% | Qto coverage: 98%

### A-Series_Drawings.pdf
42 pages | Status: ready
p1      Cover (A0.01)
p2-3    General Notes (A0.02-03)
p4-8    Floor Plans (A1.01-05)
p12-13  Door Schedule — 47 rows | Mark|Size|Type|FRL|Hardware|Finish
p14-15  Window Schedule — 31 rows | Mark|Size|Glazing|U-Value|Frame
p16     Finish Schedule — 24 rows | Room|Floor|Walls|Ceiling
p17-42  Details and Sections

## Rules
1. NEVER compute quantities yourself - use the queryIfcElements tool
2. Australian conventions: "storey" not "story", FRL notation per AS 1530.4, metric (mm/m2/m3)
3. Null properties display as "-"
4. Cross-validation categories: MISMATCH (conflicting), ABSENT (one source missing), PASS
5. Large results (>50 elements): summarize key findings, full data saved as artifact
6. Always suggest next steps after each response
7. Query pre-extracted data first. Only trigger extraction if data is not yet available.

## Tools
- queryIfcElements: Look up IFC element properties, quantities, materials from the structured store
- queryScheduleRows: Look up PDF schedule data (door/window/finish schedules)
- crossValidate: Compare IFC elements against PDF schedule rows by mark/tag
- searchPages: Full-text + semantic search across PDF pages
- getDrawingRegister: Get page index with classifications and drawing numbers
- extractIfcElements: Trigger on-demand extraction for a specific element type

## Workflow Patterns
- Scan: Read file manifests above for project overview
- Drill: Use queryIfcElements or queryScheduleRows for specific data
- Cross-validate: Use crossValidate to compare IFC data vs PDF schedules
- Search: Use searchPages for free-text questions about drawings
- Report: Generate QTO tables, compliance checklists, material takeoffs from structured data
```

## IFC Extraction (web-ifc)

### Key APIs (from research)

web-ifc v0.0.77 provides:
- `api.properties.getPropertySets(modelId, expressId, true)` — property set extraction
- `api.properties.getMaterialsProperties(modelId, expressId, true)` — material extraction
- `api.properties.getTypeProperties(modelId, expressId, true)` — type product lookup
- `api.properties.getSpatialStructure(modelId, true)` — spatial hierarchy
- `api.GetLineIDsWithType(modelId, IFCDOOR)` — element queries by type
- `api.GetModelSchema(modelId)` — schema detection (IFC2X3/IFC4/IFC4X3)

All IFC type constants are exported: `IFCWALL`, `IFCDOOR`, `IFCWINDOW`, `IFCBEAM`, `IFCCOLUMN`, `IFCSLAB`, `IFCROOF`, `IFCSTAIR`, etc.

### Capability Mapping

| Capability | IfcOpenShell | web-ifc Equivalent |
|-----------|-------------|-------------------|
| Open/parse IFC | `ifcopenshell.open(path)` | `ifcApi.OpenModel(buffer)` |
| Get elements by type | `model.by_type("IfcDoor")` | `ifcApi.GetLineIDsWithType(modelId, IFCDOOR)` |
| Get all Psets | `get_psets(el, psets_only=True)` | `api.properties.getPropertySets(modelId, expressId, true)` |
| Get material | `get_material(el)` | `api.properties.getMaterialsProperties(modelId, expressId, true)` |
| Get spatial container | `get_container(el)` | Traverse `IfcRelContainedInSpatialStructure` |
| Get type product | `get_type(el)` | `api.properties.getTypeProperties(modelId, expressId, true)` |
| Spatial hierarchy | `model.by_type("IfcBuildingStorey")` | `api.properties.getSpatialStructure(modelId, true)` |
| Schema version | `model.schema` | `ifcApi.GetModelSchema(modelId)` |
| Geometry computation | `ifcopenshell.util.shape.*` | **Deferred from MVP** — flag missing Qto sets as validation issues |
| Stair decomposition | `stair.IsDecomposedBy` | Traverse `IfcRelAggregates` |

### Geometry Computation — Deferred

Geometry-based quantity computation (area/volume from mesh data) is **deferred from MVP**. web-ifc provides raw mesh vertices/indices but no built-in `get_volume()` or `get_area()` like IfcOpenShell. For MVP:
- Extract quantities from Qto_ property sets (covers ~95% of well-authored models)
- Flag elements missing Qto sets as validation issues
- Phase 2: implement mesh math (signed volume via divergence theorem, projected areas)

### Memory Constraints

Convex Node.js actions have 512MB memory (hard limit, not configurable).

| File Size | Memory Usage (property extraction) | Feasible |
|-----------|-----------------------------------|----------|
| 2-5 MB | ~50-100 MB | Yes |
| 10-30 MB | ~200-400 MB | Tight but yes |
| 50+ MB | May exceed 512MB | Needs chunked processing |

Test files in repo: 2.3 MB, 2.5 MB, 13 MB — all within limits.

**Critical:** Always call `ifcApi.CloseModel(modelId)` and `ifcApi.Dispose()` after processing. WASM memory is not garbage-collected.

## PDF Extraction (pdf.js)

### Package Strategy

No existing JS package is production-ready for construction schedule extraction:
- **pdfexcavator**: Algorithm sound but abandoned after 2 weeks (0.1.x, zero community validation)
- **pdf-table-extractor**: Right algorithm for gridded tables but uses ancient pdfjs-dist v1.5
- **tabula-js**: Requires Java — won't work in Convex

**Chosen approach:** Port the `pdf-table-extractor` grid-detection algorithm (~300 lines) onto modern `pdfjs-dist` (v5.x, legacy build for Node.js). This gives us a proven line-detection approach for construction schedules (which always have drawn grid lines) on a zero-native-dependency foundation.

### How Table Detection Works

Construction schedules use visible grid lines (drawn as PDF path operations). The detection algorithm:

1. Call `page.getOperatorList()` to get drawing operations
2. Find `constructPath` operations (OPS code 91) containing `moveTo`, `lineTo`, `rectangle`
3. Track the current transformation matrix via `save`/`restore`/`transform` operations
4. Classify extracted edges as horizontal or vertical
5. Find intersections → build grid coordinates
6. Map `page.getTextContent()` items into grid cells using position matching
7. Return structured table: `{ headers: string[], rows: string[][] }`

### Page Classification

Heuristic-based classification (drawing number prefix + title keywords + content signals):

| Signal | Weight | Example |
|--------|--------|---------|
| Drawing number type digit (NCS) | Highest | A-**6**01 → type 6 = schedule |
| Title block keywords | High | "DOOR SCHEDULE", "GENERAL NOTES" |
| Content analysis | Medium | High grid density = schedule, dense text = notes |

Classifications: `schedule`, `plan`, `section`, `detail`, `elevation`, `notes`, `cover`, `legend`

### Schedule Classification

Port directly from pdf_extract.py — pure string matching:

| Schedule Type | Primary Headers | Secondary Headers |
|--------------|----------------|-------------------|
| door_schedule | mark, door no, door number, door ref | size, type, fire rating, frl, hardware, material, finish, frame, lock |
| window_schedule | mark, window no, window number | size, glazing, u-value, operability, frame, acoustic, bushfire |
| finish_schedule | room, room no, room name, space | floor, ceiling, wall, skirting, cornice, paint |

Scoring: primary match +0.3, title regex +0.3, secondary match +0.1. Cap at 1.0, threshold > 0.35.

### Multi-Page Schedule Merging

Same logic as pdf_extract.py:
- Same schedule type + consecutive pages + identical headers → merge rows
- Remove duplicate header rows from continuation pages
- Track source pages array

## Schema Changes

### Removed tables
- `threads` (managed by Convex Agent component)
- `messages` (managed by Convex Agent component)
- `streamDeltas` (managed by Convex Agent component)
- `agentJobs` (replaced by scheduled actions + pipeline status on files table)

### New tables

```typescript
// Link Convex Agent threads to projects
projectThreads: defineTable({
  projectId: v.id("projects"),
  agentThreadId: v.string(),
  userId: v.id("users"),
  createdAt: v.number(),
}).index("by_project", ["projectId"])
  .index("by_project_user", ["projectId", "userId"]),

// Document intelligence: page-level cache (Phase 0 output)
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
}).index("by_file_page", ["fileId", "pageNumber"])
  .index("by_project_type", ["projectId", "classification"])
  .searchIndex("search_text", {
    searchField: "text",
    filterFields: ["projectId", "fileId"],
  }),

// Document intelligence: structured schedule rows (Phase 1 output)
pdfScheduleRows: defineTable({
  fileId: v.id("files"),
  projectId: v.id("projects"),
  scheduleType: v.string(),               // door_schedule|window_schedule|finish_schedule
  mark: v.string(),                        // "D-01", "W-14" — the cross-validation join key
  properties: v.any(),                     // { Size: "820x2040", FireRating: "FRL-30", ... }
  sourcePages: v.array(v.number()),
  extractedAt: v.number(),
}).index("by_project_schedule", ["projectId", "scheduleType"])
  .index("by_project_mark", ["projectId", "mark"])
  .index("by_file", ["fileId"]),
```

### Modified tables

**`files` table gains:**
- `extractionStatus`: `pending|scanning|scanned|extracting|extracted|indexing|ready|failed`
- `manifest`: stored JSON object with the file manifest data (element counts, drawing register, etc.)

### Unchanged tables
`users`, `projects`, `files` (extended), `artifacts`, `issues`, `elementGroups`, `elements`

### Crons
Remove `stale-job-detector` cron -- no job queue to monitor.

## Streaming

### V3 Architecture
```
Frontend mutation: sendMessage(prompt, threadId)
  → saveMessage (optimistic update via optimisticallySendMessage)
  → scheduler.runAfter(0, streamResponse)

Background action: streamResponse
  → buildBrainAgent.streamText(ctx, { threadId }, { promptMessageId }, { saveStreamDeltas })
  → Convex writes deltas to DB
  → WebSocket pushes to all subscribed clients

Frontend query: listMessages (with streamArgs)
  → listUIMessages + syncStreams
  → useUIMessages hook with stream: true
  → useSmoothText for text animation
```

No custom streaming code. No ephemeral delta table. No cleanup cron.

## Frontend Integration

```typescript
// React component
import { useUIMessages, optimisticallySendMessage } from "@convex-dev/agent/react";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";

function ChatPanel({ threadId }: { threadId: string }) {
  const { results, status, loadMore } = useUIMessages(
    api.agents.listMessages,
    { threadId },
    { initialNumItems: 20, stream: true },
  );

  const sendMessage = useMutation(api.agents.sendMessage).withOptimisticUpdate(
    optimisticallySendMessage(api.agents.listMessages),
  );

  // Tool call status visible in message.parts[]
  // States: input-streaming → input-available → output-available | output-error
}
```

## Dependencies

### Removed
```
@mariozechner/pi-coding-agent
@mariozechner/pi-ai
@sinclair/typebox
ifcopenshell (Python)
pdfplumber (Python)
pandas (Python)
python3 (system)
```

### Added
```
@convex-dev/agent          # Agent orchestration (v0.6.x, requires AI SDK v6)
ai                         # Vercel AI SDK v6 (^6.0.35) — peer dep of @convex-dev/agent
@ai-sdk/anthropic          # Claude model provider
@ai-sdk/openai             # OpenAI embeddings (text-embedding-3-small)
@ai-sdk/provider-utils     # AI SDK peer dep
convex-helpers             # Convex Agent peer dep
pdfjs-dist@4.10.38         # PDF parsing (v4 legacy build — v5 has core-js polyfill conflicts with Node 22)
unpdf                      # Serverless pdfjs wrapper (installed but pdfjs-dist v4 used instead)
zod                        # Tool argument schemas (v4 installed, compatible with AI SDK v6)
```

### Configuration

**`convex.json`** (project root, new file):
```json
{
  "node": {
    "externalPackages": ["web-ifc", "pdfjs-dist"],
    "nodeVersion": "22"
  }
}
```

**`convex/convex.config.ts`** (new file):
```typescript
import { defineApp } from "convex/server";
import agent from "@convex-dev/agent/convex.config";

const app = defineApp();
app.use(agent);
export default app;
```

**Environment variables** (set via `npx convex env set`):
```
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...     # for text-embedding-3-small only
```

### Unchanged
```
convex
next
react / react-dom
@thatopen/components       # IFC viewer (frontend only)
three / web-ifc            # Already in deps (now also used server-side in Convex actions)
dockview
tailwindcss / shadcn/ui
```

## Migration Path (Executed)

### Wave 0: Spike Tests — COMPLETE
- web-ifc WASM in Convex action: PASS (property extraction works within 512MB)
- pdf.js in Convex action: PASS (text + operator list extraction works)
- Convex Agent basic flow: PASS (threads, streaming, tools all verified)
- Review agent caught "use node" file separation issue — fixed before merge

### Wave 1: Foundation — COMPLETE
- Schema updated: 3 new tables + file extraction fields
- Dependencies installed, convex.json configured, agent component registered

### Wave 2: Libraries (3 parallel agents) — COMPLETE
- `convex/ifc/` (7 files): properties, materials, quantities, spatial, validation
- `convex/pdf/` (5 files): text extraction, grid-based table detection, schedule classification, page classification
- `convex/agents/` (3 files) + frontend hooks + chat panel wired to Convex Agent
- Review agents caught: QTO_PREFERENCES mismatch (NetSurfaceArea → CrossSectionArea), missing TYPE_SHORTHAND entries

### Wave 3: Integration (2 parallel agents) — COMPLETE
- `convex/ingest/` (5 files): pipeline orchestration, IFC/PDF scanners + extractors
- `convex/tools/` (7 files): 6 agent tools + shared queries
- Review agents caught: ctx.runMutation calling internalQuery (runtime crash), missing thread index, mark normalization gaps

### Wave 4: Cleanup — COMPLETE
- Tools wired into agent definition
- CLAUDE.md rewritten for V3

### Post-Wave: E2E Testing + Fixes
- Fixed 55 TypeScript errors for clean Convex deployment
- Renamed hyphenated tool files (Convex doesn't allow hyphens in module paths)
- Fixed pdfjs-dist v5 → v4 (core-js polyfill conflict with Node 22)
- Simplify pass: deduplicated extractStringValue (5→1), Promise.all for IFC extraction, shared helpers
- Fixed useElements pagination mismatch (build break)
- 20 UI tests passed via agent-browser

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| web-ifc WASM in Convex Node.js action | May fail to load | Mark as external package in convex.json; spike test first |
| web-ifc Properties helper less mature than IfcOpenShell | Some Psets/Qtos may not extract correctly | Fall back to raw GetLine API; test against all sample files |
| Grid-based table detection on complex construction PDFs | False positives from non-table lines (dimensions, borders) | Restrict extraction to pages classified as schedules |
| 512MB memory limit | Large IFC files may fail | Chunked element-by-element processing; most real projects <30MB |
| Convex Agent v0.6.x is pre-1.0 | API may change | Pin version; core patterns (threads, messages, tools) are stable |
| AI SDK v6 breaking changes | Tool API uses inputSchema not parameters | Follow migration guide; Zod v4 installed and compatible |
| pdfjs-dist v5 in Convex action | core-js polyfills conflict with Node 22 native Set methods | Downgraded to pdfjs-dist v4.10.38 legacy build — works correctly |
| No geometry-based quantities in MVP | Some elements will have no area/volume data | Clearly flag as validation issue; users can check Qto coverage |

## Implementation Status

### Completed (verified with E2E tests)

| Component | Status | Evidence |
|-----------|--------|----------|
| Convex deployment | DONE | Clean push, all functions registered |
| Schema (3 new tables + file extensions) | DONE | pdfPages, pdfScheduleRows, projectThreads |
| IFC extraction library (convex/ifc/) | DONE | 7 files, all material patterns, Qto extraction |
| PDF extraction library (convex/pdf/) | DONE | 5 files, grid-based table detection, schedule classification |
| Document intelligence pipeline (convex/ingest/) | DONE | IFC + PDF scanners and extractors with pipeline orchestration |
| Agent tools (convex/tools/) | DONE | 6 tools: ifcQuery, pdfQuery, crossValidate, search, drawingRegister, ifcExtract |
| Convex Agent integration (convex/agents/) | DONE | Agent definition, streaming, actions with proper file separation |
| Frontend chat panel | DONE | useUIMessages, optimistic updates, streaming, tool call display |
| IFC pipeline E2E | DONE | Manifest: IFC4, 5 walls, 1 door, 2 windows from demo_house.ifc |
| PDF pipeline E2E | DONE | Manifest: 1 page, table detected from finish schedule PDF |
| Agent chat E2E | DONE | Haiku 4.5 responds with markdown, tool calls return real IFC data |
| UI E2E (20 tests) | DONE | All panels, interactions, edge cases pass via agent-browser |

### Remaining (not blocking MVP)

| Item | Priority | Notes |
|------|----------|-------|
| Dynamic system prompt with file manifests | HIGH | Agent asks for project ID instead of knowing it from context |
| Artifact persistence from tool results | HIGH | Agent returns data inline, doesn't persist to artifacts table |
| Auth integration (Clerk) | HIGH | Hardcoded test project/user IDs in workspace |
| V2 agent/ directory deletion | LOW | Kept for reference, marked as legacy |
| Old schema tables removal | LOW | threads, messages, streamDeltas, agentJobs still in schema |
| Geometry-based quantity computation | DEFERRED | Qto property set extraction only for MVP |
| Vector search (OpenAI embeddings) | DEFERRED | Disabled until OPENAI_API_KEY set |

### Key Implementation Decisions Made During Build

1. **pdfjs-dist v4.10.38** used instead of v5 — v5's core-js polyfills conflict with Node 22's native `Set.prototype.intersection()`, causing `"s is not iterable"` errors
2. **Zod v4** installed (not v3) — compatible with @convex-dev/agent v0.6.1 and AI SDK v6
3. **OPS constants hardcoded** in tables.ts — stable across all pdfjs versions, avoids async initialization
4. **Haiku 4.5** as default model — cost-efficient for development, easily swapped to Sonnet/Opus
5. **"use node" file separation** strictly enforced — actions in separate files from queries/mutations per Convex guidelines
6. **Promise.all** for parallel per-element IFC extraction — 4x speedup over sequential calls
7. **Shared helpers** extracted — extractStringValue (5 copies → 1), BATCH_SIZE, MAX_RESULT_SIZE, formatError

## Success Criteria

- [x] File manifests generated within 5 seconds of upload
- [x] IFC element extraction produces equivalent output to ifc_extract.py (5 of 7 commands — geometry deferred)
- [ ] PDF schedule extraction detects and structures door/window/finish schedules correctly (table detection works, schedule row extraction needs more testing with door schedule PDFs)
- [x] Chat panel streams responses in real-time via Convex Agent
- [ ] Cross-validation produces correct MISMATCH/ABSENT/PASS results (tool works, needs door schedule data to validate)
- [x] Agent queries pre-extracted data (database lookups, not file parsing) for all common operations
- [x] No Python runtime, no Docker, no external VM
- [x] Single `npx convex dev` + `npm run dev` starts the entire stack

## Deployment

- **Convex project:** buildbrain-65feb
- **Dashboard:** https://dashboard.convex.dev/t/fraserbrown/buildbrain-65feb
- **Environment:** Node.js 22, web-ifc as external package
- **API keys:** ANTHROPIC_API_KEY set via `npx convex env set`
