#!/usr/bin/env python3
"""ifc_extract.py - CLI tool for extracting structured data from IFC building models.

Wraps IfcOpenShell to query IFC files and return structured JSON.
Part of the BuildBrain project.

Usage:
    python ifc_extract.py <file.ifc> summary
    python ifc_extract.py <file.ifc> list <element_type>
    python ifc_extract.py <file.ifc> props <guid>
    python ifc_extract.py <file.ifc> query <element_type> --property Pset.Prop --value val
    python ifc_extract.py <file.ifc> quantities <element_type> [--group-by storey|type]
    python ifc_extract.py <file.ifc> validate
    python ifc_extract.py <file.ifc> export <element_type> --output file.csv
"""

import argparse
import json
import multiprocessing
import os
import re
import sys
import time
from datetime import datetime
from typing import Any

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element
import ifcopenshell.util.shape

# ---------------------------------------------------------------------------
# CONSTANTS
# ---------------------------------------------------------------------------

TYPE_SHORTHAND = {
    "door": "IfcDoor",
    "window": "IfcWindow",
    "wall": "IfcWall",
    "slab": "IfcSlab",
    "floor": "IfcSlab",
    "roof": "IfcRoof",
    "column": "IfcColumn",
    "beam": "IfcBeam",
    "stair": "IfcStair",
    "railing": "IfcRailing",
    "space": "IfcSpace",
    "room": "IfcSpace",
    "covering": "IfcCovering",
}

# Quantity property preferences per element type (from spec section 4.1)
QTO_PREFERENCES = {
    "IfcWall": {
        "area_prop": "NetSideArea",
        "volume_prop": "NetVolume",
        "qto_set": "Qto_WallBaseQuantities",
    },
    "IfcSlab": {
        "area_prop": "NetArea",
        "volume_prop": "NetVolume",
        "qto_set": "Qto_SlabBaseQuantities",
    },
    "IfcDoor": {
        "area_prop": "Area",
        "volume_prop": None,
        "qto_set": "Qto_DoorBaseQuantities",
    },
    "IfcWindow": {
        "area_prop": "Area",
        "volume_prop": None,
        "qto_set": "Qto_WindowBaseQuantities",
    },
    "IfcRoof": {
        "area_prop": "NetArea",
        "volume_prop": None,
        "qto_set": "Qto_RoofBaseQuantities",
    },
    "IfcColumn": {
        "area_prop": "CrossSectionArea",
        "volume_prop": "NetVolume",
        "qto_set": "Qto_ColumnBaseQuantities",
    },
    "IfcBeam": {
        "area_prop": "CrossSectionArea",
        "volume_prop": "NetVolume",
        "qto_set": "Qto_BeamBaseQuantities",
    },
}

# Building element types to scan in summary
BUILDING_ELEMENT_TYPES = [
    "IfcWall", "IfcDoor", "IfcWindow", "IfcSlab", "IfcRoof",
    "IfcColumn", "IfcBeam", "IfcStair", "IfcRailing", "IfcSpace",
    "IfcCovering", "IfcBuildingElementProxy", "IfcFurnishingElement",
    "IfcPlate", "IfcMember", "IfcCurtainWall", "IfcFooting",
]

# Expected property sets per element type (for validate command)
PSET_EXPECTATIONS = {
    "IfcDoor": "Pset_DoorCommon",
    "IfcWindow": "Pset_WindowCommon",
    "IfcWall": "Pset_WallCommon",
    "IfcSlab": "Pset_SlabCommon",
    "IfcRoof": "Pset_RoofCommon",
    "IfcColumn": "Pset_ColumnCommon",
    "IfcBeam": "Pset_BeamCommon",
    "IfcStair": "Pset_StairCommon",
    "IfcRailing": "Pset_RailingCommon",
    "IfcSpace": "Pset_SpaceCommon",
    "IfcCovering": "Pset_CoveringCommon",
}


# ---------------------------------------------------------------------------
# HELPERS
# ---------------------------------------------------------------------------

def _camel_to_snake(name: str) -> str:
    """Convert CamelCase to snake_case. E.g. NetSideArea -> net_side_area."""
    s1 = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", name)
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s1).lower()


def resolve_type(type_arg: str) -> str:
    """Resolve shorthand to full IFC type name. Pass through unrecognised names as-is."""
    return TYPE_SHORTHAND.get(type_arg.lower(), type_arg)


def error_response(
    error_type: str,
    message: str,
    partial_results: bool = False,
    elements: list | None = None,
) -> dict:
    """Create a structured error response matching spec format."""
    result = {
        "error": True,
        "error_type": error_type,
        "message": message,
        "partial_results": partial_results,
    }
    if elements is not None:
        result["elements"] = elements
    return result


