<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# Okay complete a spec/prd for this outlining everything including your sources as well and architecture for this

Here is the full PRD for the prototype:

***

# PRD: BIM Intelligence Agent — IFC + Multi-Modal Construction QTO Pipeline

**Version:** 0.1 (Prototype Spec)
**Author:** Draft for BuildPass exploration
**Date:** March 2026
**Status:** Pre-prototype / Research Spike

***

## 1. Overview

### 1.1 Problem Statement

Construction quantity takeoffs (QTO) and document cross-validation are currently manual, time-intensive processes. A builder or estimator working on a mid-size residential or commercial project must reconcile data across three separate sources:

- **3D BIM/IFC models** (from architect or engineer)
- **PDF construction drawings** (floor plans, elevations, sections)
- **Specification documents and schedules** (door schedules, finish schedules, NCC compliance notes)

Discrepancies between these sources are common and catching them requires domain expertise and significant time. No SMB-focused Australian construction platform currently automates this reconciliation.[^1]

### 1.2 Opportunity

Recent advances in three converging technologies make this buildable now:

1. **IfcOpenShell** — open-source Python library for programmatic IFC parsing[^2]
2. **LLM agent frameworks (Claude Code)** — capable of writing and executing multi-step extraction pipelines in a single session[^3]
3. **Multimodal vision models** — capable of reading architectural drawings as images and extracting structured data[^4]

A Claude Code-orchestrated agent harness combining all three can produce automated QTO outputs and discrepancy reports that currently take estimators hours to produce manually.

### 1.3 Goal

Build a working prototype that:

- Accepts an IFC file + PDF drawing set as inputs
- Extracts structured quantity data from the IFC model
- Reads and parses PDF specifications and schedules
- Uses vision models on floor plan images
- Cross-validates all three sources
- Outputs a QTO table and a discrepancy report

***

## 2. Target Users

| User | Pain Point | What They Gain |
| :-- | :-- | :-- |
| Builder (SMB) | Can't read IFC files, relies on manual takeoff | Instant quantities from model without BIM software |
| Estimator | Hours spent cross-checking drawings vs specs | Automated cross-validation with flagged conflicts |
| Sub-consultant | Needs to verify scope from architect's model | Self-service quantity extraction per trade |
| BIM Coordinator (future) | Manual clash/data QA | Automated data consistency checking |

Primary target for this prototype: **Australian SMB builders and estimators** working on residential and light commercial projects.[^5]

***

## 3. Core Concepts

### 3.1 What IFC Actually Is

IFC (Industry Foundation Classes) is an open, ISO-standardised (ISO 16739-1:2024) data format maintained by buildingSMART.  It is effectively a **graph database for 3D building models**, encoding:[^6]

- **Entities** — typed building objects (`IfcWall`, `IfcSlab`, `IfcDoor`, `IfcSpace`, etc.)
- **Geometry** — encoded as SweptSolid, B-Rep, or CSG representations[^7]
- **Property Sets (Psets)** — structured metadata: fire ratings, materials, acoustic ratings, thermal values[^8]
- **Relationships** — formal links between entities: spatial containment, material associations, openings voiding walls[^9]

A raw IFC file is a plain-text STEP-encoded file. A real-world file can be 2–500MB+. A 116MB IFC file may contain 2M+ lines of entity definitions. This is far beyond any LLM context window.[^10]

### 3.2 Why You Can't Feed IFC Directly to an LLM

| Model | Context Window | Max File Size Feasible |
| :-- | :-- | :-- |
| GPT-4o | ~128K tokens | ~500KB |
| Claude 3.5 Sonnet | ~200K tokens | ~800KB |
| **Typical IFC file** | N/A | **10MB–500MB** |

The solution is to **never feed raw IFC to an LLM**. Instead: parse → extract → flatten → query. The geometry (80–90% of file size) is irrelevant to QTO and is discarded.[^11]

***

## 4. System Architecture

