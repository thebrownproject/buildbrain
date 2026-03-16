# BuildBrain Research Summary — AI-Powered Construction QTO & BIM Intelligence

**Date:** March 2026
**Purpose:** Landscape research to inform BuildBrain prototype development

---

## 1. IfcOpenShell Ecosystem

### Current Version & Status

The latest stable release is **IfcOpenShell 0.8.4**, available on PyPI with support for Python 3.13 and 3.14. Development builds (0.8.5 alpha) are published regularly on GitHub. The project is actively maintained under the LGPL licence.

### IFC Schema Support

Complete parsing support for:
- IFC2x3 TC1
- IFC4 Add2 TC1
- IFC4x1
- IFC4x2
- **IFC4x3 Add2** (latest)

### Python API — Key Patterns for QTO

The API has matured significantly. The core extraction pattern for BuildBrain:

```python
import ifcopenshell
import ifcopenshell.util.element as util

model = ifcopenshell.open("project.ifc")

# Get all property sets as a dictionary
wall = model.by_type("IfcWall")[0]
psets = util.get_psets(wall)
# Returns: {"Pset_WallCommon": {"id": 123, "FireRating": "2HR", ...}}

# Filter for properties only or quantities only
props_only = util.get_psets(wall, psets_only=True)
qtos_only = util.get_psets(wall, qtos_only=True)

# Direct property access
fire_rating = util.get_pset(door, "Pset_DoorCommon", "FireRating")

# Get inherited type properties
wall_type = util.get_type(wall)
type_psets = util.get_psets(wall_type)

# Spatial containment
storey = util.get_container(wall)
```

The same patterns work across `IfcDoor`, `IfcWindow`, `IfcSlab`, and all other element types by changing the `by_type()` argument.

### Utility Modules

- `ifcopenshell.util.element` — property/quantity extraction, type resolution, spatial queries
- `ifcopenshell.util.selector` — CSS-like selector syntax for filtering elements
- `ifcopenshell.api.pset` — create/edit property sets programmatically
- `ifcopenshell.geom` — geometry processing with multi-CPU iterator

### Maturity Assessment

The Python API is production-ready for data extraction workflows. The `get_psets()` and `get_pset()` utilities are stable, well-documented, and the primary recommended approach. Documentation is at https://docs.ifcopenshell.org/. The IfcOpenShell Academy provides tutorials and the OSArch community forum is active for support.

