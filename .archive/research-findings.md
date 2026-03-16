# BuildBrain — Research Findings

**Date:** March 2026
**Purpose:** Supplementary research to validate spec assumptions, assess technology readiness, and identify risks.

---

## 1. IfcOpenShell — Technology Readiness

**Current version:** 0.8.4 (PyPI), supports Python 3.13/3.14 and all IFC schemas through IFC4x3 Add2.

The Python API is mature for QTO workflows. The core extraction pattern is well-established:

```python
import ifcopenshell.util.element as util

psets = util.get_psets(element)                    # all property sets as dicts
psets = util.get_psets(element, psets_only=True)    # exclude quantity sets
psets = util.get_psets(element, qtos_only=True)     # quantity sets only
value = util.get_pset(element, "Pset_DoorCommon", "FireRating")  # direct access
```

**Performance considerations:**
- Known regression in v0.8.3 vs v0.7.1 for large files — worth benchmarking early with real-world IFC files
- For files >500MB, text pre-filtering to strip geometry lines before parsing can reduce memory usage significantly
- `ifcopenshell.open()` has an experimental `stream` option for large files
- Multi-CPU geometry iterator available (not needed for QTO since we discard geometry)

**Defensive coding:** Always null-check after downcasting. Optional IFC properties are wrapped — verify field existence before access. Schema validation only available in the Python API.

