# BuildBrain V2 — Vision & Scope

**Date:** March 2026
**Status:** Vision document — not for immediate build
**Prerequisite:** V1 prototype (complete — Claude Code plugin with IFC/PDF extraction)

---

## The Vision

An AI agent that can **read architecture drawings and help builders build**. Not a structured pipeline with commands — a conversational agent that understands buildings, reads whatever the architect hands over (IFC, PDF, CAD), and produces the outputs builders actually need for procurement and construction.

The user talks to it like they'd talk to an experienced estimator:

```
Builder: "Open the drawings and the IFC"
Agent:   "Got it. 3-storey residential, 47 doors, 142 walls,
          34 windows. PDF has door and window schedules."

Builder: "How many fire rated doors do we need?"
Agent:   "The PDF spec calls for 12 FRL-60 doors in stair cores.
          The IFC model has 0 doors with fire ratings set —
          the architect needs to update the model."

Builder: "Do a rough takeoff on the external walls"
Agent:   "External walls: 421m² total. 312m² brick veneer,
          109m² rendered blockwork.

          Brick veneer walls need:
          - 92x45 MGP10 studs @ 450 ctrs: 1,240 LM
          - R2.0 batts 90mm: 312 m²
          - 10mm plasterboard: 312 m²
          - Clay bricks (230x110x76): 15,600 bricks
          - Wall ties @ 600 ctrs: 1,040 ea"

Builder: "What does the energy report say about the north windows?"
Agent:   "NatHERS report requires U-value ≤ 3.2 for north-facing
          glazing. The window schedule specs Low-E at U=3.1.
          14 north-facing windows in the IFC model — compliant."
```

The agent meets architects and builders where they already are — reading the files they already produce. It doesn't ask anyone to change their workflow. It just gives their output a brain.

---

## What V1 Built

V1 is a working AI agent — Claude Code is the brain, the CLI tools are the hands:

- **Extraction tools** — `ifc_extract.py` reads IFC models, `pdf_extract.py` reads PDFs
- **AI reasoning** — Claude interprets the data, cross-validates between sources, flags discrepancies with actionable guidance, understands what a missing fire rating means
- **Structured reports** — QTO tables, element schedules, compliance checklists
- **Claude Code plugin** — skills that give Claude domain context for construction

This works. 17/17 tests passing. Claude already reasons about construction data — when it says "IFC has 0 fire-rated doors but spec requires 12 FRL-60" it understands the implication. The intelligence is there.

What V1 doesn't have is **construction methodology knowledge** (turning wall areas into material lists) and **trade-level outputs** (what a builder actually sends to suppliers). V2 deepens the brain, it doesn't add one.

---

## What V2 Adds

### 1. Construction Knowledge Layer

The core missing piece. V1 extracts "67m² of Wall Type 1 — 90mm stud, brick veneer." V2 knows what it takes to **build** that wall.

**Wall assemblies → material breakdowns:**

| Wall Component | Calculation Method |
|---|---|
| Studs | Wall length ÷ stud spacing + 1, × wall height. Add 10% waste |
| Top/bottom plates | Wall length × 2 (double top plate × 3) |
| Noggings | Rows × wall length ÷ stud spacing |
| Insulation | Net wall area (minus openings) |
| Plasterboard | Net wall area × number of layers × sides |
| Brick veneer | Net area × bricks per m² (50 for standard, 38 for large format) |
| Wall ties | Net area ÷ (horizontal spacing × vertical spacing) |
| DPC/flashing | Wall base perimeter |
| Wrap/sarking | Gross wall area + 8% for laps |

**Similar breakdowns needed for:**
- Concrete (volume × reo rate, formwork perimeter, pour joints)
- Roofing (area → sheets/tiles, battens at spacing, sarking, ridge/hip/valley LM, fascia/gutter)
- Doors (leaf + frame + hardware set + closer + seals + hinges per door type)
- Windows (frame + glazing + reveals + sill + flashing per window type)
- Flooring (area → boards/tiles + underlay + adhesive/nails + skirting LM)
- Stairs (concrete volume or stringer count + treads + risers + balustrade LM)

**Implementation approach:** A knowledge base of Australian construction methods — stud spacings, brick counts, reo rates, waste factors, fixing patterns. Not hardcoded formulas but a reference the agent uses to reason about materials. Could be:
- A structured JSON/YAML database of assembly types and their components
- Or just detailed system prompt knowledge that the agent applies contextually
- Or both — structured data for computation, prompt knowledge for reasoning

