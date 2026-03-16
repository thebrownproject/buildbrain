# Implementation Guide: pdf_extract.py

**Target file:** `src/cli/pdf_extract.py`
**Purpose:** CLI tool wrapping pdfplumber for PDF text/table extraction in the BuildBrain project.
**Spec reference:** `specs/spec.md` section 4.2

---

## 1. pdfplumber API Reference (Verified)

### 1.1 Opening a PDF

```python
import pdfplumber

# Context manager (preferred) -- auto-closes file stream
with pdfplumber.open("path/to/file.pdf") as pdf:
    # pdf is a pdfplumber.PDF instance
    pass

# With password
with pdfplumber.open("file.pdf", password="secret") as pdf:
    pass

# With repair for corrupted PDFs (requires Ghostscript installed)
with pdfplumber.open("file.pdf", repair=True) as pdf:
    pass
```

**Full signature of `pdfplumber.open()`:**
```python
pdfplumber.open(
    path_or_fp,                    # str, pathlib.Path, BufferedReader, or BytesIO
    pages=None,                    # Optional[List[int] | Tuple[int]] -- 0-indexed page filter
    laparams=None,                 # Optional[Dict] -- pdfminer layout analysis params
    password=None,                 # Optional[str]
    strict_metadata=False,         # bool -- raise on invalid metadata if True
    unicode_norm=None,             # Optional["NFC"|"NFKC"|"NFD"|"NFKD"]
    repair=False,                  # bool -- use Ghostscript to repair corrupted PDFs
    gs_path=None,                  # Optional[str|Path] -- path to Ghostscript binary
    repair_setting="default",      # repair configuration
    raise_unicode_errors=True,     # bool
) -> pdfplumber.PDF
```

**Return type:** `pdfplumber.PDF` instance.

### 1.2 PDF Object Properties

```python
pdf.metadata    # dict -- PDF Info trailer key/value pairs
pdf.pages       # list[pdfplumber.Page] -- lazily loaded
len(pdf.pages)  # int -- total page count
pdf.close()     # explicit close (not needed with context manager)
```

### 1.3 Page Text Extraction

```python
text = page.extract_text()  # Returns str or None (if no text found)

# With layout preservation (maintains spatial positioning)
text = page.extract_text(layout=True)

# Key parameters:
page.extract_text(
    x_tolerance=3,       # horizontal char spacing threshold (pts)
    y_tolerance=3,       # vertical char spacing threshold (pts)
    layout=False,        # preserve spatial layout
    x_density=7.25,      # min chars per point (layout mode)
    y_density=13,        # min newlines per point (layout mode)
)
```

**Return type:** `str` or `None` (when page has no extractable text).

### 1.4 Table Extraction

```python
# Extract ALL tables from a page -- returns list of tables
tables = page.extract_tables()
# Return type: list[list[list[str | None]]]
# Structure: [ table1, table2, ... ]
#   where each table = [ row1, row2, ... ]
#   where each row = [ cell1, cell2, ... ]
#   where each cell = str | None

# Extract the LARGEST table from a page
table = page.extract_table()
# Return type: list[list[str | None]] | None
# Structure: [ row1, row2, ... ] or None if no table found

# With custom table_settings:
tables = page.extract_tables(table_settings={
    "vertical_strategy": "lines",
    "horizontal_strategy": "lines",
    "snap_tolerance": 3,
})

# Find Table objects (with metadata like bbox) without extracting text:
table_objects = page.find_tables()
# Returns: list[pdfplumber.table.Table]
# Each Table has: .bbox, .cells, .rows, .extract()
```

### 1.5 Error Handling

pdfplumber does NOT define custom exception classes. Errors come from:

| Scenario | Exception | Source |
|----------|-----------|--------|
| File not found | `FileNotFoundError` | Python stdlib |
| Not a PDF / corrupted | `pdfminer.pdfparser.PDFSyntaxError` | pdfminer.six |
| Password-protected (wrong/missing pw) | `pdfminer.pdfdocument.PDFPasswordIncorrect` | pdfminer.six |
| Encrypted, cannot decrypt | `pdfminer.pdfdocument.PDFEncryptionError` | pdfminer.six |
| General pdfminer parse failure | `pdfminer.pdfpage.PDFTextExtractionNotAllowed` | pdfminer.six |
| Invalid metadata (strict mode) | `ValueError` | pdfplumber |

**Recommended catch pattern for the CLI:**
```python
import pdfplumber
from pdfminer.pdfparser import PDFSyntaxError

try:
    with pdfplumber.open(filepath) as pdf:
        # work with pdf
        pass
except FileNotFoundError:
    error_exit(f"File not found: {filepath}")
except PDFSyntaxError:
    error_exit(f"Invalid or corrupted PDF: {filepath}")
except Exception as e:
    error_exit(f"Failed to open PDF: {e}")
```

---

## 2. Table Detection Deep Dive