**Documentation:** [docs.ifcopenshell.org](https://docs.ifcopenshell.org), active community on OSArch forums.

---

## 2. Competitive Landscape

### Australian Market

| Tool | Focus | IFC Support | AI/Automation | Price Point |
|------|-------|-------------|---------------|-------------|
| **Buildxact** | SMB builders, estimating | None | None | ~$171/mo, 25K+ AU builders |
| **CostX** | Enterprise QS | Full BIM support | Limited | Enterprise pricing |
| **Cubit** | QS firms | 3D takeoff | Limited | Mid-market |

### Global AI-Native Startups

| Tool | Approach | Limitation |
|------|----------|------------|
| **Togal.AI** | AI PDF drawing takeoffs | No IFC parsing |
| **Provision AI** | AI PDF drawing takeoffs | No IFC parsing |
| **Civils.ai** | AI for PDF/CAD takeoffs | No IFC cross-validation |
| **Bluebeam** | PDF markup + measurement (34% global share) | Manual, no AI |

### The Gap

No existing tool performs three-source cross-validation (IFC model vs PDF specifications vs drawing images). Buildxact dominates AU SMB but can't read IFC files. CostX reads IFC but is enterprise-only. AI startups (Togal, Provision) automate PDF takeoffs but ignore IFC models entirely.

**BuildBrain's cross-validation niche is genuinely unoccupied.**

---

## 3. Vision Models on Architectural Drawings

### AECV-Bench Findings (arXiv 2601.04819)

This benchmark evaluated multimodal vision models on AEC document analysis tasks. Key results:

| Task | Best Model Accuracy | Implication |
|------|---------------------|-------------|
| Door/window counting on floor plans | 9–12% | Unreliable — do not use for element counts |
| Room identification | 74–91% | Usable for room label extraction |
| Schedule/table reading | Moderate | Usable with targeted prompts |
| General AEC understanding | ~41% (Gemini 2.5 Pro best) | Far from production-ready for general use |

### Practical Recommendations for BuildBrain

**Use vision for:**
- Reading tabular door/window schedules from PDF images
- Extracting room names and labels from floor plans
- Reading specification text that OCR misses (annotations, stamps)

**Do NOT use vision for:**
- Counting doors/windows on floor plans (9-12% accuracy)
- Measuring dimensions from drawings
- Anything where the IFC model already has the data

**The IFC model should always be the source of truth for element counts and quantities.** Vision is a validation/supplementary channel, not primary.

### Civils.ai Approach (Reference)

Civils.ai claims 95%+ precision on element identification, but they use purpose-built object detection models — not general vision LLMs. Their stack:
- Pattern recognition + object detection for structural elements
- OCR for text/labels/dimensions
- AI measurement agents for lengths, areas, volumes
- Handles both raster (scanned) and vector PDFs

This is a more mature approach than raw LLM vision calls. Worth studying if the Vision Agent needs to scale beyond schedule reading.

---

## 4. PDF Extraction

**pdfplumber** (MIT license) is the recommended starting point:
- Extracts text layers, tables, and page structure
- Handles vector PDFs well
- `page.extract_tables()` returns structured table data directly

**PyMuPDF / fitz** (AGPL license) as alternative:
- Faster for large PDFs
- Better image extraction
- AGPL license is restrictive for commercial use

**pdf2image + Poppler** for the vision pipeline:
- Converts PDF pages to images for Claude Vision
- Required dependency: Poppler binaries

**Recommended approach:** Use pdfplumber for text/table extraction first. Only fall back to vision (pdf2image → Claude Vision) for pages where text extraction fails or for graphical schedules.

---

## 5. Australian Building Standards & Compliance

### NCC 2025

- Published for preview 1 Feb 2026, commences **1 May 2026**
- Increased data requirements around fire safety, accessibility, energy efficiency
- Key compliance data extractable from IFC property sets:

| Compliance Area | IFC Property | Pset |
|----------------|--------------|------|
| Fire rating | FireRating | Pset_DoorCommon, Pset_WallCommon |
| Thermal performance | ThermalTransmittance | Pset_WallCommon, Pset_WindowCommon |
| External/internal classification | IsExternal | All Common Psets |
| Load bearing | LoadBearing | Pset_WallCommon, Pset_SlabCommon |
| Acoustic rating | AcousticRating | Pset_SlabCommon, Pset_WindowCommon |

### NatHERS Energy Ratings

BIM-to-energy-rating integration is still immature. Current tools (AccuRate, FirstRate5) require manual data input. A research prototype (SketchuRATE) demonstrated automated BIM-to-AccuRate conversion but is not productised. **This is a future opportunity** — extracting thermal properties from IFC and pre-filling energy rating tool inputs.

### buildingSMART IDS

Information Delivery Specification (IDS) is a machine-readable standard for BIM validation rules. Example: "all doors in escape routes must have FireRating property defined." Could be used to encode NCC requirements as validation schemas rather than hard-coding compliance checks. Worth investigating for the compliance expansion.

---

## 6. Cross-Validation — State of the Art

### Academic Work

- 2025 research on semantic cross-validation of BIM vs schematic drawings using LLMs exists but is not productised
- The concept is validated in literature but no commercial tool implements it

### Industry Standards

- **Solibri** — checks BIM model only (rule-based, no PDF cross-reference)
- **buildingSMART IDS** — validates BIM data completeness (no PDF cross-reference)
- AI tools (Togal, Civils.ai) — check PDFs only (no BIM cross-reference)

### BuildBrain's Position

The IFC-vs-PDF-vs-drawing cross-validation niche is unoccupied. This is the core differentiator. The orchestrator's ability to say "IFC has 0 fire-rated doors but spec Section 5.3 requires 12 FRL-60 doors" is something no existing tool does automatically.

---

## 7. Graph-RAG on IFC Data (Phase 2 Reference)

Paper: arXiv 2504.16813

The approach converts IFC entity relationships into a graph database (Neo4j or NetworkX), then uses an LLM to translate natural language queries into graph traversals.

**Enables queries like:**
- "Show all doors in escape routes without fire ratings"
- "Which walls on Level 3 are load-bearing but have no fire rating?"
- "List all spaces connected to the main stair core"

IFC is inherently a graph (entities + relationships), so this conversion is natural. The LLM's role is query translation and result summarisation — not computation.

**Practical value:** Turns a static QTO report into an interactive query interface. High value for BIM coordinators and compliance auditors.

---

## 8. Phase 2 Technology Notes

### xeokit BIM Viewer (for future web UI)

- Supports IFC2x3 and IFC4, converts to XKT format
- Runs in all major browsers including mobile
- Features: 3D/2D modes, X-ray view, section planes, object selection, property inspection, BCF viewpoints
- **Licence: AGPL** — commercial licence required from Creoox AG for product use
- Good candidate for embedded viewer if BuildBrain gets a web UI

### AmpliFy — PDF to IFC (for future no-BIM workflow)

- Generates IFC + RVT from residential PDF plans, free, GPL v3
- Currently optimised for French residential plans
- v1.4.0 (Nov 2025), developed by INEX BET
- Useful concept for Australian builders who only have 2D drawings — but not needed for prototype since we assume IFC is provided

---

## 9. Key Takeaways for Prototype

1. **IfcOpenShell is ready.** The API is mature, well-documented, and the extraction pattern is straightforward.

2. **Start with IfcDoor fire rating validation** — highest signal, lowest complexity, immediately demonstrable value.

3. **Vision agent should read schedules, not count elements.** AECV-Bench proves floor plan counting is unreliable. Use vision for tabular data extraction from PDF images.

4. **pdfplumber first, vision as fallback.** Text extraction is faster, cheaper, and more reliable than vision for most PDF content.

5. **Cross-validation is the moat.** No competitor does three-source validation. This is where BuildBrain's value lives.

6. **NCC 2025 timing is good.** New compliance requirements starting May 2026 create demand for automated compliance checking against BIM data.

7. **The Australian SMB market is underserved.** Buildxact has market share but zero BIM intelligence. There's room for a tool that bridges the gap between "I got an IFC from the architect" and "I need quantities and compliance checks."
