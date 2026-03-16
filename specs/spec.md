# PRD: BuildBrain — Proof of Concept

**Version:** 0.3 (PoC Spec — reviewed)
**Date:** March 2026
**Status:** Proof of Concept
**Previous:** `.archive/spec-v0.1-perplexity.md` (original Perplexity-drafted spec)

---

## 1. Overview

### 1.1 What This Is

BuildBrain is a set of Claude Code skills and CLI tools that give Claude Code the ability to query IFC building models and PDF construction documents — then cross-validate the data between them.

The user opens Claude Code in a project containing IFC and PDF files. Claude Code has tools to extract structured data from both sources and can reason about discrepancies between them.

### 1.2 Key Insight

Claude Code is already an AI agent with tool use, file access, and multi-step reasoning. We don't need to build an orchestrator — we just need to give it the right tools. Claude Code skills wrap those tools with domain-specific instructions.

### 1.3 Core Principle

**LLMs never do arithmetic.** IfcOpenShell computes all quantities (counts, areas, volumes). Claude only formats, reasons, and cross-validates. This is non-negotiable.

---

## 2. Architecture

### 2.1 How It Works

```
User runs Claude Code in project directory
    │
    ├── /scan
    │       └── Runs summary + schedules, presents inventory, saves scan_summary.json
    │
    ├── /ifc-extract door
    │       └── python src/cli/ifc_extract.py <file.ifc> list door --save
    │               └── Returns structured JSON → saved to output/ifc_door_<timestamp>.json
    │
    ├── /pdf-extract
    │       └── python src/cli/pdf_extract.py <file.pdf> schedules --save
    │               └── Returns extracted tables → saved to output/pdf_schedules_<timestamp>.json
    │
    ├── /cross-validate door
    │       └── Reads output/ifc_door_*.json + output/pdf_schedules_*.json (latest of each)
    │               └── Claude reasons about discrepancies → output/discrepancy_<timestamp>.md
    │
    └── /report qto doors
            └── Reads output/ifc_door_*.json, calls quantities command
                    └── Formatted deliverable → output/qto_doors_<timestamp>.csv
```

### 2.2 Components

| Component | What It Is | Location |
|-----------|-----------|----------|
| `ifc_extract.py` | CLI tool — queries IFC files via IfcOpenShell | `src/cli/` |
| `pdf_extract.py` | CLI tool — extracts text and tables from PDFs via pdfplumber | `src/cli/` |
| `/scan` | Claude Code skill — project onboarding, scans IFC + PDF and presents inventory | `.claude/skills/scan/` |
| `/ifc-extract` | Claude Code skill — instructs Claude how to use the IFC CLI tool | `.claude/skills/ifc-extract/` |
| `/pdf-extract` | Claude Code skill — instructs Claude how to use the PDF CLI tool | `.claude/skills/pdf-extract/` |
| `/cross-validate` | Claude Code skill — instructs Claude to cross-validate IFC vs PDF data | `.claude/skills/cross-validate/` |
| `/report` | Claude Code skill — generate structured deliverables from extracted data | `.claude/skills/report/` |

### 2.3 Why This Architecture

- **No custom orchestrator needed.** Claude Code already orchestrates multi-step tool use.
- **CLI tools are testable independently.** Run `python ifc_extract.py` outside Claude Code to verify output.
- **Skills are just instructions.** They tell Claude what to do with the tool output — no code, just prompts.
- **Extensible.** Adding a new element type or data source = new CLI flag + skill update. No framework changes.
- **Claude can adapt dynamically.** If it needs to query something unexpected, it can call the CLI tools with different arguments — it's not locked into a pre-coded pipeline.

---

## 3. PoC Scope

### 3.1 In Scope

| Area | Details |
|------|---------|
| **IFC elements** | All major building elements — the CLI tool is type-agnostic and can query any IFC entity |
| **IFC extraction** | Element count, names/marks, type, level/storey, all property sets, materials, quantities |
| **PDF extraction** | Text extraction, table extraction (schedules for any element type) |
| **Cross-validation** | Count comparison (IFC vs PDF schedule), property comparison (fire ratings, materials, dimensions) |
| **Output** | Markdown discrepancy report, CSV/JSON element data |
| **Input assumption** | IFC file + PDF drawings provided by architect (no file generation) |