### 2.1 How pdfplumber Detects Tables

Five-step algorithm:

1. **Find lines** -- from explicit definitions and/or implied by word alignment
2. **Merge overlapping lines** -- using snap_tolerance
3. **Find intersections** -- where vertical meets horizontal lines
4. **Build cells** -- most granular rectangles from intersection vertices
5. **Group cells into tables** -- contiguous cells sharing corners become one table

### 2.2 Complete table_settings Defaults

```python
DEFAULT_TABLE_SETTINGS = {
    "vertical_strategy": "lines",           # "lines", "lines_strict", "text", "explicit"
    "horizontal_strategy": "lines",         # "lines", "lines_strict", "text", "explicit"
    "explicit_vertical_lines": [],          # list of x-coordinates
    "explicit_horizontal_lines": [],        # list of y-coordinates
    "snap_tolerance": 3,                    # pts -- merge nearby parallel lines
    "snap_x_tolerance": 3,
    "snap_y_tolerance": 3,
    "join_tolerance": 3,                    # pts -- join collinear line segments
    "join_x_tolerance": 3,
    "join_y_tolerance": 3,
    "edge_min_length": 3,                   # pts -- discard shorter edges
    "edge_min_length_prefilter": 1,         # pts -- prefilter before snapping
    "min_words_vertical": 3,                # text strategy: min aligned words
    "min_words_horizontal": 1,              # text strategy: min aligned words
    "intersection_tolerance": 3,            # pts -- intersection detection threshold
    "intersection_x_tolerance": 3,
    "intersection_y_tolerance": 3,
    "text_tolerance": 3,                    # pts -- text positioning tolerance
    "text_x_tolerance": 3,
    "text_y_tolerance": 3,
}
```

### 2.3 Strategy Options Explained

| Strategy | Description | When to Use |
|----------|-------------|-------------|
| `"lines"` | Uses graphical lines AND rectangle sides as cell borders | Default -- best for most construction schedule tables with visible gridlines |
| `"lines_strict"` | Uses graphical lines only, NOT rectangle sides | When rectangle decorations cause false table detection |
| `"text"` | Infers cell boundaries from text alignment | For tables without visible gridlines (text-only schedules) |
| `"explicit"` | Only uses coordinates in explicit_vertical/horizontal_lines | When auto-detection fails completely |

### 2.4 Recommended Settings for Construction Schedule Tables

Construction schedules typically have clear gridlines. Use these settings:

```python
# Settings optimized for construction schedule PDFs
SCHEDULE_TABLE_SETTINGS = {
    "vertical_strategy": "lines",
    "horizontal_strategy": "lines",
    "snap_tolerance": 4,          # slightly higher -- handles thin/slightly offset lines
    "join_tolerance": 4,          # merge broken line segments
    "edge_min_length": 10,        # filter out tiny decorative lines
    "intersection_tolerance": 5,  # more forgiving intersection detection
}
```

**Fallback for tables without visible lines (text-only schedules):**
```python
TEXT_ONLY_TABLE_SETTINGS = {
    "vertical_strategy": "text",
    "horizontal_strategy": "text",
    "min_words_vertical": 2,      # lower threshold for narrow columns
    "min_words_horizontal": 1,
    "snap_tolerance": 5,
}
```

**Implementation strategy:** Try `"lines"` first. If no tables found, retry with `"text"` strategy. This two-pass approach handles both gridded and non-gridded schedules.

---

## 3. Schedule Auto-Detection Algorithm

### 3.1 Schedule Type Definitions

Define schedule types with their identifying header patterns:

```python
SCHEDULE_PATTERNS = {
    "door_schedule": {
        # Primary headers (at least 2 must match to identify)
        "primary": ["mark", "door no", "door number", "door ref"],
        # Secondary headers (boost confidence)
        "secondary": [
            "size", "width", "height",
            "type", "door type",
            "fire rating", "fire", "frl", "fire resistance",
            "hardware", "ironmongery", "hardware set",
            "material", "construction",
            "finish",
            "frame", "frame type",
            "leaf", "no. of leaves",
            "threshold",
            "glazing", "vision panel",
            "acoustic", "acoustic rating", "rw",
            "lock", "lockset",
            "closer",
            "smoke seal",
            "undercut",
        ],
        # Title patterns (searched in page text, not just headers)
        "title_patterns": [
            r"door\s+schedule",
            r"door\s+and\s+frame\s+schedule",
            r"internal\s+door\s+schedule",
            r"external\s+door\s+schedule",
        ],
    },
    "window_schedule": {
        "primary": ["mark", "window no", "window number", "window ref", "window id"],
        "secondary": [
            "size", "width", "height",
            "type", "window type",
            "glazing", "glass", "glass type",
            "u-value", "u value", "thermal",
            "operability", "operation", "opening type",
            "frame", "frame material", "frame type",
            "sill", "sill height",
            "head height",
            "acoustic", "acoustic rating", "rw",
            "bushfire", "bal", "bal rating",
            "flyscreen", "fly screen",
            "security", "security screen",
        ],
        "title_patterns": [
            r"window\s+schedule",
            r"glazing\s+schedule",
        ],
    },
    "finish_schedule": {
        "primary": ["room", "room no", "room name", "space", "area"],
        "secondary": [
            "floor", "floor finish",
            "wall", "wall finish",
            "ceiling", "ceiling finish",
            "skirting", "skirting board",
            "cornice",
            "dado",
            "wet area",
            "paint", "paint colour", "paint color",
        ],
        "title_patterns": [
            r"finish\s+schedule",
            r"finishes\s+schedule",
            r"room\s+finish",
            r"internal\s+finish",
        ],
    },
}
```

