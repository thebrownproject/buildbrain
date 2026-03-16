---
name: report
description: Generate formatted construction deliverables — QTO tables, element schedules, material takeoffs, compliance checklists. Reads extracted data from output/, uses quantities command for aggregates. Formats per Australian construction conventions.
allowed-tools: Bash, Read, Write
argument-hint: "<type:qto|schedule|material-takeoff|compliance|discrepancy> [element-type]"
---

# /report — Structured Construction Deliverables

Generate formatted construction documents from extracted data. For CLI command syntax, see `/cli-tools`.

## Deliverable Types

| Type | Description | Format |
|------|-------------|--------|
| `qto` | Quantity takeoff grouped by storey | CSV + Markdown |
| `schedule` | Element schedule (door, window) | CSV |
| `material-takeoff` | Materials with quantities | CSV |
| `compliance` | Compliance checklist (fire, accessibility, thermal) | Markdown |
| `discrepancy` | Cross-validation results | Markdown |

## Procedure

1. **Parse argument** — `/report qto doors`, `/report schedule windows`, `/report compliance fire`
2. **Read saved data** from `output/` (most recent `ifc_*.json` for requested type)
3. **Get aggregates** — run `quantities` command for totals. **NEVER do arithmetic.**
   ```bash
   python skills/cli-tools/scripts/ifc_extract.py <file.ifc> quantities <type> --group-by storey
   ```
4. **Format** per Australian conventions (see below)
5. **Save** timestamped output to `output/`

## Australian Construction Conventions

### Column ordering
- **Door schedule:** Mark, Level, Size (WxH mm), Type, Fire Rating, Hardware, Material, Finish
- **Window schedule:** Mark, Level, Size (WxH mm), Type, Glazing, U-Value (W/m2K), Operability
- **QTO table:** Element Type, Count, Total Area (m2), Total Volume (m3), Material, Level, Source

### Formatting rules
- Metric units: mm for dimensions, m2 for areas, m3 for volumes
- Australian terminology: "storey" not "story", "Level 1" not "Floor 1"
- FRL notation per AS 1530.4: structural adequacy / integrity / insulation (e.g., FRL -/60/30)
- Null values display as "-", never "null" or blank

## Compliance Checklists

### Fire (`/report compliance fire`)
- Doors in fire-rated walls without fire ratings (WARN)
- Fire rating IFC vs PDF mismatches (WARN)
- Elements with FireRating set (PASS)
- Reference: NCC Volume One, Section C

### Accessibility (`/report compliance accessibility`)
- Door widths min 850mm clear (AS 1428.1)
- Stair geometry — riser height, tread depth (NCC D2.13)
- Railing heights (NCC D2.16)

### Thermal (`/report compliance thermal`)
- Window U-Values present/absent
- Wall thermal transmittance values
- External element identification

## Error Handling
- No data → tell user to run `/ifc-extract <type>` first
- `quantities` fails → report error, don't fabricate numbers
- Wrong element type → list what data IS available in `output/`