### 3.2 Out of Scope

- MEP elements (pipes, ducts, cables) — future expansion
- DWG file support — proprietary binary format, no clean Python reader. Data is equivalent to vector PDFs but without semantic structure. Use `ezdxf` + ODA File Converter pipeline if needed later
- Vision agent / floor plan image analysis (unreliable per AECV-Bench research — 9-12% accuracy on element counting)
- Scanned or hand-drawn PDFs
- Web UI or deployed API
- NCC compliance checking (future expansion)
- Energy ratings / NatHERS (future expansion)
- Federated multi-model IFC
- PDF-to-IFC generation (AmpliFy etc.)

### 3.3 Supported Element Types

The CLI tool accepts any IFC entity type. These are the primary building elements and their cross-validation value:

| Element | IFC Type | Key Pset | Key Properties | Cross-Validation Value |
|---------|----------|----------|---------------|----------------------|
| **Doors** | `IfcDoor` | `Pset_DoorCommon` | FireRating, IsExternal, SecurityRating | Door schedule in PDFs, fire rating compliance |
| **Windows** | `IfcWindow` | `Pset_WindowCommon` | ThermalTransmittance, AcousticRating, IsExternal | Window schedule in PDFs, energy compliance |
| **Walls** | `IfcWall` | `Pset_WallCommon` | IsExternal, FireRating, ThermalTransmittance, LoadBearing | Structural/compliance flags, material specs |
| **Slabs/Floors** | `IfcSlab` | `Pset_SlabCommon` | LoadBearing, IsExternal, AcousticRating | Floor areas, structural notes |
| **Roofs** | `IfcRoof` | `Pset_RoofCommon` | IsExternal, FireRating, ThermalTransmittance | Roof specs, insulation requirements |
| **Columns** | `IfcColumn` | `Pset_ColumnCommon` | LoadBearing, FireRating | Structural schedule |
| **Beams** | `IfcBeam` | `Pset_BeamCommon` | LoadBearing, FireRating, Span | Structural schedule |
| **Stairs** | `IfcStair` | `Pset_StairCommon` | FireRating, NumberOfRiser, RiserHeight, TreadLength | BCA compliance, accessibility. Note: quantities are on child `IfcStairFlight` via `Qto_StairFlightBaseQuantities` |
| **Railings** | `IfcRailing` | `Pset_RailingCommon` | Height, IsExternal | BCA balustrade compliance |
| **Spaces/Rooms** | `IfcSpace` | `Pset_SpaceCommon` | GrossPlannedArea, NetPlannedArea, PubliclyAccessible, IsExternal | Room schedule, area calculations. Note: actual area/volume values come from `Qto_SpaceBaseQuantities`, not the Pset |
| **Coverings** | `IfcCovering` | `Pset_CoveringCommon` | FireRating | Finish schedules |

The tool also supports a `summary` command that scans the entire model and reports all element types found with counts — so Claude can discover what's in the model without being told upfront.

---

## 4. CLI Tools

### 4.1 `ifc_extract.py`

Wraps IfcOpenShell. Accepts an IFC file and returns structured JSON.

**Commands:**