**Sources:**
- [IfcOpenShell PyPI](https://pypi.org/project/ifcopenshell/)
- [IfcOpenShell 0.8.4 Documentation](https://docs.ifcopenshell.org/)
- [Code Examples](https://docs.ifcopenshell.org/ifcopenshell-python/code_examples.html)
- [Property Set API Docs](https://docs.ifcopenshell.org/autoapi/ifcopenshell/api/pset/index.html)
- [Using IfcOpenShell to Parse IFC Files (ThinkMoult)](https://thinkmoult.com/using-ifcopenshell-parse-ifc-files-python.html)
- [OSArch — Calculate Quantities](https://community.osarch.org/discussion/1346/ifcopenshell-python-calculate-quantities)
- [GitHub Releases](https://github.com/IfcOpenShell/IfcOpenShell/releases)

---

## 2. Commercial Competitors & Market Landscape

### Global Market Leaders (2026 Market Share)

| Tool | Market Share | Model | Price |
|------|-------------|-------|-------|
| **Bluebeam Revu** | 34% | PDF markup + takeoff | $3,240/yr per seat |
| **PlanSwift** | 19% | Desktop takeoff | $1,749 one-time |
| **On-Screen Takeoff** | 14% | PDF measurement | Subscription |
| **STACK** | 11% | Cloud-first takeoff | Subscription |
| **Buildxact** | 8% | Cloud estimating | $171/mo ($2,052/yr) |

### Australian Market — Key Players

**Buildxact** — The dominant Australian SMB tool. Specifically tailored for small-to-medium Australian builders ("tradies"), integrating takeoff through to invoicing. Over 25,000 Australian builders have adopted it. Claims 16x ROI in the first year by speeding up quotes fivefold. Cloud-based, subscription model.

**CostX (RIB Software)** — One of the most widely used estimating tools in Australia, particularly among quantity surveyors and enterprise teams. Combines 2D takeoff, 3D BIM model takeoff, and automated cost calculations. Handles large complex projects. Known for accuracy and a user-friendly interface.

**Cubit** — Widely used by Australian quantity surveyors. Strong BIM integration, uses 3D environments to derive quantities. Highly customisable, syncs with supplier databases.

**Other notable tools used in Australia:** Procore Estimating, Navisworks, Autodesk Takeoff, Bluebeam Revu.

### AI-Native Startups

**Togal.AI** — The leading AI-first takeoff platform. Uses proprietary deep learning and computer vision to automatically detect, measure, label, and compare spaces/features within construction drawings. Claims takeoffs completed in under a minute with up to 98% accuracy. Integrated ChatGPT for natural language querying. Cloud-based.

**Provision AI** — Combines automated takeoff, document analysis, and risk detection. Automatically reads drawings, specs, and contracts, extracting quantities and identifying scope gaps, conflicts, and cost risks in minutes.

**ConstructionBids.AI** — AI-powered blueprint reader and estimating platform.

**Infrrd** — AI for construction drawings, focusing on faster bids and smarter estimates.

### Industry Trends (2025-2026)

- Leading AI estimating platforms claim **94% accuracy** on quantity takeoffs for standard building types in 2026
- AI tools process plan sets **60% faster** than manual methods
- **15-25% fewer change orders** through more accurate initial pricing
- Cloud-first is becoming cloud-only — desktop apps face increasing pressure
- Manual measurement expected to decline significantly by 2028

### Gap Analysis for BuildBrain

None of these tools combine all three of: (1) IFC/BIM parsing, (2) PDF text extraction, and (3) vision-based drawing analysis in a single cross-validation pipeline. The AI-native startups (Togal, Provision) focus on PDF drawings only and do not parse IFC models. CostX handles BIM but lacks AI-driven PDF analysis. **The cross-validation between IFC model and PDF documents is an underserved niche, particularly for the Australian SMB market.**

**Sources:**
- [Best Bluebeam Alternatives for Construction Takeoff 2026](https://constructionbids.ai/blog/bluebeam-alternative-construction-takeoff-software)
- [9 Best Automated Takeoff Software 2025 — Provision AI](https://www.provision.com/blog/9-best-automated-takeoff-software-solutions-for-construction-risk-management-and-estimation-efficiency-in-2025-provision-ai)
- [Bluebeam vs. PlanSwift vs. Buildxact](https://sjestimatingfirm.com/2025/04/bluebeam-vs-planswift-vs-buildxact/)
- [Best Construction Estimating Software in Australia](https://costsolution.com.au/estimating-software/)
- [Buildxact — Capterra Australia 2026](https://www.capterra.com.au/software/173135/buildxact)
- [10 Construction Estimating Software Used in Australia](https://estimationqs.com/construction-estimating-software-used-in-australia/)
- [40 AI-Driven AEC Solutions to Watch in 2026 — BuiltWorlds](https://builtworlds.com/news/40-ai-driven-aec-solutions-to-know-in-2026/)
- [Togal.AI](https://www.togal.ai/)
- [Top 13 Construction Estimating Software for 2026](https://www.getclue.com/blog/top-construction-estimating-software)

---

## 3. AI + Construction Drawings — State of the Art

### Vision Model Performance (AECV-Bench Benchmark)

The **AECV-Bench** benchmark (January 2026, arXiv 2601.04819) is the first systematic evaluation of how well multimodal AI models understand architectural floor plans. It tests two tasks: (i) object counting on 120 high-quality floor plans (doors, windows, bedrooms, toilets), and (ii) drawing-grounded document QA spanning 192 question-answer pairs.

**Key findings — model accuracy on floor plan elements:**

| Model | Average Accuracy | Notes |
|-------|-----------------|-------|
| Gemini 2.5 Pro | 41% | Best overall performer |
| GPT-5 | 37% | Second place |
| Claude 3.7 Sonnet | 35% | Third place |

**Critical detail — accuracy varies dramatically by element type:**
- Bedrooms and toilets: ~74-91% exact-match accuracy (rooms are easy — large, labelled areas)
- **Doors: ~9-12% accuracy** (GPT-5 correctly identified doors only 12% of the time)
- **Windows: ~9-39% accuracy**
- MAPE of 20-50% for symbol-centric elements (doors, windows)

This disparity highlights the core challenge: architectural symbols (a door arc, a window break in a wall line) are fundamentally different from photographic objects. Models struggle with the symbolic visual language of technical drawings.

### Implications for BuildBrain

1. **Do not rely on vision models for accurate door/window counting from floor plans.** The AECV-Bench data shows this is unreliable (9-12% accuracy for doors).
2. **Vision is more useful for structured tables** — door schedules, finish schedules, and tabular data on drawings are much better handled (essentially OCR + table parsing).
3. **Use vision as a supplementary cross-validation signal**, not a primary data source. The IFC model should be the source of truth for counts.
4. **Room identification is where vision excels** — labelled spaces on floor plans are identified with high accuracy (74-91%).

### Open Source Projects

Several open-source projects exist for floor plan analysis:

| Project | Approach | Stars |
|---------|----------|-------|
| [DeepFloorplan](https://github.com/zlzeng/DeepFloorplan) | Multi-task CNN, wall/door/room segmentation (ICCV 2019) | Popular |
| [floor-plan-object-detection](https://github.com/sanatladkat/floor-plan-object-detection) | YOLOv8 for columns, walls, doors, windows | Active |
| [TF2DeepFloorplan](https://github.com/zcemycl/TF2DeepFloorplan) | TF2 implementation with Docker/TFLite | Maintained |
| [MLSTRUCT-FP](https://github.com/MLSTRUCT/MLSTRUCT-FP) | Dataset: 954+ large-scale floor plan images with wall annotations | Research |
| [FloorPlanParser](https://github.com/TINY-KE/FloorPlanParser) | Vectorisation service for floor plan elements | Niche |
| [AECV-Bench](https://github.com/AECFoundry/AECV-Bench) | Benchmark suite (code, data, evaluation scripts) | New |

### Practical Approach for BuildBrain

Given the benchmark results, the recommended pipeline is:
1. **IFC Agent** = primary source of truth for element counts and properties
2. **PDF Agent** = text extraction of schedules (pdfplumber for structured tables works well)
3. **Vision Agent** = secondary validation, best for: reading tabular schedules as images, identifying room labels/areas, providing a "sanity check" count
4. Cross-validate IFC vs. PDF schedule data first; use vision only when PDF text extraction fails (e.g., scanned documents)

**Sources:**
- [AECV-Bench: Can AI Really Read Your Building Plans?](https://www.aecfoundry.com/blog/can-ai-really-read-your-building-plans-introducing-aecv-bench)
- [AECV-Bench Paper (arXiv)](https://arxiv.org/abs/2601.04819)
- [AECV-Bench Website](https://aecv-bench.com/)
- [AECV-Bench Major Upgrade](https://www.aecfoundry.com/blog/can-ai-really-read-your-building-plans-aecv-bench-gets-a-major-upgrade)
- [Claude Vision Practical Use Cases](https://c-ai.chat/blog/claude-vision/)
- [Construction Drawing & Floor Plan Analysis With AI](https://www.businesswaretech.com/blog/architectural-floor-plan-analysis)
- [Anthropic Claude Opus 4.5 Transforms Architecture Design](https://archilabs.ai/posts/anthropic-claude-opus-45-transforms-architecture-design)

---

## 4. IFC File Format — Practical Considerations

### Structure Overview

IFC files use the **STEP physical file format** (ISO 10303-21) with a `.ifc` extension. Key characteristics:
- **Plain-text ASCII** — human-readable but bloated
- **Sequential format** — must be read start-to-finish; no random access / mid-file extraction
- **Non-hierarchical definitions** — entities reference each other by ID (`#123`)
- **Geometry dominates** — 80-90% of file content is geometry definitions (IfcCartesianPoint, IfcPolyLoop, IfcExtrudedAreaSolid, etc.)

### File Size Reality

| Project Type | Typical IFC Size | Entity Count |
|-------------|-----------------|--------------|
| Small residential | 10-50 MB | 100K-500K lines |
| Medium commercial | 50-200 MB | 500K-2M lines |
| Large commercial | 200-500+ MB | 2M-10M+ lines |

After extracting only property/relationship data (discarding geometry), a 116 MB IFC compresses to approximately 50-300 KB of structured CSV.

### Performance Pitfalls

1. **Memory exhaustion on large files** — Users report out-of-memory errors on 1.9 GB+ files. IfcOpenShell's DOM parser loads the entire file into memory. A 450 MB file took 1m40s to open with IfcOpenShell vs. 5.4s with a competitor library.

2. **v0.8.x regression** — Significant performance regression reported in v0.8.3 compared to v0.7.1 when loading IFC files and collecting geometry (GitHub issue #7063). Worth monitoring.

3. **Geometry processing is separate from data loading** — Opening a file loads entity data into memory; processing geometry (triangulation, shape creation) is a separate, even more expensive step. For QTO, geometry processing can often be skipped entirely.

### Optimization Strategies for BuildBrain

1. **Skip geometry entirely** — For QTO, we only need properties. An experimental `stream` option in `ifcopenshell.open()` can exclude geometry classes, dramatically reducing memory footprint.

2. **Text pre-processing** — Treat the IFC file as text first, delete lines containing geometry entities (IfcCartesianPoint, IfcPolyLoop, etc.) to create a smaller file that opens faster. This "brute force" approach works when you only need alphanumeric data.

3. **Use the geometry iterator for any geometry needs** — Multi-CPU processing, significantly faster than sequential.

4. **Iterator settings** — `DISABLE_TRIANGULATION`, `WELD_VERTICES`, `APPLY_DEFAULT_MATERIALS` can reduce memory during any geometry processing.

5. **IFC-ZIP format** — Compressed IFC reduces file size by 60-80%. IfcOpenShell can open `.ifczip` files directly.

6. **Deduplication** — Large file sizes are often caused by duplicate entity instances. The IfcOpenShell optimizer can remove these.

### Alternative Formats

| Format | Extension | Compression | Notes |
|--------|-----------|-------------|-------|
| IFC-SPF | .ifc | None (ASCII) | Default, most common |
| IFC-XML | .ifcxml | None (XML) | Verbose, rarely used |
| IFC-ZIP | .ifczip | 60-80% smaller | Compressed SPF |
| IFC-HDF5 | .hdf5 | Binary, fast | Experimental |

### Recommended Approach for BuildBrain

```
1. Receive .ifc file
2. Check file size
3. If < 100MB: ifcopenshell.open() directly
4. If >= 100MB: Pre-filter geometry lines via text processing, then open
5. Extract by_type() for target elements only (IfcDoor, IfcWall, etc.)
6. Use get_psets() per element — never touch geometry
7. Flatten to CSV/DataFrame
```

**Sources:**
- [IFC Formats — buildingSMART Technical](https://technical.buildingsmart.org/standards/ifc/ifc-formats/)
- [Industry Foundation Classes — Wikipedia](https://en.wikipedia.org/wiki/Industry_Foundation_Classes)
- [Open Large IFC Model Without Geometry — OSArch](https://community.osarch.org/discussion/1519/open-large-ifc-model-without-its-geometry-data)
- [Strategies on Dealing with Large IFC Datasets (GitHub #2025)](https://github.com/IfcOpenShell/IfcOpenShell/issues/2025)
- [IfcOpenShell Open Files is Slow (GitHub #5026)](https://github.com/IfcOpenShell/IfcOpenShell/issues/5026)
- [Slow Performance v0.8.3 vs v0.7.1 (GitHub #7063)](https://github.com/IfcOpenShell/IfcOpenShell/issues/7063)
- [Everything Worth Knowing About IFC — BIM Corner](https://bimcorner.com/everything-worth-knowing-about-the-ifc-format/)
- [IfcOpenShell Optimizer Tutorial](https://academy.ifcopenshell.org/posts/ifcopenshell-optimizer-tutorial/)

---

## 5. Australian Building Standards — NCC & NatHERS

### NCC 2025

The **NCC 2025** (National Construction Code) was published for preview on 1 February 2026 and commences on **1 May 2026**. It is maintained by the Australian Building Codes Board (ABCB).

Key updates in NCC 2025:
- Improved **lighting control requirements** for commercial buildings
- Mandatory **on-site solar photovoltaic systems** to reduce energy consumption
- Updated water management and fire safety provisions
- Continued emphasis on energy efficiency, resilience, and build quality
- Ministers committed to a multi-year program to **modernise and simplify the NCC**, including digital and AI-assisted tools

### NCC Structure Relevant to BuildBrain

| Volume | Scope | Relevance to BuildBrain |
|--------|-------|------------------------|
| Volume One | Commercial buildings (Class 2-9) | Fire rating requirements, energy efficiency |
| Volume Two | Residential buildings (Class 1 & 10) | Primary target — residential QTO |
| Volume Three | Plumbing and drainage | Out of scope for Phase 1 |

### Key NCC Compliance Points Extractable from IFC

| NCC Requirement | IFC Property Set | IFC Property |
|----------------|-----------------|--------------|
| Fire-rated doors | Pset_DoorCommon | FireRating (FRL values: -/60/60, etc.) |
| External wall thermal performance | Pset_WallCommon | ThermalTransmittance (U-value) |
| Acoustic separation | Pset_WallCommon | AcousticRating (Rw value) |
| Load-bearing designation | Pset_WallCommon / Pset_SlabCommon | LoadBearing (boolean) |
| External vs internal classification | Pset_*Common | IsExternal (boolean) |

### NatHERS (Nationwide House Energy Rating Scheme)

NatHERS is Australia's framework for rating the energy efficiency of residential buildings on a 0-10 star scale. Key points:

- **Underpinned by CSIRO's AccuRate** tool, which uses the Chenath thermal physics engine
- NCC references NatHERS as a compliance pathway for residential thermal energy efficiency
- Current workflow relies on **manual data input** into NatHERS tools, making it incompatible with typical BIM workflows
- A research prototype called **SketchuRATE** demonstrated converting BIM data directly into AccuRate's file format, minimising manual data entry
- Practitioners work with DWG and IFC formats, but automated IFC-to-NatHERS pipelines are not yet mainstream
- NatHERS tools were updated in December 2025

### BIM-to-NCC Compliance Automation

The current state is early but promising:
- buildingSMART's **Information Delivery Specification (IDS)** standard enables machine-readable BIM requirements
- IDS can define rules like "if space is an escape route, then doors must have FireRating property"
- Some firms have implemented NCC 2022 energy efficiency checks directly within BIM models, gaining building approval 3 months faster
- The IFC-to-NCC mapping is manual today but increasingly formalised through IDS

### Opportunity for BuildBrain

NCC compliance checking from IFC data is an adjacent high-value feature:
1. Extract fire ratings from IfcDoor Pset_DoorCommon → compare against NCC Volume One fire requirements
2. Extract thermal transmittance from IfcWall → compare against NCC energy efficiency thresholds
3. Validate IsExternal flags → ensure external elements meet different NCC requirements than internal
4. Flag missing compliance data → "12 doors have no FireRating property — NCC requires fire rating for doors to fire-isolated stairways"

**Sources:**
- [NCC 2025 Published — Standards Australia](https://www.standards.org.au/news/national-construction-code-ncc-2025-published-key-updates-for-australias-building-sector)
- [NCC 2025 — HIA](https://hia.com.au/national-construction-code-2025)
- [NCC Official Site](https://ncc.abcb.gov.au/)
- [NCC 2025 Volume Two Preview Draft (ABCB)](https://www.abcb.gov.au/sites/default/files/resources/2026/NCC-2025-preview-draft-Volume-Two.pdf)
- [NatHERS Official Site](https://www.nathers.gov.au/)
- [NatHERS Tools Update December 2025 — CSIRO](https://ahd.csiro.au/nationwide-house-energy-rating-scheme-nathers-tools-update-december-2025/)
- [Improving Thermal Performance Through NatHERS and BIM Integration (Academia)](https://www.academia.edu/89931837/Improving_thermal_performance_design_outcomes_through_NatHERS_and_BIM_integration)

---

## 6. Cross-Validation Approaches

### Academic Research

Recent academic work specifically addresses the BIM-vs-document validation problem:

**BIM and Schema Cross-Validation Using Semantics (2025)**
Wojciech Teclaw et al. published a conceptual framework for validating consistency between MEP schematic drawings and BIM models using semantic representations. The approach uses LLMs to extract structured knowledge from schematic drawings, enabling automated cross-validation against BIM data. (Published in *Automation in Construction*, 2025)

**Automated Code Compliance via Knowledge Graphs (2023)**
Research published in *Scientific Reports* transforms specification provisions into computer-recognisable structured language using NLP, forming knowledge graph patterns that can be cross-checked against BIM model data exported via IFC.

**Scan-vs-BIM Deviation Detection**
Point-to-point comparison methods for automated Scan-vs-BIM deviation detection identify discrepancies between as-planned (BIM) and as-built (reality capture) components.

### Industry Tools and Standards

**buildingSMART IDS (Information Delivery Specification)**
The most relevant industry standard for BuildBrain. IDS defines information requirements in a human-readable and machine-interpretable format. It can specify:
- Required properties for element types (e.g., all IfcDoor must have Pset_DoorCommon.FireRating)
- Allowed values (e.g., FireRating must be one of: 30, 60, 90, 120)
- Nested rules (e.g., doors in escape routes must have fire ratings)
- Pass/fail validation results

**Solibri Model Checker**
Industry-leading BIM validation tool with 70+ predefined rulesets for geometric analysis, clash detection, IDS/COBie support, and code compliance checking. Enterprise-priced.

**Data Octopus (IFC Checker Online)**
Cloud-based IFC validation tool that checks models against IDS requirements.

**Tektome**
Offers automated BIM model validation at scale using parametric rule-based approaches.

### Cross-Validation Patterns Relevant to BuildBrain

Based on the research, here are the practical cross-validation patterns:

**Pattern 1: Count Reconciliation**
```
IFC door count vs. PDF door schedule row count vs. Vision floor plan door count
→ PASS / WARN with specific delta
```

**Pattern 2: Property Completeness**
```
For each IfcDoor: check Pset_DoorCommon.FireRating is not null
→ List doors with missing fire ratings
→ Cross-reference against spec fire requirements
```

**Pattern 3: Value Consistency**
```
IFC door fire rating = "FRL 60/60/60"
PDF spec section 5.3 requires = "FRL -/60/60" for corridor doors
→ WARN: Rating mismatch or over-specification
```

**Pattern 4: Material Verification**
```
IFC wall material = "Brick Veneer"
PDF spec section 3.1 material = "Brick Veneer"
→ PASS: Material consistent
```

**Pattern 5: Dimensional Cross-Check**
```
IFC slab area = 342.1 m²
PDF annotation = "342 m²"
→ PASS: Within tolerance (0.03%)
```

### Key Insight

No existing tool performs the specific cross-validation BuildBrain targets: **IFC model data vs. PDF specification text vs. visual drawing analysis**. The closest approaches are:
- Solibri (BIM-only, no PDF analysis)
- AI takeoff tools like Togal/Provision (PDF-only, no IFC parsing)
- Academic prototypes (not productised)

This confirms the gap identified in the BuildBrain PRD.

**Sources:**
- [BIM and Schema Cross-Validation Using Semantics (2025)](https://journals.sagepub.com/doi/full/10.1177/14780771251352954)
- [Automated Code Compliance Checking via BIM and Knowledge Graph](https://www.nature.com/articles/s41598-023-34342-1)
- [IDS: Stop Manual Checking — BIM Corner](https://bimcorner.com/ids-stop-manual-checking-automate-bim-validation/)
- [IFC Validation Tools for BIM Projects — BIM Heroes](https://bimheroes.com/ifc-validation-tools-for-bim-projects/)
- [Automated BIM Model Validation at Scale — Tektome](https://tektome.com/expertise-center/blog/automated-bim-model-validation-at-scale)
- [Model Validation as a Key Step in the BIM Workflow — BIM Corner](https://bimcorner.com/model-validation-as-a-key-step-in-the-bim-workflow/)
- [BIM-Based Automated Code Compliance — Malaysian Fire Safety](https://www.mdpi.com/2075-5309/13/6/1404)
- [Data Octopus — IFC Checker Online](https://dataoctopus.net/)

---

## 7. Summary & Strategic Implications for BuildBrain

### What the Research Confirms

1. **IfcOpenShell is mature enough** — v0.8.4 has stable, well-documented APIs for property extraction. The `get_psets()` pattern is exactly what BuildBrain needs. Memory management on large files is the main concern, but solvable by skipping geometry.

2. **The Australian market gap is real** — Buildxact (25K+ Australian users) dominates SMB estimating but has no IFC parsing or AI-driven analysis. CostX has BIM but targets enterprise QS firms. No tool serves the "SMB builder who receives an IFC from their architect and needs to validate it against PDF specs."

3. **Vision models are NOT reliable for door/window counting on floor plans** — AECV-Bench shows 9-12% accuracy for doors. BuildBrain should use vision for table/schedule reading and room identification, not element counting. This reinforces the spec's approach of IFC as primary source.

4. **The cross-validation niche is unoccupied** — Academic research recognises the need, IDS provides a standards framework, but no productised tool performs IFC-vs-PDF-vs-drawing validation for SMB users.

5. **NCC compliance checking is a compelling adjacent feature** — Fire rating validation (IfcDoor Pset_DoorCommon.FireRating vs. NCC requirements) is technically straightforward and high-value.

6. **Start with IfcDoor** — This is validated by the research. Doors have clear PDF schedule equivalents, finite counts, critical fire rating properties, and the highest demonstration value for cross-validation.

### Recommended Adjustments to Spec

Based on this research:

- **De-emphasise vision agent for Phase 1** — Use it only for reading tabular schedules, not for floor plan element counting. The AECV-Bench results show this is unreliable.
- **Add IFC file size handling strategy** — Implement the text pre-filtering approach for files >100MB to avoid memory issues.
- **Consider IDS integration** — buildingSMART's Information Delivery Specification could formalise validation rules and provide interoperability with other BIM tools.
- **Add NCC fire rating validation** — Low-hanging fruit that demonstrates immediate compliance value.
- **Monitor IfcOpenShell v0.8.x performance** — Regression issues reported between 0.7.1 and 0.8.3; benchmark on target file sizes.