### 3.2 Header Fuzzy Matching Algorithm

```python
import re

def normalize_header(header: str) -> str:
    """Normalize a header string for fuzzy comparison."""
    if header is None:
        return ""
    h = header.strip().lower()
    # Remove common punctuation and extra whitespace
    h = re.sub(r'[.\-_/\\()#*:]', ' ', h)
    h = re.sub(r'\s+', ' ', h).strip()
    # Common abbreviations
    abbreviations = {
        "no": "number",
        "no.": "number",
        "num": "number",
        "ref": "reference",
        "desc": "description",
        "dim": "dimension",
        "dims": "dimensions",
        "ht": "height",
        "wt": "width",
        "thk": "thickness",
        "mat": "material",
        "fin": "finish",
        "hw": "hardware",
        "qty": "quantity",
    }
    # Don't expand -- keep both original and expanded for matching
    return h

def header_matches(actual_header: str, pattern: str) -> bool:
    """Check if an actual header matches a pattern (fuzzy)."""
    norm = normalize_header(actual_header)
    pattern_norm = pattern.lower().strip()
    # Exact match
    if norm == pattern_norm:
        return True
    # Contains match (pattern is substring of header or vice versa)
    if pattern_norm in norm or norm in pattern_norm:
        return True
    # Handle abbreviations: "no" matches "number", "no." matches "number"
    # Check if the normalized header starts with the pattern
    if norm.startswith(pattern_norm):
        return True
    return False
```

### 3.3 Schedule Classification Algorithm

```python
def classify_table(headers: list[str], page_text: str) -> tuple[str | None, float]:
    """
    Classify a table as a specific schedule type.

    Returns: (schedule_type, confidence)
        schedule_type: "door_schedule", "window_schedule", etc. or None
        confidence: 0.0 to 1.0
    """
    best_type = None
    best_score = 0.0

    for sched_type, patterns in SCHEDULE_PATTERNS.items():
        score = 0.0

        # Check primary headers (high weight)
        primary_matches = sum(
            1 for p in patterns["primary"]
            if any(header_matches(h, p) for h in headers)
        )
        if primary_matches == 0:
            # Also check title patterns in page text as fallback
            title_match = any(
                re.search(tp, page_text, re.IGNORECASE)
                for tp in patterns["title_patterns"]
            )
            if not title_match:
                continue  # Skip -- no primary header AND no title match
            score += 0.3  # Title match gives partial credit

        score += primary_matches * 0.3  # Each primary match = 0.3

        # Check secondary headers (lower weight)
        secondary_matches = sum(
            1 for p in patterns["secondary"]
            if any(header_matches(h, p) for h in headers)
        )
        score += secondary_matches * 0.1  # Each secondary match = 0.1

        # Cap at 1.0
        score = min(score, 1.0)

        # Minimum threshold: at least 1 primary + 1 secondary, OR title + 2 secondary
        if score > 0.35 and score > best_score:
            best_score = score
            best_type = sched_type

    return best_type, best_score
```

### 3.4 Full `schedules` Command Flow

```
1. Open PDF
2. For each page:
   a. Extract page text (for title pattern matching)
   b. Extract tables from page (try "lines" strategy first)
   c. If no tables found, retry with "text" strategy
   d. For each table found:
      i.   First row = candidate headers
      ii.  Run classify_table(headers, page_text)
      iii. If classified with confidence > 0.35, record it
3. Deduplicate (same schedule spanning multiple pages)
4. Return structured JSON with schedule metadata + row data
```

---

## 4. Page Range Parser

### 4.1 Design

The `--pages` flag accepts: `"1-5"`, `"12"`, `"1,3,5-8"`, `"1-3,7,10-12"`

**Important:** User-facing pages are 1-indexed. pdfplumber pages list is 0-indexed. The parser must convert.