```bash
# List all elements of a type (accepts any IFC type name or shorthand)
python src/cli/ifc_extract.py <file.ifc> list <element_type>
# Examples: door, window, wall, slab, roof, column, beam, stair, railing, space
# Also accepts full IFC names: IfcDoor, IfcWall, IfcSlab, etc.

# Get detailed properties for a specific element by GUID
python src/cli/ifc_extract.py <file.ifc> props <guid>

# Summary — scans entire model, reports all element types found with counts
python src/cli/ifc_extract.py <file.ifc> summary

# Export element data to CSV
python src/cli/ifc_extract.py <file.ifc> export <element_type> --output <file.csv>

# Query — filter elements by property value
python src/cli/ifc_extract.py <file.ifc> query <element_type> --property <pset.property> --value <value>
# Example: find all external walls
python src/cli/ifc_extract.py <file.ifc> query wall --property Pset_WallCommon.IsExternal --value true
# Example: find all fire-rated doors
python src/cli/ifc_extract.py <file.ifc> query door --property Pset_DoorCommon.FireRating --not-null

# Quantities — pre-computed aggregates (counts, areas, volumes) grouped by storey/type
# This exists because LLMs must never do arithmetic
python src/cli/ifc_extract.py <file.ifc> quantities <element_type>
python src/cli/ifc_extract.py <file.ifc> quantities wall --group-by storey
python src/cli/ifc_extract.py <file.ifc> quantities slab --group-by type

# Validate — check IFC data quality (missing psets, unclassified elements, orphans)
python src/cli/ifc_extract.py <file.ifc> validate

# Output control flags (apply to list, query, export)
# --limit N          Max elements to return
# --offset N         Skip first N elements
# --fields f1,f2     Only include specific fields (e.g., --fields name,storey,FireRating)
# --compact          Return only guid, name, type, storey (no properties)
# --save             Write output to output/<type>_<timestamp>.json
```

**Output format (JSON):**

```json
{
  "element_type": "IfcDoor",
  "count": 47,
  "elements": [
    {
      "guid": "2O2Fr$t4X7Zf8NOew3FNr2",
      "name": "D01",
      "type_name": "Single Swing 900x2100",
      "storey": "Level 1",
      "properties": {
        "Pset_DoorCommon": {
          "FireRating": null,
          "IsExternal": false,
          "SecurityRating": null
        }
      },
      "quantities": {
        "Qto_DoorBaseQuantities": {
          "Area": 1.89
        }
      },
      "material": "Solid Core Timber"
    }
  ]
}
```

**Type shorthand mapping:**

| Shorthand | IFC Type |
|-----------|----------|
| `door` | `IfcDoor` |
| `window` | `IfcWindow` |
| `wall` | `IfcWall` |
| `slab`, `floor` | `IfcSlab` |
| `roof` | `IfcRoof` |
| `column` | `IfcColumn` |
| `beam` | `IfcBeam` |
| `stair` | `IfcStair` |
| `railing` | `IfcRailing` |
| `space`, `room` | `IfcSpace` |
| `covering` | `IfcCovering` |

Any unrecognised type is passed through as-is (e.g., `IfcFurniture`, `IfcBuildingElementProxy`).

**`summary` output format:**

```json
{
  "file": "project.ifc",
  "file_size_mb": 87.3,
  "schema": "IFC4",
  "project_name": "Example Residential",
  "element_counts": {
    "IfcWall": 142,
    "IfcDoor": 47,
    "IfcWindow": 34,
    "IfcSlab": 8,
    "IfcRoof": 2,
    "IfcColumn": 24,
    "IfcStair": 3,
    "IfcSpace": 31,
    "IfcBuildingElementProxy": 3
  },
  "storeys": ["Ground Floor", "Level 1", "Level 2", "Roof"],
  "parse_time_seconds": 4.2
}
```

**`quantities` output format:**

The quantities command uses a **hybrid approach**: reads Qto_ sets first (instant, authoritative), falls back to geometry computation via `ifcopenshell.util.shape` for elements missing Qto_ data (~2% variance, slower). The `_source` field tracks provenance.

```json
{
  "element_type": "IfcWall",
  "totals": {
    "count": 142,
    "total_net_side_area_m2": 847.3,
    "total_net_volume_m3": 169.5,
    "_source": { "area": "qto (130), computed (12)", "volume": "qto (130), computed (12)" }
  },
  "by_storey": {
    "Ground Floor": { "count": 52, "total_net_side_area_m2": 312.1 },
    "Level 1": { "count": 48, "total_net_side_area_m2": 298.6 },
    "Level 2": { "count": 42, "total_net_side_area_m2": 236.6 }
  },
  "by_type": {
    "External": { "count": 38, "total_net_side_area_m2": 421.5 },
    "Internal": { "count": 104, "total_net_side_area_m2": 425.8 }
  },
  "qto_coverage": "130 of 142 elements have Qto_WallBaseQuantities",
  "geometry_fallback_count": 12,
  "compute_time_seconds": 8.3
}
```

