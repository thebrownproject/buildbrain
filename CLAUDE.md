# BuildBrain

BIM Intelligence Agent — IFC + multi-modal construction QTO pipeline.

## What This Is

An AI-orchestrated system that automates construction quantity takeoffs (QTO) and cross-validates data across three sources:
- **IFC/BIM models** (3D building data)
- **PDF drawings** (floor plans, elevations, sections)
- **Specification documents** (schedules, NCC compliance notes)

Target users: Australian SMB builders and estimators on residential and light commercial projects.

## Architecture

Three extraction agents coordinated by an orchestrator:

| Agent | Role | Technology |
|-------|------|------------|
| IFC Agent | Parse BIM model, extract element data + property sets | IfcOpenShell (Python) |
| PDF Agent | Extract text, tables, schedules from PDF docs | pdfplumber / PyMuPDF |
| Vision Agent | Read architectural drawings as images | Claude Vision / multimodal LLM |
| Orchestrator | Coordinate agents, cross-validate, generate reports | Claude Code |

## Key Principle

**LLMs never do arithmetic.** IfcOpenShell computes all quantities. The LLM only formats, reasons, and cross-validates.

## IFC Parsing

IFC files are STEP-encoded and can be 10-500MB+. Never feed raw IFC to an LLM. The pipeline is:
```
parse → extract → flatten → query
```
Geometry (80-90% of file size) is discarded. A 116MB IFC compresses to ~50-300KB of structured CSV.

### Key Element Types and Property Sets

| Element | Key Psets |
|---------|-----------|
| Walls | `Pset_WallCommon`: IsExternal, FireRating, ThermalTransmittance, LoadBearing |
| Slabs | `Pset_SlabCommon`: LoadBearing, IsExternal, AcousticRating |
| Doors | `Pset_DoorCommon`: FireRating, IsExternal, SecurityRating |
| Windows | `Pset_WindowCommon`: ThermalTransmittance, AcousticRating |

## Outputs

1. **QTO Table** (CSV + Markdown) — element counts, areas, volumes, materials, levels
2. **Discrepancy Report** (Markdown) — cross-validation results with PASS/WARN flags

## Prototype Scope (Phase 1)

**In scope:** Walls, slabs, doors, windows | Single IFC file | PDF text extraction | Basic vision on floor plans | CSV + Markdown output | Claude Code orchestrator

**Out of scope:** MEP elements | Federated multi-model IFC | Scanned/hand-drawn PDFs | Web UI | Deployed API

**Start with `IfcDoor`** — clear schedule equivalent in PDFs, finite count, high-value fire rating discrepancy detection.

## Tech Stack

- **IFC:** IfcOpenShell (Python, LGPL)
- **PDF:** pdfplumber (MIT) / PyMuPDF (AGPL)
- **PDF to image:** pdf2image + poppler
- **Vision:** Claude Vision / multimodal LLM
- **Orchestration:** Claude Code
- **Data:** pandas + CSV

## Project Structure

```
buildbrain/
├── CLAUDE.md          # This file
├── specs/             # Product specs and requirements
│   └── spec.md        # PRD
├── src/               # Source code
│   ├── agents/        # IFC, PDF, Vision agents
│   └── orchestrator/  # Cross-validation and coordination
├── data/              # Input files (IFC, PDF)
└── output/            # Generated QTO tables and reports
```

## References

Full spec with sources: `specs/spec.md`