def safe_open(filepath: str):
    """Open an IFC file with comprehensive error handling."""
    if not os.path.isfile(filepath):
        print(
            json.dumps(error_response("file_not_found", f"File not found: {filepath}")),
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        model = ifcopenshell.open(filepath)
    except RuntimeError as e:
        print(
            json.dumps(error_response("parse_error", f"Failed to parse IFC file: {e}")),
            file=sys.stderr,
        )
        sys.exit(1)
    except Exception as e:
        print(
            json.dumps(
                error_response("ifc_error", f"Error opening IFC file: {type(e).__name__}: {e}")
            ),
            file=sys.stderr,
        )
        sys.exit(1)

    return model


def safe_by_type(model, ifc_type: str) -> list:
    """Query elements by type with error handling for invalid type names."""
    try:
        return model.by_type(ifc_type)
    except RuntimeError:
        print(
            json.dumps(
                error_response(
                    "invalid_type",
                    f"'{ifc_type}' is not a valid IFC entity type in schema {model.schema}",
                )
            ),
            file=sys.stderr,
        )
        sys.exit(2)


def extract_material_name(element) -> str | None:
    """Extract a human-readable material name string from an element.

    Handles all IFC material assignment patterns:
    - IfcMaterial (single material)
    - IfcMaterialLayerSetUsage / IfcMaterialLayerSet (walls, slabs)
    - IfcMaterialConstituentSet (IFC4 doors, windows)
    - IfcMaterialProfileSetUsage / IfcMaterialProfileSet (beams, columns)
    - IfcMaterialList (legacy)

    Returns the primary material name as a string, or a comma-separated list
    for multi-material elements. Returns None if no material assigned.
    """
    material = ifcopenshell.util.element.get_material(element, should_inherit=True)
    if material is None:
        return None

    if material.is_a("IfcMaterial"):
        return material.Name

    if material.is_a("IfcMaterialLayerSetUsage"):
        layers = material.ForLayerSet.MaterialLayers
        names = [layer.Material.Name for layer in layers if layer.Material]
        return ", ".join(names) if names else None

    if material.is_a("IfcMaterialLayerSet"):
        layers = material.MaterialLayers
        names = [layer.Material.Name for layer in layers if layer.Material]
        return ", ".join(names) if names else None

    if material.is_a("IfcMaterialConstituentSet"):
        constituents = material.MaterialConstituents or []
        names = [c.Material.Name for c in constituents if c.Material]
        return ", ".join(names) if names else None

    if material.is_a("IfcMaterialProfileSetUsage"):
        profiles = material.ForProfileSet.MaterialProfiles or []
        names = [p.Material.Name for p in profiles if p.Material]
        return ", ".join(names) if names else None

    if material.is_a("IfcMaterialProfileSet"):
        profiles = material.MaterialProfiles or []
        names = [p.Material.Name for p in profiles if p.Material]
        return ", ".join(names) if names else None

    if material.is_a("IfcMaterialList"):
        names = [m.Name for m in material.Materials if m]
        return ", ".join(names) if names else None

    # Fallback: try .Name attribute
    return getattr(material, "Name", None)


def extract_element_data(element, model, compact: bool = False) -> dict:
    """Extract structured data from a single IFC element.

    Args:
        element: An ifcopenshell entity_instance
        model: The ifcopenshell file (needed for some lookups)
        compact: If True, only return guid, name, type_name, storey

    Returns:
        dict matching the spec JSON element format
    """
    # Basic identity
    data = {
        "guid": element.GlobalId,
        "name": getattr(element, "Name", None),
    }

    # Type name (from IfcTypeProduct)
    element_type = ifcopenshell.util.element.get_type(element)
    data["type_name"] = element_type.Name if element_type else None

    # Storey (spatial container)
    container = ifcopenshell.util.element.get_container(element)
    data["storey"] = container.Name if container else None

    if compact:
        return data

    # Properties (Psets only, no Qtos) -- strip internal "id" key
    psets = ifcopenshell.util.element.get_psets(element, psets_only=True)
    cleaned_psets = {}
    for pset_name, props in psets.items():
        cleaned_psets[pset_name] = {k: v for k, v in props.items() if k != "id"}
    data["properties"] = cleaned_psets

    # Quantities (Qtos only) -- strip internal "id" key
    qtos = ifcopenshell.util.element.get_psets(element, qtos_only=True)
    cleaned_qtos = {}
    for qto_name, props in qtos.items():
        cleaned_qtos[qto_name] = {k: v for k, v in props.items() if k != "id"}
    data["quantities"] = cleaned_qtos

    # Material
    data["material"] = extract_material_name(element)

    return data


def parse_property_path(path: str) -> tuple:
    """Parse 'Pset_DoorCommon.FireRating' into ('Pset_DoorCommon', 'FireRating')."""
    parts = path.split(".", 1)
    if len(parts) != 2:
        print(
            json.dumps(
                error_response(
                    "invalid_property_path",
                    f"Property path must be in format 'PsetName.PropertyName', got: '{path}'",
                )
            ),
            file=sys.stderr,
        )
        sys.exit(2)
    return parts[0], parts[1]


def _values_match(actual: Any, expected_str: str) -> bool:
    """Compare IFC property value against a string filter value."""
    if actual is None:
        return False
    # Boolean handling
    if isinstance(actual, bool):
        return str(actual).lower() == expected_str.lower()
    # Numeric handling
    if isinstance(actual, (int, float)):
        try:
            return actual == float(expected_str)
        except ValueError:
            return False
    # String comparison (case-insensitive)
    return str(actual).lower() == expected_str.lower()


def apply_output_filters(elements: list[dict], args) -> list[dict]:
    """Apply --limit, --offset, --fields filters to element list."""
    # Offset
    offset = getattr(args, "offset", 0) or 0
    if offset > 0:
        elements = elements[offset:]

    # Limit
    limit = getattr(args, "limit", None)
    if limit is not None:
        elements = elements[:limit]

    # Fields filter
    fields_str = getattr(args, "fields", None)
    if fields_str:
        requested = [f.strip() for f in fields_str.split(",")]
        filtered = []
        for el in elements:
            new_el = {}
            for field in requested:
                if field in el:
                    new_el[field] = el[field]
                else:
                    # Check inside properties dicts for bare property names
                    for pset_name, props in el.get("properties", {}).items():
                        if field in props:
                            new_el[field] = props[field]
                    for qto_name, props in el.get("quantities", {}).items():
                        if field in props:
                            new_el[field] = props[field]
            filtered.append(new_el)
        elements = filtered

    return elements


def save_output(data: dict, command: str, args) -> str | None:
    """Save output to output/<prefix>_<timestamp>.json if --save is set.

    Returns the output file path if saved, None otherwise.
    """
    if not getattr(args, "save", False):
        return None

    os.makedirs("output", exist_ok=True)

    # Determine prefix
    element_type = getattr(args, "element_type", None)
    if element_type:
        prefix = f"ifc_{resolve_type(element_type).lower()}_{command}"
    else:
        prefix = f"ifc_{command}"

    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    filename = f"{prefix}_{timestamp}.json"
    filepath = os.path.join("output", filename)

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False, default=str)

    return filepath