**Quantity property preferences per element type:**

| Element | Primary Area | Primary Volume | Source Qto Set |
|---------|-------------|---------------|----------------|
| Walls | NetSideArea | NetVolume | Qto_WallBaseQuantities |
| Slabs | NetArea | NetVolume | Qto_SlabBaseQuantities |
| Doors | Area | — | Qto_DoorBaseQuantities |
| Windows | Area | — | Qto_WindowBaseQuantities |
| Roofs | NetArea | — | Qto_RoofBaseQuantities |
| Columns | CrossSectionArea | NetVolume | Qto_ColumnBaseQuantities |
| Beams | CrossSectionArea | NetVolume | Qto_BeamBaseQuantities |

**Geometry fallback functions** (`ifcopenshell.util.shape`, native in 0.8.x — no external deps):

| Function | Use For |
|----------|---------|
| `get_side_area(geometry)` | Wall elevational area |
| `get_footprint_area(geometry)` | Slab/roof plan area |
| `get_volume(geometry)` | Any element volume (requires manifold geometry) |
| `get_area(geometry)` | Total surface area |
| `get_x/y/z(geometry)` | Bounding box dimensions |

**`validate` output format:**

```json
{
  "file": "project.ifc",
  "issues": [
    {
      "severity": "warn",
      "type": "missing_pset",
      "message": "Pset_DoorCommon not found on 23 of 47 IfcDoor elements",
      "affected_count": 23,
      "element_type": "IfcDoor"
    },
    {
      "severity": "warn",
      "type": "proxy_elements",
      "message": "3 IfcBuildingElementProxy elements found — may be misclassified",
      "affected_count": 3,
      "elements": [{"guid": "...", "name": "Generic Wall 1"}]
    },
    {
      "severity": "info",
      "type": "no_storey",
      "message": "2 elements have no storey assignment",
      "affected_count": 2
    }
  ],
  "completeness": {
    "IfcDoor": { "total": 47, "with_pset": 24, "with_qto": 35, "pset_coverage": "51%" },
    "IfcWall": { "total": 142, "with_pset": 130, "with_qto": 142, "pset_coverage": "92%" }
  }
}
```

### 4.2 `pdf_extract.py`

Wraps pdfplumber. Accepts a PDF file and returns structured JSON.

**Commands:**

```bash
# Extract all text from PDF
python src/cli/pdf_extract.py <file.pdf> text

# Extract all text from specific pages
python src/cli/pdf_extract.py <file.pdf> text --pages 1-5

# Extract tables from PDF
python src/cli/pdf_extract.py <file.pdf> tables

# Extract tables from specific pages
python src/cli/pdf_extract.py <file.pdf> tables --pages 12-15

# Search — find pages containing a keyword (avoids extracting all 50+ pages)
python src/cli/pdf_extract.py <file.pdf> search "door schedule"
python src/cli/pdf_extract.py <file.pdf> search "fire rating"

# Schedules — auto-detect schedule tables by looking for known column headers
# (door schedule, window schedule, finish schedule, etc.)
python src/cli/pdf_extract.py <file.pdf> schedules

# Output control
# --save             Write output to output/pdf_<command>_<timestamp>.json
```

**`search` output format:**

```json
{
  "file": "drawings.pdf",
  "query": "door schedule",
  "matches": [
    { "page": 12, "snippet": "DOOR SCHEDULE — Level 1", "context": "...table header row..." },
    { "page": 13, "snippet": "DOOR SCHEDULE — Level 2", "context": "...table header row..." }
  ]
}
```

**`schedules` output format:**

```json
{
  "file": "drawings.pdf",
  "schedules_found": [
    {
      "type": "door_schedule",
      "page": 12,
      "headers": ["Mark", "Size", "Type", "Fire Rating", "Hardware"],
      "row_count": 24
    },
    {
      "type": "window_schedule",
      "page": 14,
      "headers": ["Mark", "Size", "Type", "Glazing", "U-Value"],
      "row_count": 18
    }
  ]
}
```

**`text` and `tables` output format:**

