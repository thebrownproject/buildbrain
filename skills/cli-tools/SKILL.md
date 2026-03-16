---
name: cli-tools
description: Reference manual for BuildBrain CLI tools (ifc_extract.py and pdf_extract.py). Shows all commands, flags, output formats, and type shorthands. Use this as a reference when working with IFC or PDF data.
allowed-tools: Bash, Read, Write
disable-model-invocation: true
---

# /cli-tools — BuildBrain CLI Reference

This is the reference manual for the two CLI tools that power BuildBrain. Other skills (`/scan`, `/ifc-extract`, `/pdf-extract`, `/cross-validate`, `/report`) use these tools — refer here for command syntax and output formats.

The scripts are bundled with this plugin at `scripts/ifc_extract.py` and `scripts/pdf_extract.py` relative to this skill's directory.

## Finding the scripts

The CLI scripts are located in this skill's `scripts/` directory. To get the absolute path:

```bash
# The scripts directory is relative to this SKILL.md file
# From the plugin root:
ls skills/cli-tools/scripts/
```

All commands below use `python <path-to-script>` — replace with the actual path to the scripts directory.

---

## ifc_extract.py — IFC Model Extraction

Wraps IfcOpenShell. Queries IFC building models and returns structured JSON.

### Commands

#### `summary` — Scan entire model
```bash
python <scripts>/ifc_extract.py <file.ifc> summary
```
Returns: element type counts, storeys, schema version, file size, parse time.

#### `list <type>` — List all elements of a type
```bash
python <scripts>/ifc_extract.py <file.ifc> list <element_type>
```
Returns: all elements with guid, name, type_name, storey, properties, quantities, material.

#### `props <guid>` — Detailed properties for one element
```bash
python <scripts>/ifc_extract.py <file.ifc> props <guid>
```
Returns: full property sets, quantity sets, material, and metadata for a single element.

#### `query <type>` — Filter elements by property
```bash
python <scripts>/ifc_extract.py <file.ifc> query <type> --property <Pset.Property> --value <value>
python <scripts>/ifc_extract.py <file.ifc> query <type> --property <Pset.Property> --not-null
```
Examples:
- Fire-rated doors: `query door --property Pset_DoorCommon.FireRating --not-null`
- External walls: `query wall --property Pset_WallCommon.IsExternal --value true`
- Doors without fire rating: `query door --property Pset_DoorCommon.FireRating --value null`

#### `quantities <type>` — Pre-computed aggregates
```bash
python <scripts>/ifc_extract.py <file.ifc> quantities <type>
python <scripts>/ifc_extract.py <file.ifc> quantities <type> --group-by storey
python <scripts>/ifc_extract.py <file.ifc> quantities <type> --group-by type
```
Returns: totals (count, area, volume), grouped breakdowns, source tracking (Qto_ vs geometry computed).

**Use this instead of computing numbers yourself — LLMs never do arithmetic.**

#### `validate` — Data quality check
```bash
python <scripts>/ifc_extract.py <file.ifc> validate
```
Returns: issues (missing psets, proxy elements, orphans) and completeness metrics per element type.

#### `export <type>` — CSV export
```bash
python <scripts>/ifc_extract.py <file.ifc> export <type> --output <file.csv>
```

### Output Control Flags

| Flag | Works with | Effect |
|------|-----------|--------|
| `--save` | All commands | Write output to `output/ifc_<type>_<timestamp>.json` |
| `--limit N` | list, query, export | Max elements to return |
| `--offset N` | list, query, export | Skip first N elements |
| `--fields f1,f2` | list, query, export | Only include specific fields |
| `--compact` | list, query, export | Return only guid, name, type, storey (no properties) |

### Type Shorthand Mapping

| Shorthand | IFC Type | Also accepts |
|-----------|----------|-------------|
| `door` | IfcDoor | |
| `window` | IfcWindow | |
| `wall` | IfcWall | |
| `slab` | IfcSlab | `floor` |
| `roof` | IfcRoof | |
| `column` | IfcColumn | |
| `beam` | IfcBeam | |
| `stair` | IfcStair | |
| `railing` | IfcRailing | |
| `space` | IfcSpace | `room` |
| `covering` | IfcCovering | |

Any unrecognised type is passed through as-is (e.g., `IfcFurniture`, `IfcBuildingElementProxy`).

### Natural Language → CLI Translation

#### Doors (Pset_DoorCommon)
| User says | CLI command |
|-----------|-------------|
| "fire-rated doors" | `query door --property Pset_DoorCommon.FireRating --not-null` |
| "doors without fire rating" | `query door --property Pset_DoorCommon.FireRating --value null` |
| "external doors" | `query door --property Pset_DoorCommon.IsExternal --value true` |
| "security-rated doors" | `query door --property Pset_DoorCommon.SecurityRating --not-null` |
| "door count" / "how many doors" | `quantities door` |
| "doors per level" | `quantities door --group-by storey` |

#### Windows (Pset_WindowCommon)
| User says | CLI command |
|-----------|-------------|
| "external windows" | `query window --property Pset_WindowCommon.IsExternal --value true` |
| "acoustic-rated windows" | `query window --property Pset_WindowCommon.AcousticRating --not-null` |
| "total window area" | `quantities window` |
| "windows per level" | `quantities window --group-by storey` |