```python
def parse_page_ranges(page_spec: str, total_pages: int) -> list[int]:
    """
    Parse a page range specification into a sorted list of 0-indexed page numbers.

    Args:
        page_spec: e.g., "1-5", "12", "1,3,5-8"
        total_pages: total number of pages in the PDF (for validation)

    Returns:
        Sorted list of 0-indexed page numbers.

    Raises:
        ValueError: on invalid format or out-of-range pages.
    """
    pages = set()
    parts = page_spec.split(",")

    for part in parts:
        part = part.strip()
        if not part:
            continue

        if "-" in part:
            bounds = part.split("-", 1)
            if len(bounds) != 2 or not bounds[0].strip() or not bounds[1].strip():
                raise ValueError(f"Invalid page range: '{part}'")
            try:
                start = int(bounds[0].strip())
                end = int(bounds[1].strip())
            except ValueError:
                raise ValueError(f"Non-numeric page range: '{part}'")

            if start < 1 or end < 1:
                raise ValueError(f"Page numbers must be >= 1, got: '{part}'")
            if start > end:
                raise ValueError(f"Invalid range (start > end): '{part}'")
            if end > total_pages:
                raise ValueError(
                    f"Page {end} out of range (PDF has {total_pages} pages)"
                )

            for p in range(start, end + 1):
                pages.add(p - 1)  # Convert to 0-indexed
        else:
            try:
                page_num = int(part)
            except ValueError:
                raise ValueError(f"Non-numeric page number: '{part}'")

            if page_num < 1:
                raise ValueError(f"Page numbers must be >= 1, got: {page_num}")
            if page_num > total_pages:
                raise ValueError(
                    f"Page {page_num} out of range (PDF has {total_pages} pages)"
                )

            pages.add(page_num - 1)  # Convert to 0-indexed

    if not pages:
        raise ValueError(f"No valid pages in specification: '{page_spec}'")

    return sorted(pages)
```

---

## 5. Search Implementation

### 5.1 Design for `search` Command

Search must be efficient across potentially 50+ page PDFs. Strategy: extract text page-by-page, search with case-insensitive substring matching, extract context snippets.

```python
def search_pdf(pdf, query: str) -> list[dict]:
    """
    Search all pages for a query string.

    Returns list of match dicts:
    [
        {
            "page": 12,          # 1-indexed for user display
            "snippet": "...",    # the matched line
            "context": "...",    # surrounding lines for context
        }
    ]
    """
    matches = []
    query_lower = query.lower()

    for i, page in enumerate(pdf.pages):
        text = page.extract_text()
        if text is None:
            continue

        if query_lower in text.lower():
            # Find all matching lines and extract context
            lines = text.split("\n")
            for line_idx, line in enumerate(lines):
                if query_lower in line.lower():
                    # Extract context: 1 line before and 1 line after
                    context_start = max(0, line_idx - 1)
                    context_end = min(len(lines), line_idx + 2)
                    context_lines = lines[context_start:context_end]

                    matches.append({
                        "page": i + 1,  # 1-indexed
                        "snippet": line.strip(),
                        "context": "\n".join(l.strip() for l in context_lines),
                    })

    return matches
```

### 5.2 Deduplication

Multiple lines on the same page may match. The search function should return ALL matches (one per matching line), not just one per page. The caller (Claude) can decide how to present them. However, to keep output manageable, cap to the first 3 matches per page:

```python
# After building matches list, deduplicate per page:
def deduplicate_matches(matches: list[dict], max_per_page: int = 3) -> list[dict]:
    """Keep at most max_per_page matches per page number."""
    from collections import defaultdict
    page_counts = defaultdict(int)
    result = []
    for m in matches:
        if page_counts[m["page"]] < max_per_page:
            result.append(m)
            page_counts[m["page"]] += 1
    return result
```

---

## 6. Argparse Structure

### 6.1 Subcommand Design

```python
import argparse
import sys

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="pdf_extract",
        description="Extract text, tables, and schedules from PDF documents.",
    )

    # Positional: PDF file path
    parser.add_argument(
        "pdf_file",
        help="Path to the PDF file",
    )

    # Subcommands
    subparsers = parser.add_subparsers(dest="command", required=True)

    # --- text ---
    text_parser = subparsers.add_parser(
        "text",
        help="Extract text from PDF pages",
    )
    text_parser.add_argument(
        "--pages",
        type=str,
        default=None,
        help='Page range to extract (e.g., "1-5", "12", "1,3,5-8"). Default: all pages.',
    )
    text_parser.add_argument(
        "--save",
        action="store_true",
        help="Save output to output/pdf_text_<timestamp>.json",
    )

    # --- tables ---
    tables_parser = subparsers.add_parser(
        "tables",
        help="Extract tables from PDF pages",
    )
    tables_parser.add_argument(
        "--pages",
        type=str,
        default=None,
        help='Page range to extract (e.g., "1-5", "12", "1,3,5-8"). Default: all pages.',
    )
    tables_parser.add_argument(
        "--save",
        action="store_true",
        help="Save output to output/pdf_tables_<timestamp>.json",
    )

    # --- search ---
    search_parser = subparsers.add_parser(
        "search",
        help="Search for a keyword across all PDF pages",
    )
    search_parser.add_argument(
        "query",
        type=str,
        help="Search term or phrase",
    )
    search_parser.add_argument(
        "--save",
        action="store_true",
        help="Save output to output/pdf_search_<timestamp>.json",
    )

    # --- schedules ---
    schedules_parser = subparsers.add_parser(
        "schedules",
        help="Auto-detect schedule tables (door, window, finish schedules)",
    )
    schedules_parser.add_argument(
        "--save",
        action="store_true",
        help="Save output to output/pdf_schedules_<timestamp>.json",
    )

    return parser
```