### 4.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Orchestrator Agent                        │
│                    (Claude Code / LLM)                       │
│   - Coordinates agents                                       │
│   - Manages tool calls                                       │
│   - Cross-validates outputs                                  │
│   - Generates final QTO + discrepancy report                 │
└───────────┬───────────┬───────────┬──────────────────────────┘
            ↓           ↓           ↓
     ┌──────────┐ ┌──────────┐ ┌──────────────┐
     │ IFC      │ │ PDF/OCR  │ │ Vision       │
     │ Agent    │ │ Agent    │ │ Agent        │
     │          │ │          │ │              │
     │IfcOpen-  │ │PyMuPDF / │ │Claude Vision │
     │Shell     │ │pdfplumber│ │/ GPT-4o      │
     │Python    │ │LLM text  │ │on images     │
     │scripts   │ │extraction│ │              │
     └────┬─────┘ └────┬─────┘ └──────┬───────┘
          ↓            ↓              ↓
     Structured    Spec text +    Floor plan +
     CSV/JSON      schedule JSON  schedule data
          ↓            ↓              ↓
     └────────────────────────────────────────┘
                         ↓
              Cross-validation engine
                         ↓
           ┌─────────────────────────┐
           │  Output: QTO Table      │
           │  Output: Discrepancy    │
           │  Report (Markdown/CSV)  │
           └─────────────────────────┘
```


### 4.2 Detailed Component Breakdown

#### Component 1: IFC Agent

**Purpose:** Extract all semantically relevant building element data from the IFC file, discarding geometry.

**Technology:** IfcOpenShell (Python)[^2]

**Installation:**

```bash
pip install ifcopenshell
```

**Core extraction logic:**

```python
import ifcopenshell
import ifcopenshell.util.element as util
import pandas as pd

model = ifcopenshell.open("project.ifc")

def extract_elements(ifc_type):
    elements = model.by_type(ifc_type)
    rows = []
    for el in elements:
        psets = util.get_psets(el)
        storey = util.get_container(el)
        rows.append({
            "GUID": el.GlobalId,
            "Name": el.Name,
            "Type": ifc_type,
            "Storey": storey.Name if storey else None,
            "Psets": psets
        })
    return pd.DataFrame(rows)

walls = extract_elements("IfcWall")
slabs = extract_elements("IfcSlab")
doors = extract_elements("IfcDoor")
windows = extract_elements("IfcWindow")
columns = extract_elements("IfcColumn")
```

**Output:** Per-element-type CSVs with GUID, name, storey, material, and all Pset values. A 116MB IFC typically compresses to **50–300KB of structured CSV**.[^11]

**Key Psets to extract per element type:**


| Element | Key Psets |
| :-- | :-- |
| Walls | `Pset_WallCommon`: IsExternal, FireRating, ThermalTransmittance, LoadBearing |
| Slabs | `Pset_SlabCommon`: LoadBearing, IsExternal, AcousticRating |
| Doors | `Pset_DoorCommon`: FireRating, IsExternal, SecurityRating |
| Windows | `Pset_WindowCommon`: ThermalTransmittance, AcousticRating |


***

#### Component 2: PDF/OCR Agent

**Purpose:** Extract text content from PDF construction documents — specs, NCC notes, engineer annotations, and structured schedule tables.

**Technology:** `pdfplumber` or `PyMuPDF` for text layer extraction; LLM for structured parsing of extracted text.[^12]

**Installation:**

```bash
pip install pdfplumber pymupdf
```

**Core logic:**

```python
import pdfplumber

def extract_pdf_text(pdf_path):
    text_by_page = []
    with pdfplumber.open(pdf_path) as pdf:
        for i, page in enumerate(pdf.pages):
            text_by_page.append({
                "page": i + 1,
                "text": page.extract_text(),
                "tables": page.extract_tables()
            })
    return text_by_page
```

**LLM then processes extracted text to identify:**

- Specified material types (concrete grade, brick type, etc.)
- Fire rating requirements per element type
- NCC compliance notes referencing specific elements
- Any quantities or counts explicitly stated in the spec

***

#### Component 3: Vision Agent

**Purpose:** Process architectural floor plan, elevation, and section drawings as images. Extract counts, dimensions, and schedule data from drawings that are graphical rather than text-based.[^4]

**Technology:** Claude Vision or GPT-4o vision capabilities

**How it works:**

1. Convert PDF pages to images using `pdf2image`
2. Pass each image to the vision model with a targeted prompt
3. Extract structured data from the visual content
```bash
pip install pdf2image
```

```python
from pdf2image import convert_from_path
import base64

def pdf_page_to_base64(pdf_path, page_num):
    images = convert_from_path(pdf_path, first_page=page_num,
                               last_page=page_num)
    # Convert PIL image to base64 for vision API
    ...
