---
name: scan
description: Scan IFC and PDF files to create a project inventory. Shows element counts, schedule locations, and data quality issues. Use when starting work on a new project or wanting an overview.
allowed-tools: Bash, Read, Write
argument-hint: "[ifc-file] [pdf-file]"
---

# /scan — Project Onboarding

First thing to run on a new project. Scans the IFC model and PDF drawings, presents a combined inventory.

For CLI command syntax, see `/cli-tools`.

## Step 1: Locate files

If no file paths given, list `data/` to find `.ifc` and `.pdf` files:
```bash
ls data/*.ifc data/*.pdf 2>/dev/null
```
- Multiple files of same type → ask user which one
- One of each → use automatically, tell user which files selected
- None found → tell user to place files in `data/`

## Step 2: Run IFC summary
```bash
python skills/cli-tools/scripts/ifc_extract.py <ifc-file> summary
```

## Step 3: Run PDF schedule detection
```bash
python skills/cli-tools/scripts/pdf_extract.py <pdf-file> schedules
```

## Step 4: Run IFC validation
```bash
python skills/cli-tools/scripts/ifc_extract.py <ifc-file> validate
```

## Step 5: Present combined inventory

Format as:
```
## Project Inventory

**Model:** <project_name> (<schema>)
**File:** <filename> (<file_size_mb> MB)

### Elements Found
| Type | Count |
|------|-------|
| Walls | 142 |
| Doors | 47 |
| ... | ... |

### Storeys
- Ground Floor
- Level 1
- ...

### PDF Schedules Detected
- Door schedule on p.12 (24 rows)
- Window schedule on p.14 (18 rows)

### Data Quality Warnings
- WARN: Pset_DoorCommon not found on 23 of 47 IfcDoor elements
- WARN: 3 IfcBuildingElementProxy elements found
```

Highlight warnings clearly:
- **Missing psets** — usually a Revit export settings issue
- **Proxy elements** — often misclassified real elements
- **Orphaned elements** — no storey assignment

## Step 6: Save results

Save combined data to `output/scan_summary.json`:
```bash
mkdir -p output
```
Write JSON with `scan_date`, `ifc_file`, `pdf_file`, `ifc_summary`, `pdf_schedules`, `ifc_validation`.

## Step 7: Suggest next steps

Tailor to actual findings:
- "47 doors found — run `/ifc-extract door` to see details"
- "Door schedule on p.12 — run `/pdf-extract` to extract it"
- "Both IFC doors and PDF schedule available — run `/cross-validate door`"
- "3 proxy elements — run `/ifc-extract IfcBuildingElementProxy` to inspect"

## Rules
- Never do arithmetic. All counts come from CLI output.
- Run all three commands even if one fails.
- All file paths must be full relative or absolute paths.