### 6.2 Argument Parsing in main()

```python
def main():
    parser = build_parser()
    args = parser.parse_args()

    # Validate PDF file exists before opening
    pdf_path = args.pdf_file
    if not os.path.isfile(pdf_path):
        output_error(f"File not found: {pdf_path}")
        sys.exit(1)

    # Dispatch to command handler
    try:
        if args.command == "text":
            result = cmd_text(pdf_path, pages=args.pages)
        elif args.command == "tables":
            result = cmd_tables(pdf_path, pages=args.pages)
        elif args.command == "search":
            result = cmd_search(pdf_path, query=args.query)
        elif args.command == "schedules":
            result = cmd_schedules(pdf_path)
        else:
            parser.print_help()
            sys.exit(2)
    except ValueError as e:
        # Page range validation errors, etc.
        output_error(str(e))
        sys.exit(2)
    except Exception as e:
        output_error(f"Unexpected error: {e}")
        sys.exit(1)

    # Handle --save flag
    if hasattr(args, 'save') and args.save:
        save_output(result, args.command)

    # Print JSON to stdout
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()
```

---

## 7. Code Structure

### 7.1 File Layout

All code goes in a single file: `src/cli/pdf_extract.py`. No package structure needed for PoC.

### 7.2 Function/Section Organization

```python
#!/usr/bin/env python3
"""
pdf_extract.py -- CLI tool for extracting text, tables, and schedules from PDF documents.
Part of the BuildBrain project.

Usage:
    python pdf_extract.py <file.pdf> text [--pages 1-5] [--save]
    python pdf_extract.py <file.pdf> tables [--pages 12-15] [--save]
    python pdf_extract.py <file.pdf> search "keyword" [--save]
    python pdf_extract.py <file.pdf> schedules [--save]
"""

# ============================================================
# Imports
# ============================================================
import argparse
import json
import os
import re
import sys
from datetime import datetime

import pdfplumber
from pdfminer.pdfparser import PDFSyntaxError


# ============================================================
# Constants
# ============================================================

SCHEDULE_TABLE_SETTINGS = { ... }      # Optimized table_settings for gridded schedules
TEXT_ONLY_TABLE_SETTINGS = { ... }     # Fallback for non-gridded schedules
SCHEDULE_PATTERNS = { ... }           # Header patterns per schedule type (section 3.1)
MAX_MATCHES_PER_PAGE = 3              # Search result cap per page


# ============================================================
# Utility Functions
# ============================================================

def output_error(message: str) -> None:
    """Print a structured JSON error to stdout and nothing else."""
    # Spec section 7.1: CLI tools return structured error JSON, never raw tracebacks
    error = {
        "error": True,
        "message": message,
    }
    print(json.dumps(error, indent=2))

def save_output(result: dict, command: str) -> None:
    """Save result JSON to output/ directory with timestamped filename."""
    # Spec section 6: filename pattern is <source>_<command>_<YYYY-MM-DD_HHMMSS>.json
    os.makedirs("output", exist_ok=True)
    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    filename = f"pdf_{command}_{timestamp}.json"
    filepath = os.path.join("output", filename)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    # Add save path to result so caller knows where it went
    result["_saved_to"] = filepath

def parse_page_ranges(page_spec: str, total_pages: int) -> list:
    """Parse page range string into sorted list of 0-indexed page numbers.
    See section 4 of this guide for full implementation."""
    ...

def open_pdf(filepath: str):
    """Open a PDF file with error handling. Returns pdfplumber.PDF.
    Wraps pdfplumber.open() with structured error output on failure."""
    ...

def get_pages(pdf, page_spec: str | None) -> list:
    """Get the list of page objects to process, respecting --pages flag.
    If page_spec is None, returns all pages.
    If page_spec is provided, parses it and returns matching pages."""
    ...


# ============================================================
# Header Matching & Schedule Classification
# ============================================================

def normalize_header(header: str) -> str:
    """Normalize a table header for fuzzy comparison."""
    ...

def header_matches(actual_header: str, pattern: str) -> bool:
    """Check if an extracted header fuzzy-matches a known pattern."""
    ...

def classify_table(headers: list, page_text: str) -> tuple:
    """Classify a table as a schedule type. Returns (type_str, confidence)."""
    ...


# ============================================================
# Table Extraction Helpers
# ============================================================

def extract_tables_from_page(page) -> list:
    """Extract tables from a page using two-pass strategy.

    Pass 1: Try "lines" strategy (for gridded tables).
    Pass 2: If no tables found, try "text" strategy (for text-only tables).

    Returns list of dicts, each with "headers" and "rows" keys.
    """
    ...

def table_to_dict(raw_table: list) -> dict | None:
    """Convert a raw pdfplumber table (list of lists) to a dict with headers and rows.

    The first row is treated as headers. Returns None if the table has
    fewer than 2 rows (header-only or empty).

    Returns:
        {
            "headers": ["Mark", "Size", "Type", ...],
            "rows": [
                ["D01", "900x2100", "Single Swing", ...],
                ...
            ]
        }
    """
    ...


# ============================================================
# Command Handlers
# ============================================================

def cmd_text(pdf_path: str, pages: str | None = None) -> dict:
    """Handle the 'text' command.

    Output format (from spec section 4.2):
    {
        "file": "drawings.pdf",
        "total_pages": 42,
        "results": [
            {
                "page": 12,
                "text": "DOOR SCHEDULE..."
            }
        ]
    }
    """
    ...

def cmd_tables(pdf_path: str, pages: str | None = None) -> dict:
    """Handle the 'tables' command.

    Output format (from spec section 4.2):
    {
        "file": "drawings.pdf",
        "total_pages": 42,
        "results": [
            {
                "page": 12,
                "tables": [
                    {
                        "headers": ["Mark", "Size", ...],
                        "rows": [["D01", "900x2100", ...], ...]
                    }
                ]
            }
        ]
    }

    NOTE: Only include pages that have at least one table in results.
    Include "text" field alongside "tables" for each page (per spec output format).
    """
    ...

def cmd_search(pdf_path: str, query: str) -> dict:
    """Handle the 'search' command.

    Output format (from spec section 4.2):
    {
        "file": "drawings.pdf",
        "query": "door schedule",
        "matches": [
            {"page": 12, "snippet": "DOOR SCHEDULE - Level 1", "context": "..."}
        ]
    }
    """
    ...

def cmd_schedules(pdf_path: str) -> dict:
    """Handle the 'schedules' command.

    Output format (from spec section 4.2):
    {
        "file": "drawings.pdf",
        "schedules_found": [
            {
                "type": "door_schedule",
                "page": 12,
                "headers": ["Mark", "Size", "Type", "Fire Rating", "Hardware"],
                "row_count": 24,
                "rows": [["D01", "900x2100", "Single Swing", "-", "Lever Set"], ...]
            }
        ]
    }

    NOTE: The spec output shows only metadata (type, page, headers, row_count).
    Include the actual "rows" data as well since downstream consumers
    (cross-validate, report) need it. This is important -- without rows,
    the schedules command is only a discovery tool and /pdf-extract would
    need to re-extract with the tables command.
    """
    ...


# ============================================================
# Argparse & Main
# ============================================================

def build_parser() -> argparse.ArgumentParser:
    """Build the CLI argument parser with subcommands."""
    ...

def main():
    """Entry point."""
    ...

if __name__ == "__main__":
    main()
```