```json
{
  "file": "drawings.pdf",
  "total_pages": 42,
  "results": [
    {
      "page": 12,
      "text": "DOOR SCHEDULE...",
      "tables": [
        {
          "headers": ["Mark", "Size", "Type", "Fire Rating", "Hardware"],
          "rows": [
            ["D01", "900x2100", "Single Swing", "-", "Lever Set"],
            ["D02", "820x2040", "Single Swing", "FRL-60", "Closer + Lever"]
          ]
        }
      ]
    }
  ]
}
```

---

## 5. Claude Code Skills

### 5.1 `/scan` — Project Onboarding

**Purpose:** First thing a user runs. Scans the IFC model and PDF drawing set, presents a combined inventory.

**Behaviour:**
1. Accept file paths for IFC and PDF (or auto-detect files in `data/`)
2. Run `ifc_extract.py summary` on the IFC file
3. Run `pdf_extract.py schedules` on the PDF to find schedule pages
4. Present a combined inventory: "Your model has 47 doors, 34 windows, 142 walls... PDF has a door schedule on p.12, window schedule on p.14"
5. Run `ifc_extract.py validate` to flag data quality issues
6. Suggest next steps based on what's found

### 5.2 `/ifc-extract`

**Purpose:** Instruct Claude how to query the IFC file using the CLI tool.

**Behaviour:**
1. Accept a file path and optional element type as arguments
2. Run the CLI tool to extract data
3. Present results in a readable format
4. Save results to `output/` using `--save` for downstream use
5. Offer follow-up queries (filter by property, specific element details)
6. The skill instructions include the property-to-pset mapping so Claude can translate natural language ("show me fire-rated doors") to correct CLI invocations

### 5.3 `/pdf-extract`

**Purpose:** Instruct Claude how to extract data from PDFs using the CLI tool.

**Behaviour:**
1. Accept a file path and optional page range
2. If no pages specified, use `search` command first to find relevant pages
3. Run the CLI tool to extract text and tables
4. Identify schedule tables (door schedule, window schedule) in the extracted data
5. Save results to `output/` using `--save` for downstream use

### 5.4 `/cross-validate`

**Purpose:** Instruct Claude to compare IFC data against PDF data and generate a discrepancy report.

**Data flow:** Reads previously saved extraction results from `output/`. If no saved data exists, prompts the user to run `/ifc-extract` and `/pdf-extract` first. Cross-validates one element type at a time to avoid context overflow on large models.

**Behaviour:**
1. Read saved IFC and PDF extraction data from `output/`
2. For each element type with data in both sources:
   - Compare element counts
   - Match elements by name/mark (handling normalisation: "D01" vs "Door 01")
   - Compare properties (fire ratings, materials, dimensions)
3. Distinguish between:
   - **MISMATCH** — IFC says X, PDF says Y (conflicting data)
   - **ABSENT** — IFC has no data, PDF specifies a value (missing IFC property — likely an export settings issue)
   - **PASS** — data agrees across sources
4. Generate a Markdown discrepancy report with PASS/WARN/INFO flags
5. Save the report to `output/`

**Example output:**

```markdown
## Discrepancy Report — Project Name — 2026-03-16

### WARN: Door Count Mismatch
- IFC Model: 47 doors
- PDF Door Schedule (p.12): 49 doors
- Difference: 2 doors missing from model
- Action: Check Level 3 north wing

### WARN: Fire Ratings Absent in IFC
- IFC Model: 0 doors with FireRating property set
- PDF Spec: 12 doors specified as FRL-60
- Likely cause: Revit IFC export — "Export IFC common property sets" may not be enabled
- Action: Architect to re-export IFC with common property sets enabled, or manually update Pset_DoorCommon.FireRating

### WARN: Fire Rating Wall/Door Mismatch
- Wall W-14 (Level 2, Stair Core): FireRating = FRL-90/90/90
- Door D-23 (in Wall W-14): FireRating = null
- Action: Door in fire-rated wall must have matching or compatible fire rating

### INFO: IfcBuildingElementProxy Elements Found
- 3 elements classified as IfcBuildingElementProxy
- These may be misclassified doors, windows, or walls
- Action: Check Revit family categories for correct IFC mapping

### PASS: Window Count Consistent
- IFC Model: 34 windows
- PDF Window Schedule (p.14): 34 windows

### PASS: External Wall Material Consistent
- IFC Model: Brick Veneer
- PDF Spec (Section 3.1): Brick Veneer
```