```

**Targeted vision prompts:**

- *"Count the number of doors on this floor plan and list their door mark IDs"*
- *"Extract all data from this door schedule table including mark, size, rating, and hardware"*
- *"What room names and areas are labelled on this floor plan?"*

**Key capability:** Handles scanned drawings, hand annotations, and graphical schedules that OCR alone misses.[^13]

***

#### Component 4: Orchestrator Agent (Claude Code)

**Purpose:** Coordinate all three agents, merge outputs, perform cross-validation, and generate final deliverables.

**Technology:** Claude Code as the top-level agent with tool use.[^3]

**Cross-validation logic (pseudo-code):**

```
ifc_doors = count("IfcDoor" in IFC CSV)
pdf_doors = count(doors in schedule extracted from PDF)
vision_doors = count(doors identified in floor plan images)

if ifc_doors == pdf_doors == vision_doors:
    → "PASS: Door count consistent across all sources (n=47)"
elif abs(ifc_doors - pdf_doors) > tolerance:
    → "WARN: IFC has {ifc_doors} doors, PDF schedule shows {pdf_doors}"

ifc_fire_rated = filter(IfcDoor where FireRating != null)
spec_fire_rated = extract(fire door requirements from PDF)
if len(ifc_fire_rated) < spec_fire_rated.count:
    → "WARN: Spec requires {n} fire-rated doors, IFC only has {m} flagged"
```

**This cross-validation is the core value proposition** — automating what a QS or estimator currently does manually across multiple documents.[^11]

***

## 5. Output Specification

### 5.1 QTO Table (CSV + Markdown)

| Element Type | Count | Total Area (m²) | Total Volume (m³) | Material | Level | Source |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| External Wall | 142 | 847.3 | 169.5 | Brick Veneer | L1 | IFC |
| Internal Wall | 203 | 1,203.7 | 120.4 | Lightweight | L1 | IFC |
| Slab | 4 | 342.1 | 85.5 | Concrete 32MPa | L1–L4 | IFC |
| Door | 47 | — | — | Solid Core | All | IFC+Vision |

### 5.2 Discrepancy Report (Markdown)

```markdown
## Discrepancy Report — [Project Name] — [Date]

### ⚠️ WARNING: Door Fire Rating Mismatch
- IFC Model: 0 doors flagged as fire-rated
- PDF Spec (Section 5.3): Requires 12 FRL-60 fire doors to stair cores
- Action: Architect to update IFC Pset_DoorCommon.FireRating

### ⚠️ WARNING: Door Count Variance
- IFC Model: 47 doors
- Door Schedule (PDF p.12): 49 doors
- Difference: 2 doors unaccounted for in model
- Action: BIM author to check Level 3 north wing

### ✅ PASS: Slab areas consistent
- IFC: 342.1 m² | PDF notes: 342m² ✓