# ---------------------------------------------------------------------------
# COMMAND FUNCTIONS
# ---------------------------------------------------------------------------

def cmd_summary(model, filepath: str, args) -> dict:
    """Scan entire model, report all element types found with counts."""
    start_time = time.time()

    # Get file metadata
    file_size_mb = round(os.path.getsize(filepath) / (1024 * 1024), 1)

    # Get project name
    projects = model.by_type("IfcProject")
    project_name = projects[0].Name if projects else None

    # Count all building element types
    element_counts = {}
    for ifc_type in BUILDING_ELEMENT_TYPES:
        try:
            elements = model.by_type(ifc_type)
            if elements:
                element_counts[ifc_type] = len(elements)
        except RuntimeError:
            pass  # Type doesn't exist in this schema version

    # Get storeys
    storeys = [s.Name for s in model.by_type("IfcBuildingStorey")]

    result = {
        "file": os.path.basename(filepath),
        "file_size_mb": file_size_mb,
        "schema": model.schema,
        "project_name": project_name,
        "element_counts": element_counts,
        "storeys": storeys,
        "parse_time_seconds": round(time.time() - start_time, 1),
    }
    return result


def cmd_list(model, args) -> dict:
    """List all elements of a given type."""
    ifc_type = resolve_type(args.element_type)
    elements = safe_by_type(model, ifc_type)

    total_count = len(elements)

    # Extract data for each element
    element_data = [extract_element_data(el, model, compact=args.compact) for el in elements]

    # Apply filters
    element_data = apply_output_filters(element_data, args)

    result = {
        "element_type": ifc_type,
        "count": total_count,
        "elements": element_data,
    }
    return result


def cmd_props(model, args) -> dict:
    """Get detailed properties for a specific element by GUID."""
    try:
        element = model.by_guid(args.guid)
    except RuntimeError:
        print(
            json.dumps(error_response("element_not_found", f"No element found with GUID: {args.guid}")),
            file=sys.stderr,
        )
        sys.exit(1)

    data = extract_element_data(element, model, compact=False)
    data["ifc_class"] = element.is_a()
    return data


def cmd_query(model, args) -> dict:
    """Filter elements by property value."""
    ifc_type = resolve_type(args.element_type)
    elements = safe_by_type(model, ifc_type)

    pset_name, prop_name = parse_property_path(args.prop_path)

    # Validate that at least one filter is given
    if not args.not_null and args.value is None:
        print(
            json.dumps(
                error_response(
                    "missing_filter",
                    "Either --value or --not-null must be specified for query command",
                )
            ),
            file=sys.stderr,
        )
        sys.exit(2)

    matched = []
    for el in elements:
        value = ifcopenshell.util.element.get_pset(el, pset_name, prop_name)

        if args.not_null:
            if value is not None and value != "" and value != "N/A":
                matched.append(el)
        elif args.value is not None:
            # Special case: --value null matches elements where property is null/empty
            if args.value.lower() == "null":
                if value is None or value == "" or value == "N/A":
                    matched.append(el)
            elif _values_match(value, args.value):
                matched.append(el)

    element_data = [extract_element_data(el, model, compact=args.compact) for el in matched]
    element_data = apply_output_filters(element_data, args)

    result = {
        "element_type": ifc_type,
        "query": {
            "property": args.prop_path,
            "value": args.value,
            "not_null": args.not_null,
        },
        "total_of_type": len(elements),
        "matched_count": len(matched),
        "elements": element_data,
    }
    return result


