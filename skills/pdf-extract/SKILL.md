---
name: pdf-extract
description: Extract schedules, text, and tables from PDF construction drawings. Can search for specific terms to find relevant pages. Results saved to output/ for cross-validation.
allowed-tools: Bash, Read, Write
argument-hint: "[file.pdf] [command:text|tables|schedules|search] [options]"
---

# /pdf-extract — PDF Data Extraction

Extract data from PDF construction documents. For full CLI command syntax and flags, see `/cli-tools`.

## Step 1: Find the PDF file

If no file path provided:
```bash
ls data/*.pdf 2>/dev/null
```
Multiple files → ask user. No files → tell user to place PDF in `data/`.

## Step 2: Choose the right approach

- No specific command → start with `schedules` (auto-detects what's in the PDF)
- User asks about a topic → use `search` first to find pages, then `tables` on those pages
- User specifies pages → go directly to `tables` or `text`

## Step 3: Run the extraction

Scripts are at `skills/cli-tools/scripts/pdf_extract.py`. Always include `--save`.

```bash
python skills/cli-tools/scripts/pdf_extract.py <file.pdf> <command> [options] --save
```

Common patterns:
```bash
# What schedules are in this PDF?
schedules --save

# Find the door schedule
search "door schedule" --save
# then: tables --pages <matched_pages> --save

# Extract everything from a page
text --pages 5 --save
tables --pages 5 --save
```

## Step 4: Present results

- For `schedules`: list each type found, page, headers, row count
- For `search`: matching pages with snippets, suggest extraction commands
- For `tables`: describe each table — headers, rows, what it contains
- Suggest next steps: "Run `/cross-validate door` to compare against IFC model"

## Error handling
- Empty tables → fall back to `text` extraction
- No schedules found → try `search` with specific terms
- Corrupted PDF → report structured error to user