### 5.5 `/report` — Structured Deliverables

**Purpose:** Generate formatted construction documents from extracted data.

**Deliverable types:**

| Type | Description | Format |
|------|-------------|--------|
| `qto` | Quantity takeoff by element type, grouped by storey | CSV + Markdown |
| `schedule <type>` | Element schedule (door schedule, window schedule, etc.) | CSV |
| `material-takeoff` | Materials grouped by element type with quantities | CSV |
| `compliance <area>` | Compliance checklist (fire, accessibility, thermal) | Markdown |
| `discrepancy` | Cross-validation results (alias for /cross-validate output) | Markdown |

**Key design rule:** CLI tools compute all aggregates via `quantities` command (no LLM arithmetic). Claude applies domain-specific formatting — Australian conventions, NCC terminology, standard schedule column ordering.

**Behaviour:**
1. Accept a deliverable type and optional element filter
2. Read saved extraction data from `output/`
3. Call `quantities` command for aggregated data if needed
4. Format output according to construction industry conventions
5. Save to `output/` with timestamped filename

**Example invocations:**
```
/report qto doors            → output/qto_doors_2026-03-16.csv
/report schedule doors       → output/door_schedule_2026-03-16.csv
/report compliance fire      → output/fire_compliance_2026-03-16.md
/report material-takeoff     → output/material_takeoff_2026-03-16.csv
```

---

## 6. Data Flow and Persistence

Skills save extraction results to `output/` so downstream skills can access them without re-running extraction or relying on context window memory.

```
/scan
  └── output/scan_summary.json           (model inventory + PDF schedule locations)

/ifc-extract
  └── output/ifc_<type>_<timestamp>.json  (element data per type)

/pdf-extract
  └── output/pdf_<command>_<timestamp>.json (text/tables per page range)

/cross-validate
  ├── reads from output/ifc_*.json and output/pdf_*.json
  └── output/discrepancy_<timestamp>.md   (the report)

/report
  ├── reads from output/ifc_*.json
  └── output/<deliverable>_<timestamp>.csv|md
```

This also makes runs reproducible — you can re-run `/cross-validate` after fixing the IFC file and compare reports.

**Timestamp disambiguation:** When multiple extractions exist for the same type, downstream consumers (cross-validate, report) use the **most recent** file matching the pattern. Skills can override this by specifying a file path directly.

**`--save` flag behaviour:** Writes output to `output/` relative to the project root (working directory). Creates the `output/` directory if it doesn't exist. Filename pattern: `<source>_<command>_<YYYY-MM-DD_HHMMSS>.json`.

**File discovery:** CLI tools always require an explicit file path — no auto-discovery magic. Claude handles file discovery by listing the `data/` directory, identifying the right files, and passing the full path to the CLI command. If multiple files exist, Claude asks the user which one to use. This keeps the CLI tools simple and predictable.

---

## 7. Error Handling

### 7.1 CLI Tool Error Format

All CLI tools return structured error JSON, never raw stack traces:

```json
{
  "error": true,
  "error_type": "missing_pset",
  "message": "Pset_DoorCommon not found on 12 of 47 IfcDoor elements",
  "partial_results": true,
  "elements": [...]
}
```

### 7.2 Common Scenarios

| Scenario | Behaviour |
|----------|-----------|
| **Missing property sets** | Return elements with `"properties": {}`. Flag in `validate` output. Most common issue — Revit/ArchiCAD exports frequently omit standard Psets |
| **Empty PDF tables** | Return `"tables": []`. Skill instructions tell Claude to fall back to text extraction and attempt to parse schedules from free text |
| **IfcBuildingElementProxy** | `summary` and `validate` commands prominently flag proxy elements with count. These are often misclassified real elements |
| **Element name mismatches** | Cross-validation handles normalisation (e.g., "D01" ↔ "Door 01", "W-03" ↔ "Window 03"). Unmatched elements flagged in report |
| **Large IFC files (>200MB)** | CLI tool reports file size and parse time. Use `--compact` and `--limit` flags to manage output size. IfcOpenShell loads full file into memory — documented limitation |
| **Malformed IFC files** | Catch IfcOpenShell parse exceptions, return structured error with file details |
| **Ghost/orphaned elements** | `validate` command flags elements with no storey assignment or no spatial containment |