def cmd_quantities(model, args) -> dict:
    """Compute aggregated quantities (counts, areas, volumes) for an element type.

    Strategy (from spec):
    1. Read Qto_ property sets first (instant, authoritative)
    2. Fall back to geometry computation via ifcopenshell.util.shape for elements
       missing Qto_ data (~2% variance, slower)
    3. Track provenance in _source field

    Special handling:
    - IfcStair: quantities come from child IfcStairFlight via Qto_StairFlightBaseQuantities
    - IfcSpace: area/volume come from Qto_SpaceBaseQuantities
    """
    start_time = time.time()
    ifc_type = resolve_type(args.element_type)
    elements = safe_by_type(model, ifc_type)

    # Special handling for IfcStair: quantities are on child IfcStairFlight
    if ifc_type == "IfcStair":
        return _cmd_quantities_stair(model, elements, args, start_time)

    # Special handling for IfcSpace: use Qto_SpaceBaseQuantities
    if ifc_type == "IfcSpace":
        return _cmd_quantities_space(model, elements, args, start_time)

    prefs = QTO_PREFERENCES.get(ifc_type, {})
    qto_set_name = prefs.get("qto_set")
    area_prop = prefs.get("area_prop")
    volume_prop = prefs.get("volume_prop")

    # Phase 1: Extract from Qto_ property sets
    qto_elements = []       # Elements with Qto data
    missing_elements = []   # Elements needing geometry fallback

    area_total_qto = 0.0
    volume_total_qto = 0.0

    # Per-storey and per-type accumulators
    by_storey = {}
    by_type = {}

    for el in elements:
        container = ifcopenshell.util.element.get_container(el)
        storey = container.Name if container else "Unassigned"

        el_type = ifcopenshell.util.element.get_type(el)
        type_name = el_type.Name if el_type else "Untyped"

        # Try to get Qto data
        qto_data = None
        if qto_set_name:
            qto_data = ifcopenshell.util.element.get_pset(el, qto_set_name)

        area_val = None
        volume_val = None

        if qto_data and area_prop:
            area_val = qto_data.get(area_prop)
        if qto_data and volume_prop:
            volume_val = qto_data.get(volume_prop)

        has_qto = (area_val is not None) or (volume_val is not None)

        if has_qto:
            qto_elements.append(el)
            if area_val:
                area_total_qto += area_val
            if volume_val:
                volume_total_qto += volume_val
        else:
            missing_elements.append(el)

        # Accumulate by storey
        if storey not in by_storey:
            by_storey[storey] = {"count": 0, "area": 0.0, "volume": 0.0}
        by_storey[storey]["count"] += 1
        if area_val:
            by_storey[storey]["area"] += area_val
        if volume_val:
            by_storey[storey]["volume"] += volume_val

        # Accumulate by type
        if type_name not in by_type:
            by_type[type_name] = {"count": 0, "area": 0.0, "volume": 0.0}
        by_type[type_name]["count"] += 1
        if area_val:
            by_type[type_name]["area"] += area_val
        if volume_val:
            by_type[type_name]["volume"] += volume_val

    # Phase 2: Geometry fallback for elements missing Qto data
    area_total_computed = 0.0
    volume_total_computed = 0.0
    geometry_errors = 0

    if missing_elements and (area_prop or volume_prop):
        try:
            settings = ifcopenshell.geom.settings()
            settings.set("use-world-coords", True)
            settings.set("weld-vertices", True)

            iterator = ifcopenshell.geom.iterator(
                settings,
                model,
                multiprocessing.cpu_count(),
                include=missing_elements,
            )

            if iterator.initialize():
                while True:
                    shape = iterator.get()
                    el = model.by_id(shape.id)
                    geometry = shape.geometry

                    container = ifcopenshell.util.element.get_container(el)
                    storey = container.Name if container else "Unassigned"
                    el_type_obj = ifcopenshell.util.element.get_type(el)
                    type_name = el_type_obj.Name if el_type_obj else "Untyped"

                    try:
                        computed_area = None
                        computed_volume = None

                        if area_prop:
                            if ifc_type in ("IfcWall",):
                                computed_area = ifcopenshell.util.shape.get_side_area(geometry)
                            elif ifc_type in ("IfcSlab", "IfcRoof"):
                                computed_area = ifcopenshell.util.shape.get_footprint_area(geometry)
                            else:
                                computed_area = ifcopenshell.util.shape.get_area(geometry)

                        if volume_prop:
                            computed_volume = ifcopenshell.util.shape.get_volume(geometry)

                        if computed_area:
                            area_total_computed += computed_area
                            by_storey[storey]["area"] += computed_area
                            by_type[type_name]["area"] += computed_area

                        if computed_volume:
                            volume_total_computed += computed_volume
                            by_storey[storey]["volume"] += computed_volume
                            by_type[type_name]["volume"] += computed_volume

                    except Exception:
                        geometry_errors += 1

                    if not iterator.next():
                        break
        except Exception:
            # Geometry processing entirely failed; record all as errors
            geometry_errors = len(missing_elements)

    # Build result
    total_area = round(area_total_qto + area_total_computed, 1) if area_prop else None
    total_volume = round(volume_total_qto + volume_total_computed, 1) if volume_prop else None

    totals = {"count": len(elements)}
    source = {}

    if area_prop:
        area_key = f"total_{_camel_to_snake(area_prop)}_m2"
        totals[area_key] = total_area
        computed_ok = len(missing_elements) - geometry_errors
        source["area"] = f"qto ({len(qto_elements)}), computed ({computed_ok})"

    if volume_prop:
        volume_key = f"total_{_camel_to_snake(volume_prop)}_m3"
        totals[volume_key] = total_volume
        computed_ok = len(missing_elements) - geometry_errors
        source["volume"] = f"qto ({len(qto_elements)}), computed ({computed_ok})"

    totals["_source"] = source

    # Format by_storey and by_type for output
    formatted_by_storey = {}
    for sname, sdata in by_storey.items():
        entry = {"count": sdata["count"]}
        if area_prop:
            entry[f"total_{_camel_to_snake(area_prop)}_m2"] = round(sdata["area"], 1)
        if volume_prop:
            entry[f"total_{_camel_to_snake(volume_prop)}_m3"] = round(sdata["volume"], 1)
        formatted_by_storey[sname] = entry

    formatted_by_type = {}
    for tname, tdata in by_type.items():
        entry = {"count": tdata["count"]}
        if area_prop:
            entry[f"total_{_camel_to_snake(area_prop)}_m2"] = round(tdata["area"], 1)
        if volume_prop:
            entry[f"total_{_camel_to_snake(volume_prop)}_m3"] = round(tdata["volume"], 1)
        formatted_by_type[tname] = entry

    result = {
        "element_type": ifc_type,
        "totals": totals,
        "by_storey": formatted_by_storey,
        "by_type": formatted_by_type,
        "qto_coverage": (
            f"{len(qto_elements)} of {len(elements)} elements have {qto_set_name}"
            if qto_set_name
            else "No standard Qto set defined"
        ),
        "geometry_fallback_count": len(missing_elements),
        "geometry_errors": geometry_errors,
        "compute_time_seconds": round(time.time() - start_time, 1),
    }
    return result