---

## 8. Implementation Details for Each Command

### 8.1 `text` Command

```python
def cmd_text(pdf_path: str, pages: str | None = None) -> dict:
    with pdfplumber.open(pdf_path) as pdf:
        total_pages = len(pdf.pages)

        if pages:
            page_indices = parse_page_ranges(pages, total_pages)
        else:
            page_indices = list(range(total_pages))

        results = []
        for idx in page_indices:
            page = pdf.pages[idx]
            text = page.extract_text()
            if text:  # Skip pages with no text
                results.append({
                    "page": idx + 1,  # 1-indexed for display
                    "text": text,
                })

        return {
            "file": os.path.basename(pdf_path),
            "total_pages": total_pages,
            "pages_extracted": len(results),
            "results": results,
        }
```

### 8.2 `tables` Command

```python
def cmd_tables(pdf_path: str, pages: str | None = None) -> dict:
    with pdfplumber.open(pdf_path) as pdf:
        total_pages = len(pdf.pages)

        if pages:
            page_indices = parse_page_ranges(pages, total_pages)
        else:
            page_indices = list(range(total_pages))

        results = []
        for idx in page_indices:
            page = pdf.pages[idx]
            tables = extract_tables_from_page(page)
            text = page.extract_text()

            if tables:  # Only include pages with tables
                results.append({
                    "page": idx + 1,
                    "text": text or "",
                    "tables": tables,
                })

        return {
            "file": os.path.basename(pdf_path),
            "total_pages": total_pages,
            "results": results,
        }
```

### 8.3 `search` Command

```python
def cmd_search(pdf_path: str, query: str) -> dict:
    with pdfplumber.open(pdf_path) as pdf:
        matches = search_pdf(pdf, query)
        matches = deduplicate_matches(matches, max_per_page=MAX_MATCHES_PER_PAGE)

        return {
            "file": os.path.basename(pdf_path),
            "query": query,
            "match_count": len(matches),
            "matches": matches,
        }
```