**Key principle still holds: the agent never does arithmetic.** The knowledge base feeds into computation tools that produce the numbers. The agent reasons about which assembly type applies, the tools compute the quantities.

### 2. Conversational Agent Interface

V1 uses structured skills (`/scan`, `/ifc-extract`). V2 is conversational — the builder just asks questions and the agent figures out which tools to use.

**This means:**
- A system prompt that understands construction terminology, Australian building practices, NCC requirements
- The agent has the CLI tools available but chooses when to call them based on the conversation
- No rigid workflow — the builder can jump from "how many doors" to "what's the slab thickness" to "check the energy report" naturally
- The agent remembers context within a session — "those north-facing windows we discussed" refers back

**For the prototype:** This could still be Claude Code with a very good CLAUDE.md / system prompt. For production: a custom agent harness (Claude Agent SDK or similar) with a web or mobile UI.

### 3. Energy Rating Report Parsing

A new data source. NatHERS assessments (AccuRate, FirstRate5, BERS Pro) produce reports with:
- Required R-values per wall/ceiling/floor type
- Required U-values per glazing orientation
- Required airtightness levels
- Star rating and compliance pathway

**New CLI tool or extension:**
- Parse energy rating PDFs (usually structured reports with tables)
- Extract R-value requirements per element
- Extract glazing performance requirements per orientation
- Map back to IFC elements for compliance checking

**Cross-validation expands to three-plus sources:**
- IFC model says wall has R2.0 batts
- PDF spec says Wall Type 1 requires R2.0
- Energy report says north walls need minimum R2.5
- Agent flags: "Wall Type 1 on north elevation doesn't meet energy rating requirement"

### 4. Trade-Level Output

V1 produces QTO tables (element type, count, area, volume). V2 produces **material schedules a builder can order from:**

```
WALL SCHEDULE — TAKEOFF
═══════════════════════
Project: Example Residential
Date: 2026-03-16

Wall Type 1: External — 90mm Stud + Brick Veneer
─────────────────────────────────────────────────
Location: Level 1 North, Level 1 East
Gross Area: 312 m²
Net Area (minus openings): 267 m²

FRAMING
  92x45 MGP10 studs @ 450 ctrs      1,240 LM
  92x45 top plate (double)              96 LM
  92x45 bottom plate                    48 LM
  Noggings @ 1350 ctrs                 186 LM

INSULATION & WRAP
  R2.0 glasswool batts 90mm           267 m²
  Wall wrap (vapour permeable)         289 m²  (8% laps)

LINING
  10mm std plasterboard               267 m²
  Paper tape + compound               267 m²

EXTERNAL
  Clay bricks (230x110x76)          13,350 ea  (@ 50/m²)
  Brick ties @ 600h x 600v           1,038 ea
  Mortar (1:1:6 mix)                   2.8 m³
  DPC to base                          48 LM

FLASHINGS
  Window head flashing                  34 LM
  Weep holes @ 1200 ctrs               40 ea
```

That's what a builder sends to their suppliers. The IFC gives the area. The spec gives the wall type. The agent's construction knowledge fills in the material breakdown.

### 5. Drawing Reading (Vision)

V1 deferred vision because AECV-Bench showed 9-12% accuracy on element counting. But vision is still valuable for:

- **Reading schedule tables that pdfplumber misses** — scanned drawings, CAD-drawn tables without text layers
- **Understanding spatial relationships** — "the stair core is on the north side" from a floor plan
- **Reading annotations and markups** — RFIs, revision clouds, hand-written notes
- **Reading elevation drawings** — window patterns, cladding types, roof profiles
- **Reading section drawings** — wall build-ups, floor-to-ceiling heights, structural depths

Don't use vision for counting. Use it for understanding context that text extraction can't capture.

### 6. DWG/CAD Support

Builders often receive DWG files alongside PDFs. If the DWG has layer information (DOORS layer, WALLS layer, WINDOWS layer), extraction is more reliable than PDF.

**Implementation:** `ezdxf` library + ODA File Converter (DWG → DXF → extract). Focus on:
- Layer-based element identification
- Block reference counting (door blocks, window blocks)
- Dimension extraction from annotation layers
- Schedule tables from title blocks

---

## Architecture — V2