def _cmd_quantities_stair(model, elements: list, args, start_time: float) -> dict:
    """Handle quantities for IfcStair via child IfcStairFlight elements.

    IfcStair quantities live on child IfcStairFlight elements via
    Qto_StairFlightBaseQuantities.
    """
    qto_set_name = "Qto_StairFlightBaseQuantities"
    area_prop = "GrossArea"
    volume_prop = "NetVolume"

    by_storey = {}
    by_type = {}
    area_total = 0.0
    volume_total = 0.0
    flights_with_qto = 0
    total_flights = 0

    for stair in elements:
        container = ifcopenshell.util.element.get_container(stair)
        storey = container.Name if container else "Unassigned"

        el_type = ifcopenshell.util.element.get_type(stair)
        type_name = el_type.Name if el_type else "Untyped"

        if storey not in by_storey:
            by_storey[storey] = {"count": 0, "area": 0.0, "volume": 0.0}
        by_storey[storey]["count"] += 1

        if type_name not in by_type:
            by_type[type_name] = {"count": 0, "area": 0.0, "volume": 0.0}
        by_type[type_name]["count"] += 1

        # Find child IfcStairFlight elements via decomposition
        flights = []
        if hasattr(stair, "IsDecomposedBy"):
            for rel in stair.IsDecomposedBy:
                for child in rel.RelatedObjects:
                    if child.is_a("IfcStairFlight"):
                        flights.append(child)

        for flight in flights:
            total_flights += 1
            qto_data = ifcopenshell.util.element.get_pset(flight, qto_set_name)
            if qto_data:
                flights_with_qto += 1
                a = qto_data.get(area_prop)
                v = qto_data.get(volume_prop)
                if a:
                    area_total += a
                    by_storey[storey]["area"] += a
                    by_type[type_name]["area"] += a
                if v:
                    volume_total += v
                    by_storey[storey]["volume"] += v
                    by_type[type_name]["volume"] += v

    totals = {
        "count": len(elements),
        "total_flights": total_flights,
        f"total_{_camel_to_snake(area_prop)}_m2": round(area_total, 1),
        f"total_{_camel_to_snake(volume_prop)}_m3": round(volume_total, 1),
        "_source": {
            "area": f"qto ({flights_with_qto} flights)",
            "volume": f"qto ({flights_with_qto} flights)",
        },
    }

    formatted_by_storey = {}
    for sname, sdata in by_storey.items():
        formatted_by_storey[sname] = {
            "count": sdata["count"],
            f"total_{_camel_to_snake(area_prop)}_m2": round(sdata["area"], 1),
            f"total_{_camel_to_snake(volume_prop)}_m3": round(sdata["volume"], 1),
        }

    formatted_by_type = {}
    for tname, tdata in by_type.items():
        formatted_by_type[tname] = {
            "count": tdata["count"],
            f"total_{_camel_to_snake(area_prop)}_m2": round(tdata["area"], 1),
            f"total_{_camel_to_snake(volume_prop)}_m3": round(tdata["volume"], 1),
        }

    return {
        "element_type": "IfcStair",
        "totals": totals,
        "by_storey": formatted_by_storey,
        "by_type": formatted_by_type,
        "qto_coverage": f"{flights_with_qto} of {total_flights} IfcStairFlight children have {qto_set_name}",
        "geometry_fallback_count": 0,
        "geometry_errors": 0,
        "compute_time_seconds": round(time.time() - start_time, 1),
    }


