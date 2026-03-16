# BuildBrain

BIM Intelligence Agent — Claude Code plugin for IFC and PDF construction data extraction and cross-validation.

## What This Is

A Claude Code plugin that gives Claude the ability to query IFC building models and PDF construction documents, cross-validate data between them, and generate construction deliverables.

Install the plugin, drop IFC + PDF files in `data/`, run `/scan`.

## Architecture

**Claude Code is the orchestrator.** The plugin provides skills (workflow instructions) and CLI tools (data extraction).

```
Skills (workflow)              CLI Tools (bundled in /cli-tools)
/scan                →         ifc_extract.py summary + pdf_extract.py schedules
/ifc-extract         →         ifc_extract.py (IfcOpenShell)
/pdf-extract         →         pdf_extract.py (pdfplumber)
/cross-validate      →         Claude reasons over saved extraction data
/report              →         ifc_extract.py quantities + Claude formatting
/cli-tools           →         Full CLI reference manual (user-invoked only)
```

## Key Principle

**LLMs never do arithmetic.** IfcOpenShell computes all quantities. Claude only formats, reasons, and cross-validates.

## Plugin Structure

```
buildbrain/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest
├── skills/
│   ├── cli-tools/               # CLI reference + bundled scripts
│   │   ├── SKILL.md             # /cli-tools — full command reference
│   │   └── scripts/
│   │       ├── ifc_extract.py   # IFC CLI tool (IfcOpenShell)
│   │       └── pdf_extract.py   # PDF CLI tool (pdfplumber)
│   ├── scan/SKILL.md            # /scan — project onboarding
│   ├── ifc-extract/SKILL.md     # /ifc-extract — IFC queries
│   ├── pdf-extract/SKILL.md     # /pdf-extract — PDF extraction
│   ├── cross-validate/SKILL.md  # /cross-validate — IFC vs PDF comparison
│   └── report/SKILL.md          # /report — structured deliverables
├── specs/spec.md                # PRD
├── data/                        # Input files (gitignored)
├── output/                      # Generated reports (gitignored)
├── requirements.txt             # Python deps: ifcopenshell, pdfplumber, pandas
└── .archive/                    # Previous specs
```

## Typical Workflow

```
/scan                        → discover what's in the model and PDFs
/ifc-extract door            → extract all doors with properties
/pdf-extract                 → find and extract door schedule from PDF
/cross-validate door         → compare IFC doors vs PDF door schedule
/report qto doors            → generate QTO table for doors
```

## Prerequisites

```bash
pip install ifcopenshell pdfplumber pandas
```

## Tech Stack

- **IFC:** IfcOpenShell 0.8.x (Python, LGPL)
- **PDF:** pdfplumber (MIT)
- **Data:** pandas + CSV
- **Orchestration:** Claude Code plugin (skills + CLI tools)

## References

Full spec: `specs/spec.md`
CLI reference: `/cli-tools`