```
┌─────────────────────────────────────────────┐
│              Conversational Agent            │
│     (understands construction methodology)  │
│                                             │
│  System prompt: AU building practices,      │
│  NCC requirements, trade terminology,       │
│  material assemblies, waste factors         │
└──────┬──────┬──────┬──────┬────────────────┘
       │      │      │      │
   ┌───▼──┐┌──▼──┐┌──▼──┐┌──▼──────────────┐
   │ IFC  ││ PDF ││Vision││ Energy Report   │
   │Extract││Extract││Agent ││ Parser        │
   └───┬──┘└──┬──┘└──┬──┘└──┬──────────────┘
       │      │      │      │
   ┌───▼──────▼──────▼──────▼──────────────┐
   │         Construction Knowledge         │
   │                                        │
   │  Assembly types → material breakdowns  │
   │  Stud spacings, brick rates, reo rates │
   │  Waste factors, fixing patterns        │
   │  NCC requirements, NatHERS mapping     │
   └───────────────┬───────────────────────┘
                   │
   ┌───────────────▼───────────────────────┐
   │         Trade-Level Outputs            │
   │                                        │
   │  Material schedules, procurement lists │
   │  Wall/door/window takeoff schedules    │
   │  Compliance checklists                 │
   │  Cost estimates (with rate database)   │
   └───────────────────────────────────────┘
```

## Delivery Model

**Prototype (V2a):** Still Claude Code or Agent SDK. Conversational system prompt with construction knowledge baked in. CLI tools as-is. Test with real project data.

**Product (V2b):** Custom agent harness with web UI. Drag-and-drop file upload. Chat interface. PDF report export. User accounts. Rate database integration.

**Integration (V2c):** API that plugs into existing tools (Buildxact, Procore). Webhook-based — upload triggers analysis, results push back to the platform.

---

## What Makes This Different

Every other tool in this space does one thing:
- Buildxact: manual estimating from PDFs
- CostX: BIM quantity extraction (enterprise)
- Togal/Provision: AI PDF takeoffs (no BIM)
- Solibri: BIM rule checking (no PDF cross-reference)

BuildBrain is the only tool that:
1. Reads **all three sources** (IFC + PDF + energy reports)
2. **Cross-validates** between them automatically
3. Understands **how buildings get built** (construction methodology, not just geometry)
4. Produces **trade-level outputs** (material lists, not just element counts)
5. Works **conversationally** (questions, not commands)

The moat is the combination. Any one of these is a feature. All five together is a product.

---

## Persistent Memory — The Builder's Second Brain

Inspired by OpenClaw's architecture (247K GitHub stars, plain Markdown memory + hybrid vector/BM25 search over SQLite). The idea: a construction-specific agent that gets smarter with every project because it remembers the builder's preferences, past projects, supplier relationships, and lessons learned.

### Why This Matters

A senior estimator's value isn't math — it's institutional knowledge. They know the architect always forgets fire ratings, that Boral's lead time blows out in November, that council in this LGA wants 2-hour fire walls. When they leave the company, that knowledge walks out the door.

An agent with persistent memory is institutional knowledge that doesn't quit.

### What the Agent Remembers

| Category | Examples | How It's Used |
|----------|----------|---------------|
| **Builder Preferences** | "Always use James Hardie Scyon, not render. Standard markup 15%. Reports in landscape PDF." | Auto-applies to every takeoff without asking |
| **Supplier Knowledge** | "Boral: next-day concrete. Holcim: 3 days. Bunnings Trade: MGP10 studs $4.20/LM as of Feb 2026." | Material lists include preferred suppliers and lead times |
| **Project History** | "Last duplex in Marrickville: 142 external walls, $87/m² installed. 15% more doors than schedule showed." | Informs estimates on similar projects, flags patterns |
| **Architect Patterns** | "ArchiCAD exports from Smith & Co always miss door fire ratings. Their IFC uses custom property sets." | Pre-empts known issues when processing files from that firm |
| **Local Requirements** | "Randwick council requires 2-hour fire walls to boundary. Mosman requires DA for any work visible from street." | Compliance checks tailored to the actual job location |
| **Pricing History** | "Concrete N32: $245/m³ in Jan, $258/m³ in March. Trending up ~5%/quarter." | Rate adjustments and cost forecasting |
| **Lessons Learned** | "Last 3 projects underestimated window flashings by 20%. Add 25% waste factor." | Self-correcting estimates based on actual outcomes |