### 8.4 `schedules` Command

```python
def cmd_schedules(pdf_path: str) -> dict:
    with pdfplumber.open(pdf_path) as pdf:
        schedules_found = []

        for idx, page in enumerate(pdf.pages):
            page_text = page.extract_text() or ""
            tables = extract_tables_from_page(page)

            for table in tables:
                headers = table["headers"]
                rows = table["rows"]

                sched_type, confidence = classify_table(headers, page_text)
                if sched_type is not None:
                    schedules_found.append({
                        "type": sched_type,
                        "page": idx + 1,
                        "confidence": round(confidence, 2),
                        "headers": headers,
                        "row_count": len(rows),
                        "rows": rows,
                    })

        # Deduplicate: if same schedule type appears on consecutive pages,
        # it's likely a continuation. Merge rows.
        schedules_found = merge_continuation_schedules(schedules_found)

        return {
            "file": os.path.basename(pdf_path),
            "schedules_found": schedules_found,
        }
```

### 8.5 Schedule Continuation Merging

Construction schedules often span multiple pages. Detect and merge these:

```python
def merge_continuation_schedules(schedules: list) -> list:
    """Merge schedule tables that span consecutive pages.

    Two tables are considered continuations if:
    1. They have the same schedule type
    2. They are on consecutive pages (page N and page N+1)
    3. They have the same headers (or the continuation has no header row)

    When merged:
    - Keep the first table's metadata (page, headers)
    - Concatenate rows
    - Update row_count
    - Record page_range instead of single page
    """
    if not schedules:
        return []

    merged = [schedules[0].copy()]
    merged[0]["pages"] = [merged[0]["page"]]

    for sched in schedules[1:]:
        prev = merged[-1]
        # Check if continuation
        if (sched["type"] == prev["type"]
                and sched["page"] == prev["pages"][-1] + 1
                and sched["headers"] == prev["headers"]):
            # Merge: append rows
            prev["rows"].extend(sched["rows"])
            prev["row_count"] = len(prev["rows"])
            prev["pages"].append(sched["page"])
        else:
            entry = sched.copy()
            entry["pages"] = [entry["page"]]
            merged.append(entry)

    return merged
```

---

## 9. table_to_dict Helper

This is a critical function -- converts raw pdfplumber output to the spec format:

```python
def table_to_dict(raw_table: list) -> dict | None:
    """Convert raw pdfplumber table to structured dict.

    pdfplumber returns: list[list[str | None]]
    where first row is headers.

    We need:
    {
        "headers": ["Mark", "Size", ...],
        "rows": [["D01", "900x2100", ...], ...]
    }
    """
    if not raw_table or len(raw_table) < 2:
        return None  # Need at least header + 1 data row

    # First row = headers
    headers = [
        (cell.strip() if cell else "")
        for cell in raw_table[0]
    ]

    # Skip if headers are all empty (not a real table)
    if not any(headers):
        return None

    # Remaining rows = data
    rows = []
    for row in raw_table[1:]:
        cleaned_row = [
            (cell.strip() if cell else "")
            for cell in row
        ]
        # Skip completely empty rows
        if any(cleaned_row):
            rows.append(cleaned_row)

    if not rows:
        return None

    return {
        "headers": headers,
        "rows": rows,
    }
```

---

## 10. Two-Pass Table Extraction

```python
def extract_tables_from_page(page) -> list:
    """Extract tables with two-pass strategy.

    Pass 1: "lines" strategy -- for tables with visible gridlines.
    Pass 2: "text" strategy -- fallback for text-only tables.
    """
    # Pass 1: lines strategy
    raw_tables = page.extract_tables(table_settings=SCHEDULE_TABLE_SETTINGS)

    tables = []
    if raw_tables:
        for raw in raw_tables:
            converted = table_to_dict(raw)
            if converted:
                tables.append(converted)

    # Pass 2: if no tables found, try text strategy
    if not tables:
        raw_tables = page.extract_tables(table_settings=TEXT_ONLY_TABLE_SETTINGS)
        if raw_tables:
            for raw in raw_tables:
                converted = table_to_dict(raw)
                if converted:
                    tables.append(converted)

    return tables
```

---

## 11. Exit Codes (from spec section 13.4)

| Code | Meaning | When |
|------|---------|------|
| 0 | Success | Normal operation, including partial results with warnings |
| 1 | Full failure | File not found, parse error, no results at all |
| 2 | Invalid arguments | Bad --pages format, missing required args |