#### Walls (Pset_WallCommon)
| User says | CLI command |
|-----------|-------------|
| "external walls" | `query wall --property Pset_WallCommon.IsExternal --value true` |
| "internal walls" | `query wall --property Pset_WallCommon.IsExternal --value false` |
| "load-bearing walls" | `query wall --property Pset_WallCommon.LoadBearing --value true` |
| "fire-rated walls" | `query wall --property Pset_WallCommon.FireRating --not-null` |
| "wall areas per level" | `quantities wall --group-by storey` |

#### Slabs / Floors (Pset_SlabCommon)
| User says | CLI command |
|-----------|-------------|
| "load-bearing slabs" | `query slab --property Pset_SlabCommon.LoadBearing --value true` |
| "floor areas per level" | `quantities slab --group-by storey` |

#### Roofs (Pset_RoofCommon)
| User says | CLI command |
|-----------|-------------|
| "fire-rated roofs" | `query roof --property Pset_RoofCommon.FireRating --not-null` |
| "total roof area" | `quantities roof` |

#### Columns (Pset_ColumnCommon)
| User says | CLI command |
|-----------|-------------|
| "load-bearing columns" | `query column --property Pset_ColumnCommon.LoadBearing --value true` |
| "columns per level" | `quantities column --group-by storey` |

#### Beams (Pset_BeamCommon)
| User says | CLI command |
|-----------|-------------|
| "load-bearing beams" | `query beam --property Pset_BeamCommon.LoadBearing --value true` |
| "beam spans" | `list beam` (check Span in Pset_BeamCommon) |

#### Stairs (Pset_StairCommon)
| User says | CLI command |
|-----------|-------------|
| "fire-rated stairs" | `query stair --property Pset_StairCommon.FireRating --not-null` |
| "stair dimensions" | `list stair` (check NumberOfRiser, RiserHeight, TreadLength) |

Note: Stair quantities are on child IfcStairFlight via Qto_StairFlightBaseQuantities.

#### Spaces / Rooms (Pset_SpaceCommon)
| User says | CLI command |
|-----------|-------------|
| "public spaces" | `query space --property Pset_SpaceCommon.PubliclyAccessible --value true` |
| "room areas" | `list space` (areas in Qto_SpaceBaseQuantities, not Pset) |
| "gross planned area" | `query space --property Pset_SpaceCommon.GrossPlannedArea --not-null` |

#### Railings (Pset_RailingCommon)
| User says | CLI command |
|-----------|-------------|
| "external railings" | `query railing --property Pset_RailingCommon.IsExternal --value true` |
| "railing heights" | `list railing` (check Height in Pset_RailingCommon) |

#### General / Discovery
| User says | CLI command |
|-----------|-------------|
| "what's in this model" | `summary` |
| "data quality" | `validate` |
| "show element [GUID]" | `props <guid>` |
| "export to CSV" | `export <type> --output output/<type>.csv` |
| "proxy elements" | `list IfcBuildingElementProxy` |

---

## pdf_extract.py — PDF Document Extraction

Wraps pdfplumber. Extracts text, tables, and schedules from PDF construction documents.

### Commands

#### `schedules` — Auto-detect schedule tables
```bash
python <scripts>/pdf_extract.py <file.pdf> schedules
```
Scans every page for known schedule column headers (door, window, finish). Best starting point.

#### `search "keyword"` — Find pages containing a keyword
```bash
python <scripts>/pdf_extract.py <file.pdf> search "door schedule"
python <scripts>/pdf_extract.py <file.pdf> search "fire rating"
```
Returns matching pages with context snippets. Use this to locate content before extracting.

#### `tables` — Extract tables from pages
```bash
python <scripts>/pdf_extract.py <file.pdf> tables
python <scripts>/pdf_extract.py <file.pdf> tables --pages 12-15
python <scripts>/pdf_extract.py <file.pdf> tables --pages 3,7,12-14
```

#### `text` — Extract raw text from pages
```bash
python <scripts>/pdf_extract.py <file.pdf> text
python <scripts>/pdf_extract.py <file.pdf> text --pages 1-5
```

### Flags

| Flag | Works with | Effect |
|------|-----------|--------|
| `--save` | All commands | Write output to `output/pdf_<command>_<timestamp>.json` |
| `--pages` | text, tables | Page range: `1-5`, `12`, `1,3,5-8` |

### Common Patterns

```bash
# What schedules are in this PDF?
python <scripts>/pdf_extract.py <file.pdf> schedules --save

# Find the door schedule
python <scripts>/pdf_extract.py <file.pdf> search "door schedule" --save
python <scripts>/pdf_extract.py <file.pdf> tables --pages <matched_pages> --save

# Extract everything from page 5
python <scripts>/pdf_extract.py <file.pdf> text --pages 5 --save
python <scripts>/pdf_extract.py <file.pdf> tables --pages 5 --save
```

---

## Error Format

Both tools return structured JSON errors:
```json
{"error": true, "error_type": "file_not_found", "message": "File not found: nonexistent.ifc"}
```

Exit codes: 0 = success, 1 = failure, 2 = invalid arguments.

## Important Rules

1. **LLMs never do arithmetic.** Use `quantities` for counts, areas, volumes. Never sum values from `list` output.
2. **Always use `--save`** so results persist for `/cross-validate` and `/report`.
3. **Null properties are normal.** Many IFC exports omit standard property sets — this is an export settings issue, not a data error.
4. **File discovery is Claude's job.** CLI tools require explicit file paths. List `data/` to find files.