def _cmd_quantities_space(model, elements: list, args, start_time: float) -> dict:
    """Handle quantities for IfcSpace via Qto_SpaceBaseQuantities.

    IfcSpace area/volume come from Qto_SpaceBaseQuantities, not from psets.
    """
    qto_set_name = "Qto_SpaceBaseQuantities"
    area_prop = "NetFloorArea"
    volume_prop = "NetVolume"

    by_storey = {}
    by_type = {}
    area_total = 0.0
    volume_total = 0.0
    with_qto = 0

    for space in elements:
        container = ifcopenshell.util.element.get_container(space)
        storey = container.Name if container else "Unassigned"

        el_type = ifcopenshell.util.element.get_type(space)
        type_name = el_type.Name if el_type else (getattr(space, "LongName", None) or "Untyped")

        if storey not in by_storey:
            by_storey[storey] = {"count": 0, "area": 0.0, "volume": 0.0}
        by_storey[storey]["count"] += 1

        if type_name not in by_type:
            by_type[type_name] = {"count": 0, "area": 0.0, "volume": 0.0}
        by_type[type_name]["count"] += 1

        qto_data = ifcopenshell.util.element.get_pset(space, qto_set_name)
        if qto_data:
            with_qto += 1
            a = qto_data.get(area_prop)
            # Also try GrossFloorArea as fallback
            if a is None:
                a = qto_data.get("GrossFloorArea")
            v = qto_data.get(volume_prop)
            if v is None:
                v = qto_data.get("GrossVolume")

            if a:
                area_total += a
                by_storey[storey]["area"] += a
                by_type[type_name]["area"] += a
            if v:
                volume_total += v
                by_storey[storey]["volume"] += v
                by_type[type_name]["volume"] += v

    totals = {
        "count": len(elements),
        f"total_{_camel_to_snake(area_prop)}_m2": round(area_total, 1),
        f"total_{_camel_to_snake(volume_prop)}_m3": round(volume_total, 1),
        "_source": {
            "area": f"qto ({with_qto})",
            "volume": f"qto ({with_qto})",
        },
    }

    formatted_by_storey = {}
    for sname, sdata in by_storey.items():
        formatted_by_storey[sname] = {
            "count": sdata["count"],
            f"total_{_camel_to_snake(area_prop)}_m2": round(sdata["area"], 1),
            f"total_{_camel_to_snake(volume_prop)}_m3": round(sdata["volume"], 1),
        }

    formatted_by_type = {}
    for tname, tdata in by_type.items():
        formatted_by_type[tname] = {
            "count": tdata["count"],
            f"total_{_camel_to_snake(area_prop)}_m2": round(tdata["area"], 1),
            f"total_{_camel_to_snake(volume_prop)}_m3": round(tdata["volume"], 1),
        }

    return {
        "element_type": "IfcSpace",
        "totals": totals,
        "by_storey": formatted_by_storey,
        "by_type": formatted_by_type,
        "qto_coverage": f"{with_qto} of {len(elements)} elements have {qto_set_name}",
        "geometry_fallback_count": 0,
        "geometry_errors": 0,
        "compute_time_seconds": round(time.time() - start_time, 1),
    }