---

## 8. Project Structure

```
buildbrain/
├── CLAUDE.md                          # Project instructions for Claude Code
├── .claude/
│   └── skills/
│       ├── scan/
│       │   └── SKILL.md               # /scan skill — project onboarding
│       ├── ifc-extract/
│       │   └── SKILL.md               # /ifc-extract skill
│       ├── pdf-extract/
│       │   └── SKILL.md               # /pdf-extract skill
│       ├── cross-validate/
│       │   └── SKILL.md               # /cross-validate skill
│       └── report/
│           └── SKILL.md               # /report skill — structured deliverables
├── specs/
│   └── spec.md                        # This file
├── src/
│   └── cli/
│       ├── ifc_extract.py             # IFC CLI tool (IfcOpenShell)
│       └── pdf_extract.py             # PDF CLI tool (pdfplumber)
├── data/                              # Input files (IFC, PDF) — gitignored
├── output/                            # Generated reports and cached extractions — gitignored
├── requirements.txt                   # Python dependencies
└── .archive/                          # Previous spec versions
```

---

## 9. Tech Stack

| Layer | Technology | Licence | Notes |
|-------|-----------|---------|-------|
| IFC parsing | IfcOpenShell 0.8.x | LGPL | `pip install ifcopenshell` |
| PDF extraction | pdfplumber | MIT | `pip install pdfplumber` |
| Data processing | pandas | BSD | For CSV export |
| Orchestration | Claude Code | Commercial | Skills + CLI tool use |
| Output | Markdown + CSV | — | No external dependencies |

**Dropped from original spec:**
- PyMuPDF — AGPL licence is problematic, pdfplumber covers our needs
- pdf2image + poppler — not needed without Vision Agent
- Vision model — deferred, unreliable for element counting per research

---

## 10. Input Assumptions

For the PoC, we assume the user has:

1. **An IFC file** — exported from the architect's BIM software (Revit, ArchiCAD, etc.)
2. **PDF drawing set** — floor plans, elevations, sections, schedules
3. **Optionally: PDF specifications** — material specs, NCC compliance notes

These files are placed in `data/` and referenced by path when running skills.

The IFC file is the **primary source of truth** for element data. The PDF is the **validation source** — we check whether the PDF agrees with the IFC, not the other way around.

---

## 11. Real-World IFC Quality

**Property sets are frequently empty in practice.** This is the single biggest real-world issue the tool will face.

- Revit's "Export IFC common property sets" checkbox is often missed by architects. Fire ratings, materials, acoustic properties exist in the Revit model but don't make it into the IFC export.
- ArchiCAD has known issues where doors and windows can go entirely missing from IFC exports (particularly IFC4 Reference View from ArchiCAD 26+).
- Some properties are version-dependent — e.g., `HasDrive` in `Pset_DoorCommon` doesn't export under IFC 2x3 Coordination View 2.0 but works under IFC4.
- Revit-native parameters stored under custom property set names (not standard `Pset_` names) may contain the data that's missing from standard Psets.

**Implications for the tool:**
- Treat `"FireRating": null` as the expected case, not an error
- The `validate` command should report completeness metrics: "23 of 47 doors have Pset_DoorCommon populated"
- Cross-validation should distinguish **ABSENT** (likely export issue) from **MISMATCH** (conflicting data)
- Reports should include actionable guidance: "Architect should re-export with 'Export IFC common property sets' enabled"
- Consider also scanning Revit-native property sets (non-standard names) as a fallback for missing standard Psets

**`IfcBuildingElementProxy` — misclassified elements.** When Revit families use the wrong category (e.g., "Generic Models"), elements export as `IfcBuildingElementProxy` instead of their proper type. The `summary` and `validate` commands must prominently flag these. A future enhancement could heuristically suggest what a proxy element might actually be based on its name/description.

