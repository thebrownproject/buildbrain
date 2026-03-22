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
from collections import defaultdict
from datetime import datetime

import pdfplumber
from pdfminer.pdfparser import PDFSyntaxError


# ============================================================
# Constants
# ============================================================

SCHEDULE_TABLE_SETTINGS = {
    "vertical_strategy": "lines",
    "horizontal_strategy": "lines",
    "snap_tolerance": 4,
    "join_tolerance": 4,
    "edge_min_length": 10,
    "intersection_tolerance": 5,
}

TEXT_ONLY_TABLE_SETTINGS = {
    "vertical_strategy": "text",
    "horizontal_strategy": "text",
    "min_words_vertical": 2,
    "min_words_horizontal": 1,
    "snap_tolerance": 5,
}

SCHEDULE_PATTERNS = {
    "door_schedule": {
        "primary": ["mark", "door no", "door number", "door ref"],
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

MAX_MATCHES_PER_PAGE = 3


# ============================================================
# Utility Functions
# ============================================================

def output_error(message, error_type="error"):
    """Print structured JSON error to stdout."""
    error = {
        "error": True,
        "error_type": error_type,
        "message": message,
    }
    print(json.dumps(error, indent=2))


def save_output(result, command):
    """Save result JSON to output/ directory with timestamped filename."""
    os.makedirs("output", exist_ok=True)
    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    filename = f"pdf_{command}_{timestamp}.json"
    filepath = os.path.join("output", filename)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    result["_saved_to"] = filepath


def parse_page_ranges(page_spec, total_pages):
    """Parse a page range specification into a sorted list of 0-indexed page numbers.

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
                pages.add(p - 1)
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

            pages.add(page_num - 1)

    if not pages:
        raise ValueError(f"No valid pages in specification: '{page_spec}'")

    return sorted(pages)


# ============================================================
# Header Matching & Schedule Classification
# ============================================================

def normalize_header(header):
    """Normalize a header string for fuzzy comparison."""
    if header is None:
        return ""
    h = header.strip().lower()
    h = re.sub(r'[.\-_/\\()#*:]', ' ', h)
    h = re.sub(r'\s+', ' ', h).strip()
    return h


def header_matches(actual_header, pattern):
    """Check if an actual header matches a pattern (fuzzy)."""
    norm = normalize_header(actual_header)
    pattern_norm = pattern.lower().strip()
    if norm == pattern_norm:
        return True
    if pattern_norm in norm or norm in pattern_norm:
        return True
    if norm.startswith(pattern_norm):
        return True
    return False


def classify_table(headers, page_text):
    """Classify a table as a specific schedule type.

    Returns: (schedule_type, confidence)
        schedule_type: "door_schedule", "window_schedule", etc. or None
        confidence: 0.0 to 1.0
    """
    best_type = None
    best_score = 0.0

    for sched_type, patterns in SCHEDULE_PATTERNS.items():
        score = 0.0

        primary_matches = sum(
            1 for p in patterns["primary"]
            if any(header_matches(h, p) for h in headers)
        )
        if primary_matches == 0:
            title_match = any(
                re.search(tp, page_text, re.IGNORECASE)
                for tp in patterns["title_patterns"]
            )
            if not title_match:
                continue
            score += 0.3
        else:
            score += primary_matches * 0.3

        secondary_matches = sum(
            1 for p in patterns["secondary"]
            if any(header_matches(h, p) for h in headers)
        )
        score += secondary_matches * 0.1

        score = min(score, 1.0)

        if score > 0.35 and score > best_score:
            best_score = score
            best_type = sched_type

    return best_type, best_score


# ============================================================
# Table Extraction Helpers
# ============================================================

def table_to_dict(raw_table):
    """Convert raw pdfplumber table (list of lists) to structured dict.

    Returns dict with "headers" and "rows" keys, or None if table is
    too small or has empty headers.
    """
    if not raw_table or len(raw_table) < 2:
        return None

    headers = [
        (cell.strip() if cell else "")
        for cell in raw_table[0]
    ]

    if not any(headers):
        return None

    rows = []
    for row in raw_table[1:]:
        cleaned_row = [
            (cell.strip() if cell else "")
            for cell in row
        ]
        if any(cleaned_row):
            rows.append(cleaned_row)

    if not rows:
        return None

    return {
        "headers": headers,
        "rows": rows,
    }


def extract_tables_from_page(page):
    """Extract tables with two-pass strategy.

    Pass 1: "lines" strategy for tables with visible gridlines.
    Pass 2: "text" strategy fallback for text-only tables.
    """
    raw_tables = page.extract_tables(table_settings=SCHEDULE_TABLE_SETTINGS)

    tables = []
    if raw_tables:
        for raw in raw_tables:
            converted = table_to_dict(raw)
            if converted:
                tables.append(converted)

    if not tables:
        raw_tables = page.extract_tables(table_settings=TEXT_ONLY_TABLE_SETTINGS)
        if raw_tables:
            for raw in raw_tables:
                converted = table_to_dict(raw)
                if converted:
                    tables.append(converted)

    return tables


# ============================================================
# Search Helpers
# ============================================================

def search_pdf(pdf, query):
    """Search all pages for a query string. Returns list of match dicts."""
    matches = []
    query_lower = query.lower()

    for i, page in enumerate(pdf.pages):
        text = page.extract_text()
        if text is None:
            continue

        if query_lower in text.lower():
            lines = text.split("\n")
            for line_idx, line in enumerate(lines):
                if query_lower in line.lower():
                    context_start = max(0, line_idx - 1)
                    context_end = min(len(lines), line_idx + 2)
                    context_lines = lines[context_start:context_end]

                    matches.append({
                        "page": i + 1,
                        "snippet": line.strip(),
                        "context": "\n".join(l.strip() for l in context_lines),
                    })

    return matches


def deduplicate_matches(matches, max_per_page=3):
    """Keep at most max_per_page matches per page number."""
    page_counts = defaultdict(int)
    result = []
    for m in matches:
        if page_counts[m["page"]] < max_per_page:
            result.append(m)
            page_counts[m["page"]] += 1
    return result


# ============================================================
# Schedule Continuation Merging
# ============================================================

def merge_continuation_schedules(schedules):
    """Merge schedule tables that span consecutive pages.

    Two tables are considered continuations if they have the same schedule
    type, are on consecutive pages, and share the same headers.
    """
    if not schedules:
        return []

    merged = [schedules[0].copy()]
    merged[0]["pages"] = [merged[0]["page"]]

    for sched in schedules[1:]:
        prev = merged[-1]
        if (sched["type"] == prev["type"]
                and sched["page"] == prev["pages"][-1] + 1
                and sched["headers"] == prev["headers"]):
            prev["rows"].extend(sched["rows"])
            prev["row_count"] = len(prev["rows"])
            prev["pages"].append(sched["page"])
        else:
            entry = sched.copy()
            entry["pages"] = [entry["page"]]
            merged.append(entry)

    return merged


# ============================================================
# Command Handlers
# ============================================================

def cmd_text(pdf_path, pages=None):
    """Extract text from PDF pages."""
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
            if text:
                results.append({
                    "page": idx + 1,
                    "text": text,
                })

        return {
            "file": os.path.basename(pdf_path),
            "total_pages": total_pages,
            "pages_extracted": len(results),
            "results": results,
        }


def cmd_tables(pdf_path, pages=None):
    """Extract tables from PDF pages."""
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

            if tables:
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


def cmd_search(pdf_path, query):
    """Search for a keyword across all PDF pages."""
    with pdfplumber.open(pdf_path) as pdf:
        matches = search_pdf(pdf, query)
        matches = deduplicate_matches(matches, max_per_page=MAX_MATCHES_PER_PAGE)

        return {
            "file": os.path.basename(pdf_path),
            "query": query,
            "match_count": len(matches),
            "matches": matches,
        }


def cmd_schedules(pdf_path):
    """Auto-detect schedule tables by scanning for known column headers."""
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

        schedules_found = merge_continuation_schedules(schedules_found)

        return {
            "file": os.path.basename(pdf_path),
            "schedules_found": schedules_found,
        }


# ============================================================
# Argparse & Main
# ============================================================

def build_parser():
    """Build the CLI argument parser with subcommands."""
    parser = argparse.ArgumentParser(
        prog="pdf_extract",
        description="Extract text, tables, and schedules from PDF documents.",
    )

    parser.add_argument(
        "pdf_file",
        help="Path to the PDF file",
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    # text
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

    # tables
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

    # search
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

    # schedules
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


def main():
    """Entry point."""
    parser = build_parser()
    args = parser.parse_args()

    pdf_path = args.pdf_file
    if not os.path.isfile(pdf_path):
        output_error(f"File not found: {pdf_path}", error_type="file_not_found")
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
        output_error(str(e), error_type="invalid_argument")
        sys.exit(2)
    except PDFSyntaxError:
        output_error(
            f"Invalid or corrupted PDF file: {pdf_path}",
            error_type="corrupted_pdf",
        )
        sys.exit(1)
    except Exception as e:
        output_error(f"Failed to process PDF: {e}", error_type="processing_error")
        sys.exit(1)

    if hasattr(args, "save") and args.save:
        save_output(result, args.command)

    print(json.dumps(result, indent=2))
    sys.exit(0)


if __name__ == "__main__":
    main()