### Memory Architecture (OpenClaw Pattern)

```
builder_workspace/
├── MEMORY.md                      # Curated long-term: preferences, suppliers, standards
├── memory/
│   ├── 2026-03-16.md              # Daily log: what was extracted, decisions made
│   ├── 2026-03-17.md
│   └── ...
├── projects/
│   ├── marrickville-duplex/       # Per-project extraction data + takeoff outputs
│   ├── randwick-townhouse/
│   └── ...
└── knowledge/
    ├── wall-assemblies.md         # Construction methodology reference
    ├── supplier-contacts.md       # Supplier database
    └── local-requirements.md      # Council-specific requirements
```

**Storage:** Plain Markdown files (transparent, editable, auditable) + SQLite with vector extensions for semantic search across all memory.

**Hybrid retrieval:** 70% vector similarity + 30% BM25 keyword search. Temporal decay on daily notes (half-life 30 days), no decay on MEMORY.md or knowledge files.

**Pre-compaction flush:** Before context is summarized, agent writes durable info to memory. Nothing gets lost between sessions.

### How It Gets Smarter Over Time

```
Project 1: "What stud spacing do you use?"
Builder:   "450 centres for external, 600 for internal"
Agent:     [saves to MEMORY.md]

Project 2: [automatically uses 450/600 without asking]

Project 5: "Last 3 projects, internal walls came in 8% over
            the takeoff. Should I adjust the waste factor?"
Builder:   "Yeah bump it to 12%"
Agent:     [updates MEMORY.md, applies to all future projects]

Project 10: "This architect's IFC exports always miss fire ratings.
             Based on their last 3 projects, expect ~15 fire doors
             even though the IFC shows 0. Flagging for manual check."
```

### Trust and Safety

- **Start as a second pair of eyes** — drafts takeoffs for builder to review, not autonomous ordering
- **Memory is auditable** — plain Markdown, builder can open and edit any file
- **Accuracy compounds but so do errors** — memory needs version control so bad data can be corrected and the correction propagates
- **Builder controls what's remembered** — "remember this" / "forget this" are explicit commands
- **Pricing data expires** — temporal decay ensures stale rates don't persist indefinitely

### Interface — Chat App + IFC Viewer

A purpose-built web/mobile app with two panels:

```
┌──────────────────────┬─────────────────────────┐
│                      │                         │
│    IFC 3D Viewer     │     Chat Interface      │
│                      │                         │
│  [click element]     │  Builder: "What's the   │
│  [highlight walls]   │   fire rating on this    │
│  [toggle levels]     │   door?"                │
│  [section cuts]      │                         │
│                      │  Agent: "D-14, Level 2  │
│                      │   stair core. No fire   │
│                      │   rating in IFC. PDF    │
│                      │   spec requires FRL-60" │
│                      │                         │
└──────────────────────┴─────────────────────────┘
```

- **IFC viewer** (xeokit or IFC.js) — 3D model, click elements to query, highlight results from agent queries, colour-code by property (fire rated = red, compliant = green)
- **Chat** — conversational interface, drag-and-drop file upload, inline tables and reports
- **Linked** — agent highlights elements in the viewer as it discusses them. Builder clicks a wall in the viewer and asks "takeoff this wall type"

The viewer gives spatial context that pure text can't. "The 3 doors without fire ratings are all in the Level 2 stair core" hits different when you can see them highlighted in red on the model.

---

## Open Questions for V2

1. **Construction knowledge representation** — structured database vs system prompt knowledge vs hybrid? How do you handle regional variations (AU vs NZ vs UK)?

2. **Accuracy requirements** — an estimator's takeoff has tolerance. How accurate does the agent need to be before a builder trusts it? Is "within 10%" good enough for a rough takeoff?

3. **Cost integration** — build a rate database or integrate with existing ones (Rawlinsons, Cordell)? User-defined rates vs published rates?

4. **Liability** — if the agent misses a fire-rated door and it causes a compliance issue, who's responsible? The tool needs clear disclaimers and human-in-the-loop checkpoints.

5. **IFC quality reality** — most IFC exports are incomplete. How useful is the agent when 50% of property sets are empty? Does it degrade gracefully or become useless?

6. **Market entry** — sell direct to builders, or partner with existing platforms (Buildxact, HiPages, Procore)?

7. **Custom agent harness** — Claude Agent SDK, or build from scratch on the Claude API? What's the right level of control vs speed of development?
