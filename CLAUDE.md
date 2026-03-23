# BuildBrain

BIM Intelligence Agent -- full-stack web app for querying IFC building models and PDF construction documents, cross-validating data between them, and generating construction deliverables.

## Architecture

Two-tier architecture:

```
Next.js 15 (Vercel)  <-->  Convex (everything else)
```

No VM. No Docker. No Python. No separate microservice.

- **Frontend**: Next.js 15, React 19, Tailwind v4, shadcn/ui, dockview v5 (4-panel layout)
- **Backend**: Convex (agent orchestration, file storage, real-time streaming, document intelligence, Clerk auth)

## Key Principle

**LLMs never do arithmetic.** web-ifc computes all quantities via Qto property sets. The agent only formats, reasons, and cross-validates.

## Project Structure

```
buildbrain/
├── app/                         # Next.js pages
│   ├── globals.css              # Design tokens, dockview overrides
│   ├── layout.tsx               # Root layout, providers
│   └── page.tsx                 # Main page with dockview workspace
├── components/
│   ├── dock/workspace.tsx       # Dockview panel manager
│   ├── panels/                  # Panel components (chat, ifc, pdf, workbench)
│   ├── providers.tsx            # Convex + Clerk providers
│   └── ui/                      # shadcn/ui components
├── convex/                      # Convex backend
│   ├── convex.config.ts         # App config + agent component registration
│   ├── schema.ts                # Schema (app tables + agent component tables)
│   ├── agents/                  # Convex Agent definition, streaming, actions
│   │   ├── definition.ts        # Agent config (model, tools, context)
│   │   ├── actions.ts           # Queries/mutations (sendMessage, listMessages)
│   │   └── streaming.ts         # Stream response action
│   ├── tools/                   # Agent tools (query pre-extracted data)
│   │   ├── ifc-query.ts         # Query IFC elements from structured store
│   │   ├── pdf-query.ts         # Query PDF schedule rows + drawing register
│   │   ├── cross-validate.ts    # Cross-validation: join elements vs schedule rows
│   │   ├── search.ts            # Full-text + semantic search across PDF pages
│   │   ├── ifc-extract.ts       # On-demand IFC extraction trigger
│   │   └── index.ts             # Re-exports all tools
│   ├── ifc/                     # web-ifc extraction library
│   │   ├── parser.ts            # Core IFC parsing with web-ifc WASM
│   │   ├── properties.ts        # Pset/Qto extraction
│   │   ├── materials.ts         # Material traversal (all 6 patterns)
│   │   ├── quantities.ts        # Qto extraction
│   │   ├── spatial.ts           # Spatial hierarchy + storey resolution
│   │   ├── validate.ts          # Data quality checks
│   │   └── types.ts             # TypeScript types for IFC data
│   ├── pdf/                     # PDF extraction library
│   │   ├── parser.ts            # pdf.js text extraction
│   │   ├── tables.ts            # Grid-based table detection
│   │   ├── schedules.ts         # Schedule classification + multi-page merging
│   │   ├── classifier.ts        # Page classification
│   │   └── types.ts             # TypeScript types for PDF data
│   ├── ingest/                  # Document intelligence pipeline
│   │   ├── pipeline.ts          # Pipeline orchestration + status tracking
│   │   ├── ifc-scanner.ts       # Phase 0: IFC manifest generation
│   │   ├── ifc-extractor.ts     # Phase 1: Deep IFC extraction
│   │   ├── pdf-scanner.ts       # Phase 0: PDF manifest generation
│   │   └── pdf-extractor.ts     # Phase 1: Table extraction + schedule classification
│   ├── auth.config.ts           # Clerk auth config
│   ├── seed.ts                  # Test fixtures
│   └── *.ts                     # Domain modules (files, projects, users, artifacts, etc.)
├── hooks/                       # React hooks (chat via Convex Agent, project data)
├── lib/                         # Utils, types, contexts
│   └── dock/                    # Dockview constants + helpers
├── agent/                       # [V2 legacy] Agent VM service -- pending removal
├── skills/                      # Claude Code plugin skills (V1)
├── specs/                       # Specifications
│   ├── spec.md                  # V1 PRD
│   ├── v2-vision.md             # V2 vision doc
│   └── v3-architecture.md       # V3 architecture spec (current)
├── scripts/                     # Utility scripts (style extraction)
├── public/                      # Static assets (IFC samples, workers, PDFs)
├── data/                        # Input files (gitignored)
└── output/                      # Generated reports + design tokens (gitignored)
```