Implementation in main():
```python
def main():
    parser = build_parser()
    args = parser.parse_args()

    pdf_path = args.pdf_file
    if not os.path.isfile(pdf_path):
        output_error(f"File not found: {pdf_path}")
        sys.exit(1)

    try:
        if args.command == "text":
            result = cmd_text(pdf_path, pages=args.pages)
        elif args.command == "tables":
            result = cmd_tables(pdf_path, pages=args.pages)
        elif args.command == "search":
            result = cmd_search(pdf_path, query=args.query)
        elif args.command == "schedules":
            result = cmd_schedules(pdf_path)
        else:
            parser.print_help()
            sys.exit(2)
    except ValueError as e:
        output_error(str(e))
        sys.exit(2)
    except PDFSyntaxError:
        output_error(f"Invalid or corrupted PDF file: {pdf_path}")
        sys.exit(1)
    except Exception as e:
        output_error(f"Failed to process PDF: {e}")
        sys.exit(1)

    # Save if requested
    if hasattr(args, "save") and args.save:
        save_output(result, args.command)

    # Output JSON to stdout
    print(json.dumps(result, indent=2))
    sys.exit(0)
```

---

## 12. Edge Cases and Defensive Coding

### 12.1 None Handling

pdfplumber returns `None` in many places:
- `page.extract_text()` returns `None` for pages with no text (image-only pages)
- Table cells can be `None` (empty cells, merged cells)
- `page.extract_table()` returns `None` if no table found

**Rule:** Always guard against `None` with `or ""` or explicit `if x is not None` checks.

### 12.2 Large PDFs

Construction drawing sets can be 50+ pages. When `--pages` is not specified:
- `text` command: extract all pages (could be large output)
- `tables` command: only return pages that HAVE tables (skip empty pages)
- `search` command: search all pages but return only matches
- `schedules` command: process all pages

No artificial limits. Claude can use `--pages` to narrow down if the output is too large.

### 12.3 Empty Results

When no results are found, return a valid JSON structure with empty arrays, not an error:
```json
{
    "file": "drawings.pdf",
    "total_pages": 42,
    "results": []
}
```

Only use error exit (code 1) for actual failures (file not found, parse error).

### 12.4 Merged Cells in Tables

pdfplumber handles merged cells by returning `None` for spanned cells or duplicating content. The `table_to_dict` function should handle this gracefully by converting `None` to empty string.

### 12.5 Multiline Cell Content

Table cells may contain newlines (e.g., "900\nx\n2100"). The `table_to_dict` function should preserve this as-is -- downstream consumers (Claude) can interpret it.

---

## 13. Complete Import List

```python
#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys
from datetime import datetime

import pdfplumber
from pdfminer.pdfparser import PDFSyntaxError
```

No other imports needed. `pdfminer` is a dependency of `pdfplumber` and is always available when pdfplumber is installed.

---

## 14. Testing Strategy

The builder should manually test with:

1. **A simple PDF with a visible table** -- verify `tables` command extracts it
2. **A PDF with a door schedule** -- verify `schedules` command auto-detects it
3. **A multi-page PDF** -- verify `--pages` flag and `search` command
4. **An image-only PDF** -- verify graceful handling (empty results, not crash)
5. **A non-existent file path** -- verify structured error JSON, exit code 1
6. **Invalid page range** -- verify error message, exit code 2

Test command examples:
```bash
python src/cli/pdf_extract.py data/test.pdf text
python src/cli/pdf_extract.py data/test.pdf text --pages 1-3
python src/cli/pdf_extract.py data/test.pdf tables --pages 12
python src/cli/pdf_extract.py data/test.pdf search "door schedule"
python src/cli/pdf_extract.py data/test.pdf schedules
python src/cli/pdf_extract.py data/test.pdf schedules --save
python src/cli/pdf_extract.py nonexistent.pdf text  # should error gracefully
python src/cli/pdf_extract.py data/test.pdf text --pages 999  # should error gracefully
```

---

## 15. Summary Checklist for Builder

- [ ] Create `src/cli/pdf_extract.py` as a standalone script
- [ ] Implement argparse with 4 subcommands: `text`, `tables`, `search`, `schedules`
- [ ] `text`: Extract text per page, respect `--pages`, output spec-compliant JSON
- [ ] `tables`: Two-pass extraction (lines then text strategy), respect `--pages`
- [ ] `search`: Case-insensitive search across all pages, context snippets, dedup
- [ ] `tables` + `text`: Include both text and tables in output per the spec format
- [ ] `schedules`: Auto-detect schedule type from headers using SCHEDULE_PATTERNS
- [ ] `schedules`: Merge continuation tables across consecutive pages
- [ ] `schedules`: Include actual row data (not just metadata) for downstream use
- [ ] `--save` flag: Write to `output/pdf_<command>_<timestamp>.json`
- [ ] Structured JSON error output (never raw tracebacks)
- [ ] Exit codes: 0 success, 1 failure, 2 invalid args
- [ ] Handle None from extract_text() and table cells
- [ ] Guard against corrupted PDFs with PDFSyntaxError catch
- [ ] Page numbers: 1-indexed in output, 0-indexed internally
- [ ] All output to stdout as JSON (errors too)
