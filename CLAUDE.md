# BuildBrain

BIM Intelligence Agent -- full-stack web app for querying IFC building models and PDF construction documents, cross-validating data between them, and generating construction deliverables.

## Architecture

Three-tier architecture:

```
Next.js (Vercel)  <-->  Convex (backend)  <-->  Agent VM (sprites.dev)
```

- **Frontend**: Next.js 15, React 19, Tailwind v4, shadcn/ui, dockview v5 (4-panel layout)
- **Backend**: Convex (10 tables, real-time subscriptions, file storage, Clerk auth)
- **Agent VM**: Pi SDK (RPC mode) + Python CLI tools (IfcOpenShell, pdfplumber) on sprites.dev

## Key Principle

**LLMs never do arithmetic.** IfcOpenShell computes all quantities. The agent only formats, reasons, and cross-validates.

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
│   ├── schema.ts                # 10-table schema
│   ├── auth.config.ts           # Clerk auth config
│   ├── crons.ts                 # Stale job detector
│   ├── seed.ts                  # Test fixtures
│   └── *.ts                     # Domain modules (queries + mutations)
├── agent/                       # Agent VM service
│   ├── src/
│   │   ├── index.ts             # Entry point, job queue
│   │   ├── agent-session.ts     # Pi SDK integration
│   │   ├── tool-runner.ts       # Python subprocess executor
│   │   ├── stream-writer.ts     # Throttled delta writes
│   │   └── tools/               # CLI tool definitions
│   └── Dockerfile               # VM deployment image
├── hooks/                       # React hooks (streaming, project data, chat)
├── lib/                         # Utils, types, contexts
│   └── dock/                    # Dockview constants + helpers
├── skills/                      # Claude Code plugin skills (V1)
│   └── cli-tools/scripts/       # Python CLI tools
├── specs/                       # Specifications
│   ├── spec.md                  # V1 PRD
│   └── v2-vision.md             # V2 vision doc
├── scripts/                     # Utility scripts (style extraction)
├── public/                      # Static assets (IFC samples, workers, PDFs)
├── data/                        # Input files (gitignored)
├── output/                      # Generated reports + design tokens (gitignored)
└── requirements.txt             # Python deps
```

## Panels

| Panel | Key | Description |
|-------|-----|-------------|
| Assistant | chat | AI chat with streaming, tool calls, suggestion chips |
| Model | ifc | IFC 3D viewer (@thatopen/components), WebGL, click/hover |
| Workbench | workbench | Tabs: Artifacts, Issues, Elements with dynamic tables |
| Drawings | pdf | PDF viewer with file tabs |

## Convex Schema

10 tables: `users`, `projects`, `files`, `threads`, `messages`, `streamDeltas`, `agentJobs`, `artifacts`, `issues`, `elementGroups` + `elements`

Key patterns:
- `agentJobs` is the coordination layer (frontend -> Convex -> agent VM)
- `streamDeltas` for ephemeral chat streaming (cleaned up after finalize)
- Hybrid artifact storage (inline <100KB, file storage for large)
- Clerk auth (free tier, 50K MRUs)

## Agent VM

Stateless compute on sprites.dev. Pulls files from Convex, processes with Python tools, pushes results back.

- Pi SDK in RPC mode with 5 registered CLI tools (14 commands total)
- Convex WebSocket subscription for real-time job pickup
- Heartbeat + stale job detection for crash recovery

## Design

Linear-inspired. Design tokens extracted from live Linear app stored in `output/linear-app-tokens-merged.json`.

Key values: Inter Variable font, LCH color space (hue 282), font-weight 450 for normal, Berkeley Mono for code.

## Tech Stack

- **Frontend:** Next.js 15, React 19, Tailwind v4, shadcn/ui, dockview v5
- **IFC Viewer:** @thatopen/components (Three.js + web-ifc WASM)
- **Backend:** Convex (real-time, file storage, crons)
- **Auth:** Clerk (OIDC/JWT)
- **Agent:** Pi SDK, IfcOpenShell 0.8.x, pdfplumber, pandas
- **Deployment:** Vercel (frontend), Convex cloud (backend), sprites.dev VM (agent)

## References

Full spec: `specs/spec.md`
V2 vision: `specs/v2-vision.md`
Design tokens: `output/linear-app-tokens-merged.json`
CLI reference: `/cli-tools`

<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->
