# BuildBrain

AI agent that reads architecture drawings. Extracts structured data from IFC models and PDF construction documents, cross-validates between sources, and flags discrepancies.

**Core loop:** Drop IFC + PDF files -> agent scans both sources -> extracts elements, properties, schedules -> cross-validates -> generates QTO tables and discrepancy reports

**Mental model:** Claude Code is the brain, CLI tools are the hands. The agent queries IFC models via IfcOpenShell and PDFs via pdfplumber, reasons about what it finds, and produces construction deliverables. Packaged as a Claude Code plugin with 6 skills.

## Architecture

```
Claude Code (orchestrator — reasons about construction data)
    │
    ├── /scan              First run — inventory model + find PDF schedules
    ├── /ifc-extract       Query IFC elements, properties, quantities
    ├── /pdf-extract       Extract text, tables, schedules from PDFs
    ├── /cross-validate    Compare IFC vs PDF, flag discrepancies
    ├── /report            Generate QTO tables, schedules, compliance checks
    └── /cli-tools         Reference manual for the CLI tools below
            │
            ├── ifc_extract.py    IfcOpenShell wrapper — 7 subcommands
            └── pdf_extract.py    pdfplumber wrapper — 4 subcommands
```

## What It Does

| Capability | How |
|-----------|-----|
| **IFC model queries** | Extract doors, walls, windows, slabs, roofs, columns, beams, stairs — any element type. Properties, quantities, materials, grouped by storey |
| **PDF schedule extraction** | Auto-detect door/window/finish schedules from column headers. Search, extract tables, text |
| **Cross-validation** | Compare element counts, fire ratings, materials between IFC and PDF. Distinguish MISMATCH (conflicting data) from ABSENT (missing IFC data) |
| **Quantity takeoffs** | Pre-computed aggregates — counts, areas, volumes. Hybrid approach: reads IFC quantity sets, falls back to geometry computation |
| **Data quality** | Flags missing property sets, misclassified elements (IfcBuildingElementProxy), orphaned elements. Reports completeness metrics |
| **Structured reports** | QTO tables, element schedules, material takeoffs, compliance checklists. Australian conventions, NCC terminology |

## Tech Stack

**IFC:** IfcOpenShell 0.8.x (parse, extract, compute quantities from geometry)

**PDF:** pdfplumber (text, tables, schedule auto-detection)

**Orchestration:** Claude Code plugin (skills + CLI tools)

**Data:** pandas, CSV, JSON, Markdown

## Prerequisites

```bash
pip install ifcopenshell pdfplumber pandas
```

## Usage

Install as a Claude Code plugin, place IFC and PDF files in `data/`, then:

```
/scan                        Inventory the model and find PDF schedules
/ifc-extract door            Extract all doors with properties
/pdf-extract                 Find and extract door schedule from PDF
/cross-validate door         Compare IFC doors vs PDF door schedule
/report qto doors            Generate quantity takeoff table
```

Or just ask naturally — "how many fire-rated doors are there?", "what's the total wall area on Level 2?", "does the model match the spec?"

## CLI Tools

The plugin bundles two standalone Python CLI tools at `skills/cli-tools/scripts/`.

**ifc_extract.py** — 7 subcommands:

```bash
python ifc_extract.py <file.ifc> summary              # scan model, all element types + counts
python ifc_extract.py <file.ifc> list door             # list elements with properties
python ifc_extract.py <file.ifc> props <guid>          # detailed properties for one element
python ifc_extract.py <file.ifc> query door \
  --property Pset_DoorCommon.FireRating --not-null      # filter by property
python ifc_extract.py <file.ifc> quantities wall \
  --group-by storey                                     # pre-computed aggregates
python ifc_extract.py <file.ifc> validate              # data quality check
python ifc_extract.py <file.ifc> export door \
  --output doors.csv                                    # CSV export
```

**pdf_extract.py** — 4 subcommands:

```bash
python pdf_extract.py <file.pdf> schedules             # auto-detect schedule tables
python pdf_extract.py <file.pdf> search "fire rating"  # find pages by keyword
python pdf_extract.py <file.pdf> tables --pages 12-15  # extract tables from pages
python pdf_extract.py <file.pdf> text --pages 1-5      # extract raw text
```

All commands output structured JSON. Use `--save` to persist results to `output/`.

## Project Structure

```
buildbrain/
├── .claude-plugin/plugin.json         # Plugin manifest
├── skills/
│   ├── cli-tools/                     # CLI reference + bundled scripts
│   │   ├── SKILL.md
│   │   └── scripts/
│   │       ├── ifc_extract.py
│   │       └── pdf_extract.py
│   ├── scan/SKILL.md
│   ├── ifc-extract/SKILL.md
│   ├── pdf-extract/SKILL.md
│   ├── cross-validate/SKILL.md
│   └── report/SKILL.md
├── specs/                             # PRD + vision docs
├── data/                              # IFC + PDF input files
└── output/                            # Generated reports
```

## Key Design Decision

**LLMs never do arithmetic.** IfcOpenShell computes all quantities (counts, areas, volumes). The agent formats, reasons, and cross-validates — but never sums, multiplies, or calculates. The `quantities` command exists specifically for this.

## Context

This is a V1 prototype — proof of concept for the extraction and cross-validation layer. V2 vision includes conversational agent interface, trade-level takeoff outputs, construction methodology knowledge, persistent memory per builder, and a chat app with embedded IFC viewer. See `specs/v2-vision.md`.

Related: [BuildSpec](https://github.com/thebrownproject/buildspec) — NCC compliance assistant for Revit.