**Ghost objects.** Models may contain hidden or deleted elements that still exist in the database. The `validate` command should flag elements with unusual states (no geometry, no spatial containment, duplicate GUIDs).

---

## 12. Future Expansion

Once the PoC validates the skill + CLI tool approach:

| Phase | Capability | Notes |
|-------|-----------|-------|
| 1b | Package as pip-installable CLI (`buildbrain ifc list door`, `buildbrain pdf schedules`) | `pyproject.toml` with entry points, same underlying code |
| 2a | MEP elements (pipes, ducts, cables) | Extend CLI tool to IfcFlowSegment, IfcDistributionElement etc. |
| 2b | NCC compliance checking | Validate IFC properties against NCC 2025 requirements |
| 2c | NatHERS energy rating pre-fill | Extract thermal properties for energy rating tool input |
| 2d | Structural analysis flags | LoadBearing, span tables, member sizing validation |
| 3a | Vision agent for schedule reading | Use Claude Vision on PDF schedule images where text extraction fails |
| 3b | MCP server wrapping CLI tools | Cleaner tool integration than bash calls |
| 3c | Graph-RAG on IFC relationships | Neo4j/NetworkX graph for natural language IFC queries |
| 4a | Web UI with xeokit viewer | Browser-based viewer + chat interface |
| 4b | Permit/approval workflow | Map IFC data to council submission requirements |

---

## 13. Implementation Notes

### 13.1 Python Structure

CLI tools are standalone scripts, not a package. No `__init__.py` needed for PoC. Use `argparse` for argument parsing (stdlib, no extra dependency).

```
src/cli/
├── ifc_extract.py    # standalone script, imports ifcopenshell + pandas
└── pdf_extract.py    # standalone script, imports pdfplumber
```

### 13.2 Dependencies (`requirements.txt`)

```
ifcopenshell>=0.8.0
pdfplumber>=0.10.0
pandas>=2.0.0
```

### 13.3 Sample Data

For development and testing, use:
- **IFC:** IfcOpenShell sample files from the [IfcOpenShell test data](https://github.com/IfcOpenShell/IfcOpenShell/tree/v0.8.0/test/input) or buildingSMART sample models
- **PDF:** Any real architectural drawing set with door/window schedules

Place test files in `data/`. This directory is gitignored.

### 13.4 Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success (including partial results with warnings) |
| 1 | Full failure (file not found, parse error, no results) |
| 2 | Invalid arguments |

### 13.5 Typical Workflow

```
/scan                        → discover what's in the model and PDFs
/ifc-extract door            → extract all doors with properties
/pdf-extract                 → find and extract door schedule from PDF
/cross-validate door         → compare IFC doors vs PDF door schedule
/report qto doors            → generate QTO table for doors
```

---

## 14. Success Criteria for PoC

The PoC is successful if:

1. **IFC extraction works** — `ifc_extract.py` correctly extracts all major building elements with their property sets from a real IFC file
2. **Model discovery works** — `summary` command correctly identifies all element types present in a model without prior knowledge of its contents
3. **PDF extraction works** — `pdf_extract.py` correctly extracts schedule tables from a real PDF drawing set
4. **Cross-validation produces a useful report** — the discrepancy report correctly identifies at least one real discrepancy (count mismatch or missing property) between the IFC and PDF
5. **The skill workflow is natural** — a user can run `/ifc-extract`, `/pdf-extract`, `/cross-validate` in Claude Code and get results without needing to understand the underlying tools
6. **Claude can adapt** — Claude can answer follow-up questions ("which doors are missing fire ratings?", "show me all load-bearing columns", "what's the total roof area?") by calling the CLI tools with different arguments

---

## 15. References

- **IfcOpenShell docs:** https://docs.ifcopenshell.org
- **pdfplumber docs:** https://github.com/jsvine/pdfplumber
- **AECV-Bench (vision model limitations):** arXiv 2601.04819
- **Claude Code skills:** https://code.claude.com/docs/en/skills.md
- **Research findings:** `.archive/research-findings.md`
- **Original spec (Perplexity):** `.archive/spec-v0.1-perplexity.md`
