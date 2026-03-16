---
name: cross-validate
description: Compare IFC model data against PDF drawing schedules. Reads saved extraction data from output/, identifies count mismatches, missing properties, and conflicting values. Generates Markdown discrepancy report with PASS/WARN/INFO flags.
allowed-tools: Bash, Read, Write, Grep
argument-hint: "[element-type]"
---

# /cross-validate — IFC vs PDF Discrepancy Detection

Compare IFC model data against PDF schedules and generate a discrepancy report.

## Step 1: Locate saved data

Check `output/` for previously saved extraction files:
- IFC: `output/ifc_*.json` (prefer type-specific files)
- PDF: `output/pdf_schedules_*.json` (prefer over generic pdf_*.json)

Use the most recent file for each. If no data found, tell user to run `/ifc-extract` and `/pdf-extract` first.

## Step 2: Cross-validate ONE element type at a time

Avoid context overflow. If user didn't specify a type, pick the first type with data in both sources.

### Element matching
Normalise names: "D01" ↔ "Door 01" ↔ "D-01". Strip prefixes, separators, leading zeros. Case-insensitive.

### Three finding states

| State | Meaning | Example |
|-------|---------|---------|
| **MISMATCH** | IFC says X, PDF says Y | IFC: FRL-30, PDF: FRL-60 |
| **ABSENT** | IFC property null, PDF has value | IFC: FireRating null, PDF: FRL-60 |
| **PASS** | Both sources agree | IFC: 47 doors, PDF: 47 rows |

### Checks to perform
1. **Element count** — IFC count vs PDF schedule row count
2. **Properties** — fire ratings, materials, dimensions per matched element
3. **Fire rating wall/door compatibility** — door in fire-rated wall must have matching rating (if wall data available)
4. **Proxy elements** — flag IfcBuildingElementProxy as INFO

### ABSENT guidance
> Likely cause: IFC export settings — "Export IFC common property sets" may not be enabled.
> Action: Architect should re-export with common property sets enabled.

## Step 3: Generate report

Use this format:
```markdown
## Discrepancy Report — <Project Name> — <YYYY-MM-DD>

### WARN: <Title>
- IFC Model: <value>
- PDF <Schedule> (p.<page>): <value>
- Action: <recommendation>

### PASS: <Title>
- IFC Model: <value>
- PDF <Schedule> (p.<page>): <value>
```

Order: WARN (MISMATCH) → WARN (ABSENT) → INFO → PASS

End with summary: total checks, PASS count, WARN count, INFO count.

## Step 4: Save report

Save to `output/discrepancy_<YYYY-MM-DD_HHMMSS>.md`.

## Critical Rules

1. **NEVER do arithmetic.** Use `count` field or array length from JSON data.
2. **One element type at a time.**
3. **Use saved data only.** Don't run extraction yourself — tell user to run `/ifc-extract` and `/pdf-extract`.
4. **Distinguish MISMATCH from ABSENT.** Different root causes, different remediation.
5. **Every WARN must have an Action line.**
