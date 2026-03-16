---
name: ifc-extract
description: Extract data from IFC building models. Accepts element types (door, wall, window, slab, roof, etc.) and optional property filters. Translates natural language queries into CLI commands. Results saved to output/ for cross-validation.
allowed-tools: Bash, Read, Write, Grep
argument-hint: "[file.ifc] [element-type] [--property NAME] [--value VALUE]"
---

# /ifc-extract — IFC Data Extraction

Extract building element data from IFC models. For full CLI command syntax, flags, type shorthands, and natural language translation tables, see `/cli-tools`.

## Step 1: Find the IFC file

If no file path provided:
```bash
ls data/*.ifc 2>/dev/null
```
Multiple files → ask user. No files → tell user to place IFC file in `data/`.

## Step 2: Run the extraction

Scripts are at `skills/cli-tools/scripts/ifc_extract.py`. Always include `--save`.

```bash
python skills/cli-tools/scripts/ifc_extract.py <file.ifc> <command> [args] --save
```

Use `/cli-tools` to look up the correct command for the user's request. Common patterns:

| User says | Command |
|-----------|---------|
| "show me all doors" | `list door --save` |
| "fire-rated doors" | `query door --property Pset_DoorCommon.FireRating --not-null --save` |
| "external walls" | `query wall --property Pset_WallCommon.IsExternal --value true --save` |
| "how many windows per level" | `quantities window --group-by storey --save` |
| "what's in this model" | `summary --save` |
| "data quality check" | `validate --save` |

## Step 3: Present results

1. Summarize key findings in plain language ("Found 47 doors, 12 fire-rated, 35 without")
2. Show a formatted table for first 10-20 elements
3. Highlight notable items: missing properties, null fire ratings, proxy elements
4. **Never compute totals yourself** — use `quantities` command
5. Confirm save location

## Step 4: Offer follow-ups

- After `list door`: "Filter for fire-rated doors? Check quantities per level?"
- After `summary`: "Which element type to explore?"
- After any extraction: "Run `/pdf-extract` to find the matching PDF schedule?"

## Rules
- **LLMs never do arithmetic.** Use `quantities` for counts, areas, volumes.
- **Null properties are normal.** Export settings issue, not data error.
- **Always use `--save`** for downstream use by `/cross-validate` and `/report`.