def cmd_validate(model, filepath: str, args) -> dict:
    """Check IFC data quality: missing psets, proxies, orphans, missing qtos."""
    issues = []
    completeness = {}

    # Check each element type for missing property sets and Qtos
    for ifc_type, expected_pset in PSET_EXPECTATIONS.items():
        try:
            elements = model.by_type(ifc_type)
        except RuntimeError:
            continue
        if not elements:
            continue

        with_pset = 0
        with_qto = 0
        qto_set = QTO_PREFERENCES.get(ifc_type, {}).get("qto_set")

        for el in elements:
            psets = ifcopenshell.util.element.get_psets(el, psets_only=True)
            if expected_pset in psets:
                with_pset += 1

            if qto_set:
                qtos = ifcopenshell.util.element.get_psets(el, qtos_only=True)
                if qto_set in qtos:
                    with_qto += 1

        total = len(elements)
        pset_pct = f"{round(with_pset / total * 100)}%" if total > 0 else "0%"

        completeness[ifc_type] = {
            "total": total,
            "with_pset": with_pset,
            "with_qto": with_qto,
            "pset_coverage": pset_pct,
        }

        # Flag low pset coverage
        missing_count = total - with_pset
        if missing_count > 0:
            issues.append({
                "severity": "warn",
                "type": "missing_pset",
                "message": f"{expected_pset} not found on {missing_count} of {total} {ifc_type} elements",
                "affected_count": missing_count,
                "element_type": ifc_type,
            })

    # Check for IfcBuildingElementProxy (misclassified elements)
    try:
        proxies = model.by_type("IfcBuildingElementProxy")
        if proxies:
            proxy_info = [
                {"guid": p.GlobalId, "name": getattr(p, "Name", None)}
                for p in proxies[:10]
            ]
            issues.append({
                "severity": "warn",
                "type": "proxy_elements",
                "message": f"{len(proxies)} IfcBuildingElementProxy elements found \u2014 may be misclassified",
                "affected_count": len(proxies),
                "elements": proxy_info,
            })
    except RuntimeError:
        pass

    # Check for elements without storey assignment
    no_storey = []
    for ifc_type in PSET_EXPECTATIONS:
        try:
            for el in model.by_type(ifc_type):
                container = ifcopenshell.util.element.get_container(el)
                if container is None:
                    no_storey.append({
                        "guid": el.GlobalId,
                        "name": getattr(el, "Name", None),
                        "type": el.is_a(),
                    })
        except RuntimeError:
            continue

    if no_storey:
        issues.append({
            "severity": "info",
            "type": "no_storey",
            "message": f"{len(no_storey)} elements have no storey assignment",
            "affected_count": len(no_storey),
        })

    result = {
        "file": os.path.basename(filepath),
        "issues": issues,
        "completeness": completeness,
    }
    return result


def cmd_export(model, args) -> dict:
    """Export element data to CSV using pandas."""
    try:
        import pandas as pd
    except ImportError:
        print(
            json.dumps(error_response("missing_dependency", "pandas is required for CSV export. Install with: pip install pandas")),
            file=sys.stderr,
        )
        sys.exit(1)

    ifc_type = resolve_type(args.element_type)
    elements = safe_by_type(model, ifc_type)

    compact = getattr(args, "compact", False)

    # Apply offset/limit to element list before extraction
    offset = getattr(args, "offset", 0) or 0
    if offset > 0:
        elements = elements[offset:]
    limit = getattr(args, "limit", None)
    if limit is not None:
        elements = elements[:limit]

    rows = []
    for el in elements:
        data = extract_element_data(el, model, compact=compact)

        # Flatten properties into columns for CSV
        flat = {
            "guid": data["guid"],
            "name": data["name"],
            "type_name": data["type_name"],
            "storey": data["storey"],
        }

        if not compact:
            flat["material"] = data.get("material")

            # Flatten pset properties: "Pset_DoorCommon.FireRating" -> value
            for pset_name, props in data.get("properties", {}).items():
                for prop_name, value in props.items():
                    flat[f"{pset_name}.{prop_name}"] = value

            # Flatten quantities
            for qto_name, props in data.get("quantities", {}).items():
                for prop_name, value in props.items():
                    flat[f"{qto_name}.{prop_name}"] = value

        rows.append(flat)

    df = pd.DataFrame(rows)

    # Apply field filter
    fields_str = getattr(args, "fields", None)
    if fields_str:
        requested = [f.strip() for f in fields_str.split(",")]
        available = [c for c in requested if c in df.columns]
        if available:
            df = df[available]

    # Ensure output directory exists if path includes directories
    output_dir = os.path.dirname(args.output)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    df.to_csv(args.output, index=False)

    result = {
        "exported": True,
        "element_type": ifc_type,
        "count": len(rows),
        "output_file": args.output,
        "columns": list(df.columns),
    }
    return result