### ✅ PASS: External wall material consistent
- IFC: Brick Veneer | Spec Section 3.1: Brick Veneer ✓
```


***

## 6. Prototype Scope (Phase 1)

To keep the initial prototype achievable in a short timeframe:


| In Scope | Out of Scope |
| :-- | :-- |
| Walls, slabs, doors, windows | MEP elements (pipes, ducts, cables) |
| Single IFC file input | Federated multi-model IFC |
| PDF text extraction | Scanned/hand-drawn PDFs (Phase 2) |
| Basic vision on floor plans | Point clouds, site surveys |
| CSV + Markdown output | Web UI / dashboard |
| Claude Code as orchestrator | Deployed API / microservice |

**Recommended first IFC element:** Start with `IfcDoor` — it has a clear schedule equivalent in the PDF set, a finite count, and a high-value discrepancy (fire ratings) that demonstrates real-world utility immediately.[^11]

***

## 7. Technology Stack

| Layer | Technology | Licence | Notes |
| :-- | :-- | :-- | :-- |
| IFC Parsing | IfcOpenShell | LGPL | Python, pip install [^2] |
| PDF Text | pdfplumber / PyMuPDF | MIT / AGPL | Standard Python libs [^12] |
| PDF → Image | pdf2image + poppler | MIT | Required for vision pipeline |
| Vision Model | Claude 3.5 Sonnet / GPT-4o | Commercial API | Multimodal [^4] |
| Orchestration | Claude Code | Commercial | Agent + tool use [^3] |
| Data Output | pandas + CSV | BSD | Structured output |
| Graph DB (Phase 2) | Neo4j or NetworkX | GPL/MIT | For Graph-RAG querying [^14] |
| Web Viewer (Phase 2) | xeokit or IFC.js | MIT | Embedded 3D viewer [^15] |


***

## 8. Phase 2 Roadmap

Once the prototype is validated:

1. **Graph-RAG layer** — Convert IFC to Neo4j graph, enable natural language queries via LLM[^14]
2. **Web UI** — Embedded xeokit viewer + agent chat interface in the browser[^15]
3. **Scanned drawing support** — OCR pipeline for legacy hand-drawn or scanned PDFs
4. **Trade packages** — Filtered QTO output per subcontractor (concreter, framer, plasterer)
5. **Cost integration** — Connect QTO quantities to material rate database for instant estimates[^16]
6. **PDF → IFC reverse pipeline** — Use tools like AmpliFy to generate IFC from 2D PDFs for projects without a BIM model[^17]
7. **BuildPass integration** — Link model elements to site diary entries, defects, and inspection checklists

***

## 9. Key Risks and Mitigations

| Risk | Impact | Mitigation |
| :-- | :-- | :-- |
| Poor IFC model quality (missing Psets, no materials) | Low QTO accuracy | Flag missing data explicitly in output; prompt user to request better model from architect |
| PDF drawing as scanned image only | OCR fails | Fall back to vision model on full page image |
| LLM hallucination on quantities | Wrong takeoff numbers | LLM never performs arithmetic — IfcOpenShell computes all quantities, LLM only formats and reasons [^11] |
| Large IFC file performance | Slow extraction | Filter by element type before loading full model; use IfcOpenShell streaming for large files [^10] |


***

## 10. References

- buildingSMART — IFC Standard (ISO 16739-1:2024):[^18][^6]
- IfcOpenShell Getting Started Docs:[^2]
- VIKTOR.ai — BIM IFC QTO Tutorial:[^19]
- DataDrivenConstruction — LLM QTO Automation:[^20]
- Claude Code + IFC QTO demo (March 4, 2026):[^3]
- arXiv — LLM-assisted Graph-RAG on IFC Data:[^14]
- ASCE — IFC-Based Automated QTO Algorithms:[^11]
- Civils.ai — AI for 2D CAD/PDF Takeoffs:[^12]
- AWS — AI-Powered Construction Document Analysis:[^13]
- xeokit BIM Viewer SDK:[^15]
- AmpliFy — PDF to IFC generation:[^17]
- Australian SMB BIM Adoption Research (UTS):[^5]
- Australia BIM Market Outlook 2024–2030:[^21]
- n8n — Estimate costs from IFC/Revit with GPT-4/Claude:[^16]

<div align="center">⁂</div>

[^1]: https://www.reddit.com/r/estimators/comments/1l97n23/is_bim_or_pdf_ai_the_future_of_preconstruction/

[^2]: https://docs.ifcopenshell.org/ifcopenshell/getting_started.html

[^3]: https://www.youtube.com/watch?v=ryJxOanNJVQ

[^4]: https://www.arxiv.org/pdf/2601.04819.pdf

[^5]: https://epress.lib.uts.edu.au/journals/index.php/AJCEB/article/view/5159/5557

[^6]: https://en.wikipedia.org/wiki/Industry_Foundation_Classes

[^7]: https://www.scia.net/en/scia-engineer/fact-sheets/interoperability-bim/shape-representation-ifc-file-format

[^8]: https://standards.buildingsmart.org/IFC/DEV/IFC4_2/FINAL/HTML/schema/ifckernel/lexical/ifcpropertyset.htm

[^9]: https://biblus.accasoftware.com/en/ifc-schema-the-ifcrelationship-concept/

[^10]: https://github.com/IfcOpenShell/IfcOpenShell/issues/2025

[^11]: https://ascelibrary.com/doi/10.1061/JAEIED.AEENG-1447

[^12]: https://civils.ai/blog/ai-for-pdf-cad-quantity-takeoffs/

[^13]: https://aws.amazon.com/blogs/spatial/ai-powered-construction-document-analysis-by-leveraging-computer-vision-and-large-language-models/

[^14]: https://arxiv.org/pdf/2504.16813.pdf

[^15]: https://github.com/xeokit/xeokit-bim-viewer

[^16]: https://n8n.io/workflows/7652-estimate-construction-costs-from-revitifc-models-with-gpt-4-and-claude/

[^17]: https://ify.inex.fr/amplify

[^18]: https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/content/introduction.htm

[^19]: https://www.viktor.ai/blog/219/bim-tutorial-build-an-ifc-app-for-quantity-take-offs

[^20]: https://datadrivenconstruction.io/2025/02/083-qto-automation-using-llm-and-structured-data/

[^21]: https://www.linkedin.com/pulse/australia-bim-modeling-service-market-outlook-growth-bisrf