## Panels

| Panel | Key | Description |
|-------|-----|-------------|
| Assistant | chat | AI chat with streaming, tool calls, suggestion chips |
| Model | ifc | IFC 3D viewer (@thatopen/components), WebGL, click/hover |
| Workbench | workbench | Tabs: Artifacts, Issues, Elements with dynamic tables |
| Drawings | pdf | PDF viewer with file tabs |

## Convex Schema

App tables: `users`, `projects`, `files`, `artifacts`, `issues`, `elementGroups`, `elements`, `pdfPages`, `pdfScheduleRows`, `projectThreads`

Agent component tables (managed by `@convex-dev/agent`): threads, messages, streamDeltas

Key patterns:
- `projectThreads` links Convex Agent threads to projects
- `pdfPages` + `pdfScheduleRows` are the document intelligence cache (populated by ingest pipeline)
- `files.extractionStatus` tracks pipeline progress (pending -> scanning -> scanned -> extracting -> extracted -> ready)
- `files.manifest` stores lightweight file summaries loaded into agent system prompt
- Hybrid artifact storage (inline <100KB, file storage for large)
- Clerk auth (OIDC/JWT)

## Document Intelligence Pipeline

Files are processed on upload into a structured store. The agent queries pre-extracted data, never raw files.

```
Upload -> Phase 0: Manifest (fast, <5s) -> Phase 1: Deep Extraction (background) -> Phase 2: Search Index
```

File manifests give the agent orientation about what data is available (like a CLAUDE.md for each document).

## Agent Tools

Tools query pre-extracted data -- they are database queries, not parsers.

| Tool | Description |
|------|-------------|
| queryIfcElements | Look up IFC element properties, quantities, materials |
| queryScheduleRows | Look up PDF schedule data (door/window/finish schedules) |
| getDrawingRegister | Get page index with classifications and drawing numbers |
| crossValidate | Compare IFC elements against PDF schedule rows by mark/tag |
| searchPages | Full-text + semantic search across PDF pages |
| extractIfcElements | Trigger on-demand extraction for a specific element type |

## Design

Linear-inspired. Design tokens extracted from live Linear app stored in `output/linear-app-tokens-merged.json`.

Key values: Inter Variable font, LCH color space (hue 282), font-weight 450 for normal, Berkeley Mono for code.

## Tech Stack

- **Frontend:** Next.js 15, React 19, Tailwind v4, shadcn/ui, dockview v5
- **IFC Viewer:** @thatopen/components (Three.js + web-ifc WASM)
- **Backend:** Convex (real-time, file storage, agent orchestration)
- **Agent:** @convex-dev/agent v0.6.x, AI SDK v6, Anthropic Claude, OpenAI embeddings
- **IFC Parsing:** web-ifc (WASM, server-side in Convex actions)
- **PDF Parsing:** pdfjs-dist (legacy build, server-side in Convex actions)
- **Auth:** Clerk (OIDC/JWT)
- **Deployment:** Vercel (frontend), Convex cloud (backend)

## References

Full V3 spec: `specs/v3-architecture.md`
V1 spec: `specs/spec.md`
V2 vision: `specs/v2-vision.md`
Design tokens: `output/linear-app-tokens-merged.json`

<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->