# ---------------------------------------------------------------------------
# ARGPARSE SETUP
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ifc_extract",
        description="Extract structured data from IFC building models via IfcOpenShell.",
    )
    parser.add_argument("ifc_file", help="Path to the IFC file")

    subparsers = parser.add_subparsers(
        dest="command", required=True, help="Command to execute"
    )

    # ---- summary ----
    sub_summary = subparsers.add_parser(
        "summary", help="Scan entire model, report all element types with counts"
    )
    sub_summary.add_argument("--save", action="store_true",
        help="Write output to output/ifc_summary_<timestamp>.json")

    # ---- list ----
    sub_list = subparsers.add_parser(
        "list", help="List all elements of a given type"
    )
    sub_list.add_argument("element_type",
        help="IFC type name or shorthand (e.g. door, wall, IfcDoor)")
    sub_list.add_argument("--limit", type=int, default=None,
        help="Max elements to return")
    sub_list.add_argument("--offset", type=int, default=0,
        help="Skip first N elements")
    sub_list.add_argument("--fields",
        help="Comma-separated list of fields to include (e.g. name,storey,FireRating)")
    sub_list.add_argument("--compact", action="store_true",
        help="Return only guid, name, type, storey (no properties)")
    sub_list.add_argument("--save", action="store_true",
        help="Write output to output/<type>_<timestamp>.json")

    # ---- props ----
    sub_props = subparsers.add_parser(
        "props", help="Get detailed properties for a specific element by GUID"
    )
    sub_props.add_argument("guid", help="22-character IFC GlobalId")
    sub_props.add_argument("--save", action="store_true",
        help="Write output to output/ifc_props_<timestamp>.json")

    # ---- query ----
    sub_query = subparsers.add_parser(
        "query", help="Filter elements by property value"
    )
    sub_query.add_argument("element_type",
        help="IFC type name or shorthand")
    sub_query.add_argument("--property", required=True, dest="prop_path",
        help="Property path as Pset.PropertyName (e.g. Pset_WallCommon.IsExternal)")
    sub_query.add_argument("--value",
        help="Value to match (case-insensitive for strings)")
    sub_query.add_argument("--not-null", action="store_true",
        help="Match elements where property is not null/empty")
    sub_query.add_argument("--limit", type=int, default=None,
        help="Max elements to return")
    sub_query.add_argument("--offset", type=int, default=0,
        help="Skip first N elements")
    sub_query.add_argument("--fields",
        help="Comma-separated list of fields to include")
    sub_query.add_argument("--compact", action="store_true",
        help="Return only guid, name, type, storey (no properties)")
    sub_query.add_argument("--save", action="store_true",
        help="Write output to output/<type>_<timestamp>.json")

    # ---- quantities ----
    sub_quantities = subparsers.add_parser(
        "quantities",
        help="Pre-computed aggregates (counts, areas, volumes) grouped by storey/type",
    )
    sub_quantities.add_argument("element_type",
        help="IFC type name or shorthand")
    sub_quantities.add_argument("--group-by", choices=["storey", "type"],
        help="Group results by storey or element type")
    sub_quantities.add_argument("--save", action="store_true",
        help="Write output to output/<type>_quantities_<timestamp>.json")

    # ---- validate ----
    sub_validate = subparsers.add_parser(
        "validate", help="Check IFC data quality (missing psets, proxies, orphans)"
    )
    sub_validate.add_argument("--save", action="store_true",
        help="Write output to output/ifc_validate_<timestamp>.json")

    # ---- export ----
    sub_export = subparsers.add_parser(
        "export", help="Export element data to CSV"
    )
    sub_export.add_argument("element_type",
        help="IFC type name or shorthand")
    sub_export.add_argument("--output", required=True,
        help="Output CSV file path")
    sub_export.add_argument("--limit", type=int, default=None,
        help="Max elements to export")
    sub_export.add_argument("--offset", type=int, default=0,
        help="Skip first N elements")
    sub_export.add_argument("--fields",
        help="Comma-separated list of fields to include")
    sub_export.add_argument("--compact", action="store_true",
        help="Return only guid, name, type, storey (no properties)")
    sub_export.add_argument("--save", action="store_true",
        help="Write JSON summary to output/ifc_export_<timestamp>.json")

    return parser


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

def main():
    parser = build_parser()
    args = parser.parse_args()

    # Open the IFC file
    model = safe_open(args.ifc_file)

    # Dispatch to command handler
    command_map = {
        "summary": lambda: cmd_summary(model, args.ifc_file, args),
        "list": lambda: cmd_list(model, args),
        "props": lambda: cmd_props(model, args),
        "query": lambda: cmd_query(model, args),
        "quantities": lambda: cmd_quantities(model, args),
        "validate": lambda: cmd_validate(model, args.ifc_file, args),
        "export": lambda: cmd_export(model, args),
    }

    handler = command_map.get(args.command)
    if handler is None:
        print(
            json.dumps(error_response("unknown_command", f"Unknown command: {args.command}")),
            file=sys.stderr,
        )
        sys.exit(2)

    result = handler()

    # Save if --save flag is set
    saved_path = save_output(result, args.command, args)
    if saved_path:
        result["_saved_to"] = saved_path

    # Print JSON to stdout
    print(json.dumps(result, indent=2, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
