# Implementation Guide: `ifc_extract.py`

**Target file:** `src/cli/ifc_extract.py`
**Purpose:** Standalone CLI tool wrapping IfcOpenShell for IFC data extraction.
**Dependencies:** `ifcopenshell>=0.8.0`, `pandas>=2.0.0` (for CSV export only)

---

## 1. IfcOpenShell API Reference (Verified for 0.8.x)

### 1.1 Opening Files

```python
import ifcopenshell

# Signature:
# ifcopenshell.open(path: Union[os.PathLike, str], format: Optional[str] = None, should_stream: bool = False) -> ifcopenshell.file.file
#
# Supported formats: .ifc, .ifcZIP, .ifcXML (guessed from extension if format=None)
# Raises: RuntimeError on parse failure, FileNotFoundError if path doesn't exist (Python built-in)

model = ifcopenshell.open("project.ifc")

# Key file attributes:
model.schema          # e.g. "IFC4" (general schema identifier)
model.schema_identifier  # e.g. "IFC4_ADD2" (full version string)
model.schema_version  # e.g. (4, 0, 2, 1) (tuple)
model.header          # File header metadata
```

### 1.2 Querying Elements by Type

```python
# Signature:
# model.by_type(type: str, include_subtypes: bool = True) -> list[ifcopenshell.entity_instance]
#
# Returns: list of entity instances. Empty list if type is valid but no elements exist.
# Raises: RuntimeError if type name is NOT in the IFC schema (e.g. "IfcFoo")

walls = model.by_type("IfcWall")        # Includes IfcWallStandardCase (subtype)
doors = model.by_type("IfcDoor")        # list of entity_instance
storeys = model.by_type("IfcBuildingStorey")

# Getting by GUID:
# model.by_guid(guid: str) -> ifcopenshell.entity_instance
# Raises: RuntimeError if GUID not found
element = model.by_guid("2O2Fr$t4X7Zf8NOew3FNr2")

# Getting by numeric ID:
# model.by_id(id: int) -> ifcopenshell.entity_instance
# Raises: RuntimeError if ID not found
```

### 1.3 Property Sets (get_psets / get_pset)

```python
import ifcopenshell.util.element

# --- get_psets: all property sets ---
# Signature:
# ifcopenshell.util.element.get_psets(
#     element: ifcopenshell.entity_instance,
#     psets_only: bool = False,      # True = exclude Qto_ sets
#     qtos_only: bool = False,       # True = only Qto_ sets
#     should_inherit: bool = True,   # True = inherit from type if occurrence has none
#     verbose: bool = False          # True = include entity instance IDs
# ) -> dict[str, dict[str, Any]]
#
# Returns nested dict: {"Pset_DoorCommon": {"FireRating": None, "IsExternal": False, ...}, ...}
# Each pset dict also contains an "id" key with the pset entity ID.

psets = ifcopenshell.util.element.get_psets(door)
# {"Pset_DoorCommon": {"id": 1234, "FireRating": None, "IsExternal": False}, ...}

# Properties only (no Qto_ sets):
props = ifcopenshell.util.element.get_psets(door, psets_only=True)

# Quantities only:
qtos = ifcopenshell.util.element.get_psets(door, qtos_only=True)
# {"Qto_DoorBaseQuantities": {"id": 5678, "Area": 1.89}, ...}

# --- get_pset: single property set or single property ---
# Signature:
# ifcopenshell.util.element.get_pset(
#     element: ifcopenshell.entity_instance,
#     name: str,                     # Pset name, e.g. "Pset_DoorCommon"
#     prop: Optional[str] = None,    # Specific property name; if None returns full dict
#     psets_only: bool = False,
#     qtos_only: bool = False,
#     should_inherit: bool = True,
#     verbose: bool = False
# ) -> Any | dict[str, Any]

fire_rating = ifcopenshell.util.element.get_pset(door, "Pset_DoorCommon", "FireRating")
# Returns the value directly (e.g. "FRL-60" or None)
```

### 1.4 Spatial Container (get_container)

```python
# Signature:
# ifcopenshell.util.element.get_container(
#     element: ifcopenshell.entity_instance,
#     should_get_direct: bool = False,  # True = only directly contained
#     ifc_class: Optional[str] = None   # Filter to specific container type
# ) -> ifcopenshell.entity_instance | None

container = ifcopenshell.util.element.get_container(wall)
if container:
    storey_name = container.Name  # e.g. "Level 1"
```

### 1.5 Type Element (get_type)

```python
# Signature:
# ifcopenshell.util.element.get_type(
#     element: ifcopenshell.entity_instance
# ) -> ifcopenshell.entity_instance | None
#
# Returns: the IfcTypeProduct (e.g. IfcDoorType, IfcWallType) or None
# If called on a type, returns the type itself.

element_type = ifcopenshell.util.element.get_type(door)
if element_type:
    type_name = element_type.Name  # e.g. "Single Swing 900x2100"
```

### 1.6 Material (get_material / get_materials)

```python
# --- get_material: returns the material assignment (may be a set or usage) ---
# Signature:
# ifcopenshell.util.element.get_material(
#     element: ifcopenshell.entity_instance,
#     should_skip_usage: bool = False,  # True = get underlying set, not usage
#     should_inherit: bool = True       # True = inherit from type if occurrence has none
# ) -> ifcopenshell.entity_instance | None
#
# IMPORTANT: Return type varies! Can be any of:
#   - IfcMaterial (single material)
#   - IfcMaterialLayerSetUsage (walls, slabs)
#   - IfcMaterialLayerSet (if should_skip_usage=True)
#   - IfcMaterialConstituentSet (IFC4 - doors, windows, furniture)
#   - IfcMaterialProfileSetUsage (beams, columns)
#   - IfcMaterialProfileSet (if should_skip_usage=True)
#   - IfcMaterialList (legacy)
#   - None (no material assigned)

material = ifcopenshell.util.element.get_material(element, should_inherit=True)

# --- get_materials: returns individual IfcMaterial instances from sets ---
# Signature:
# ifcopenshell.util.element.get_materials(
#     element: ifcopenshell.entity_instance,
#     should_inherit: bool = True
# ) -> list[ifcopenshell.entity_instance]
#
# Returns: list of IfcMaterial entities (unwrapped from sets). Empty list if none.

materials = ifcopenshell.util.element.get_materials(door)
# [<IfcMaterial Name="Solid Core Timber">, ...]
```

### 1.7 Geometry Processing

#### Settings Setup

```python
import ifcopenshell.geom

# Create settings:
settings = ifcopenshell.geom.settings()

# Key settings for quantity computation:
settings.set("use-world-coords", True)    # Apply object placements to geometry
settings.set("weld-vertices", True)       # Merge coincident vertices

# Settings are set using kebab-case string keys:
# settings.set("mesher-linear-deflection", 0.001)  # Mesh precision
```

#### Individual Element Processing (create_shape)

```python
# Signature:
# ifcopenshell.geom.create_shape(
#     settings: ifcopenshell.geom.settings,
#     inst: ifcopenshell.entity_instance,
#     repr: Optional[ifcopenshell.entity_instance] = None,
#     geometry_library: str = 'opencascade'
# ) -> ShapeElementType
#
# Returns a shape object with:
#   shape.guid                        - Element GlobalId
#   shape.id                          - Element STEP id
#   shape.transformation.matrix       - 4x4 transformation (flattened list)
#   shape.geometry                    - Geometry data object
#   shape.geometry.verts              - Flattened [v1x, v1y, v1z, v2x, ...] vertex coords
#   shape.geometry.faces              - Flattened [f1v1, f1v2, f1v3, ...] triangle indices
#   shape.geometry.edges              - Flattened edge indices
#   shape.geometry.materials          - List of style objects
#   shape.geometry.material_ids       - Per-triangle material index
#   shape.geometry.id                 - Geometry ID (for caching)
#
# IMPORTANT: Store a reference to shape to prevent garbage collection.
# May raise RuntimeError if geometry cannot be processed.

settings = ifcopenshell.geom.settings()
settings.set("use-world-coords", True)

shape = ifcopenshell.geom.create_shape(settings, wall)
geometry = shape.geometry  # Access triangulated geometry
```

#### Batch Processing (Iterator) -- for quantities command

```python
import multiprocessing

settings = ifcopenshell.geom.settings()
settings.set("use-world-coords", True)

# Constructor:
# ifcopenshell.geom.iterator(
#     settings: ifcopenshell.geom.settings,
#     file_or_filename: ifcopenshell.file | str,
#     num_threads: int = 1,
#     include: Optional[list[entity_instance] | list[str]] = None,
#     exclude: Optional[list[entity_instance] | list[str]] = None,
#     geometry_library: str = 'opencascade'
# )

# Create iterator with multicore processing:
walls = model.by_type("IfcWall")
iterator = ifcopenshell.geom.iterator(
    settings,
    model,
    multiprocessing.cpu_count(),
    include=walls  # Only process these elements
)

if iterator.initialize():
    while True:
        shape = iterator.get()
        # shape has same structure as create_shape result
        element = model.by_id(shape.id)
        geometry = shape.geometry

        if not iterator.next():
            break
```

### 1.8 Shape Utility Functions (ifcopenshell.util.shape)

All functions take a `geometry` object (the triangulated mesh from `shape.geometry`):

```python
import ifcopenshell.util.shape

# --- Volume ---
# get_volume(geometry: Triangulation) -> float
# Non-manifold geometry gives unpredictable results.
volume = ifcopenshell.util.shape.get_volume(shape.geometry)

# --- Side Area (elevational) ---
# get_side_area(
#     geometry: Triangulation,
#     axis: Literal['X', 'Y', 'Z'] = 'Y',
#     direction: Optional[VectorType] = None,
#     angle: float = 90.0
# ) -> float
# Calculates surface area visible from specified axis. Good for wall elevational area.
side_area = ifcopenshell.util.shape.get_side_area(shape.geometry)

# --- Footprint Area (plan projection) ---
# get_footprint_area(
#     geometry: Triangulation,
#     axis: Literal['X', 'Y', 'Z'] = 'Z',
#     direction: Optional[tuple[float,float,float]] = None
# ) -> float
# Projects onto XY plane. Good for slab/roof plan area.
footprint = ifcopenshell.util.shape.get_footprint_area(shape.geometry)

# --- Total Surface Area ---
# get_area(geometry: Triangulation) -> float
total_area = ifcopenshell.util.shape.get_area(shape.geometry)

# --- Top Area ---
# get_top_area(geometry: Triangulation) -> float
top_area = ifcopenshell.util.shape.get_top_area(shape.geometry)

# --- Bounding Box Dimensions ---
# get_x(geometry: Triangulation) -> float  (X dimension length)
# get_y(geometry: Triangulation) -> float  (Y dimension length)
# get_z(geometry: Triangulation) -> float  (Z dimension length)
x_dim = ifcopenshell.util.shape.get_x(shape.geometry)

# --- Other useful functions ---
# get_vertices(geometry) -> list of [x,y,z] grouped vertex coords
# get_faces(geometry) -> list of [v1,v2,v3] grouped face indices
# get_bbox(geometry) -> bounding box
# get_bbox_centroid(geometry) -> centroid of bounding box
```

---

## 2. Material Extraction Helper

The `get_material()` function returns different types depending on how the material is assigned in the IFC model. You MUST handle all cases. Here is the definitive helper function:

```python
def extract_material_name(element: ifcopenshell.entity_instance) -> str | None:
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
        names = [l.Material.Name for l in layers if l.Material]
        return ", ".join(names) if names else None

    if material.is_a("IfcMaterialLayerSet"):
        layers = material.MaterialLayers
        names = [l.Material.Name for l in layers if l.Material]
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
```

---

## 3. Error Handling

### 3.1 Exception Types in IfcOpenShell

| Exception | When Raised | Where |
|-----------|-------------|-------|
| `FileNotFoundError` | File path doesn't exist | Python built-in, raised before IfcOpenShell |
| `RuntimeError` | IFC file is malformed / cannot be parsed | `ifcopenshell.open()` |
| `RuntimeError` | Entity not found by GUID or ID | `model.by_guid()`, `model.by_id()` |
| `RuntimeError` | Type name not in IFC schema | `model.by_type("InvalidType")` |
| `ifcopenshell.SchemaError` | Unsupported IFC schema version | `ifcopenshell.open()` with e.g. IFC4X3 on older builds |
| `RuntimeError` | Geometry cannot be processed | `ifcopenshell.geom.create_shape()` |

### 3.2 Error Handling Strategy

All errors should produce structured JSON output on stderr, never raw stack traces. The CLI should follow this pattern:

```python
import sys
import json
import os
import time

def error_response(error_type: str, message: str, partial_results: bool = False,
                   elements: list | None = None) -> dict:
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

def safe_open(filepath: str) -> ifcopenshell.file:
    """Open an IFC file with comprehensive error handling."""
    if not os.path.isfile(filepath):
        print(json.dumps(error_response("file_not_found",
              f"File not found: {filepath}")), file=sys.stderr)
        sys.exit(1)

    try:
        model = ifcopenshell.open(filepath)
    except RuntimeError as e:
        print(json.dumps(error_response("parse_error",
              f"Failed to parse IFC file: {e}")), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        # Catches SchemaError and any other unexpected errors
        print(json.dumps(error_response("ifc_error",
              f"Error opening IFC file: {type(e).__name__}: {e}")), file=sys.stderr)
        sys.exit(1)

    return model

def safe_by_type(model: ifcopenshell.file, ifc_type: str) -> list:
    """Query elements by type with error handling for invalid type names."""
    try:
        return model.by_type(ifc_type)
    except RuntimeError:
        print(json.dumps(error_response("invalid_type",
              f"'{ifc_type}' is not a valid IFC entity type in schema {model.schema}")),
              file=sys.stderr)
        sys.exit(2)
```

### 3.3 Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success (including partial results with warnings) |
| 1 | Full failure (file not found, parse error, no results) |
| 2 | Invalid arguments (bad type name, missing required args) |

---

## 4. Argparse Structure

### 4.1 Overall Design

The CLI uses positional args for the IFC file path and subcommands. Global flags apply to all subcommands; command-specific flags are defined per subparser.

```python
import argparse

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ifc_extract",
        description="Extract structured data from IFC building models via IfcOpenShell."
    )
    parser.add_argument("ifc_file", help="Path to the IFC file")

    subparsers = parser.add_subparsers(dest="command", required=True,
                                        help="Command to execute")

    # ---- summary ----
    sub_summary = subparsers.add_parser("summary",
        help="Scan entire model, report all element types with counts")

    # ---- list ----
    sub_list = subparsers.add_parser("list",
        help="List all elements of a given type")
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
    sub_props = subparsers.add_parser("props",
        help="Get detailed properties for a specific element by GUID")
    sub_props.add_argument("guid",
        help="22-character IFC GlobalId")

    # ---- query ----
    sub_query = subparsers.add_parser("query",
        help="Filter elements by property value")
    sub_query.add_argument("element_type",
        help="IFC type name or shorthand")
    sub_query.add_argument("--property", required=True, dest="prop_path",
        help="Property path as Pset.PropertyName (e.g. Pset_WallCommon.IsExternal)")
    sub_query.add_argument("--value",
        help="Value to match (case-insensitive for strings)")
    sub_query.add_argument("--not-null", action="store_true",
        help="Match elements where property is not null/empty")
    sub_query.add_argument("--limit", type=int, default=None)
    sub_query.add_argument("--offset", type=int, default=0)
    sub_query.add_argument("--fields")
    sub_query.add_argument("--compact", action="store_true")
    sub_query.add_argument("--save", action="store_true")

    # ---- quantities ----
    sub_quantities = subparsers.add_parser("quantities",
        help="Pre-computed aggregates (counts, areas, volumes) grouped by storey/type")
    sub_quantities.add_argument("element_type",
        help="IFC type name or shorthand")
    sub_quantities.add_argument("--group-by", choices=["storey", "type"],
        help="Group results by storey or element type")
    sub_quantities.add_argument("--save", action="store_true")

    # ---- validate ----
    sub_validate = subparsers.add_parser("validate",
        help="Check IFC data quality (missing psets, proxies, orphans)")
    sub_validate.add_argument("--save", action="store_true")

    # ---- export ----
    sub_export = subparsers.add_parser("export",
        help="Export element data to CSV")
    sub_export.add_argument("element_type",
        help="IFC type name or shorthand")
    sub_export.add_argument("--output", required=True,
        help="Output CSV file path")
    sub_export.add_argument("--fields")
    sub_export.add_argument("--compact", action="store_true")

    return parser
```

### 4.2 Type Shorthand Mapping

```python
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

def resolve_type(type_arg: str) -> str:
    """Resolve shorthand to full IFC type name. Pass through unrecognised names as-is."""
    return TYPE_SHORTHAND.get(type_arg.lower(), type_arg)
```

---

## 5. Code Structure

### 5.1 Function/Module Layout

The file should be a single `src/cli/ifc_extract.py` script with clearly separated sections. No classes needed for PoC -- use module-level functions.

```
ifc_extract.py
│
├── CONSTANTS
│   ├── TYPE_SHORTHAND           (dict: shorthand -> IFC type)
│   ├── QTO_PREFERENCES          (dict: IFC type -> {area_prop, volume_prop, qto_set})
│   ├── BUILDING_ELEMENT_TYPES   (list of IFC types to include in summary)
│   └── PSET_EXPECTATIONS        (dict: IFC type -> expected pset name, for validate)
│
├── HELPERS
│   ├── resolve_type(type_arg)                -> str
│   ├── extract_material_name(element)        -> str | None
│   ├── extract_element_data(element, model)  -> dict
│   ├── apply_output_filters(elements, args)  -> list[dict]
│   ├── save_output(data, prefix, args)       -> None
│   ├── safe_open(filepath)                   -> ifcopenshell.file
│   ├── safe_by_type(model, ifc_type)         -> list
│   ├── error_response(...)                   -> dict
│   └── parse_property_path(path)             -> (pset_name, prop_name)
│
├── COMMAND FUNCTIONS
│   ├── cmd_summary(model, filepath, args)    -> dict
│   ├── cmd_list(model, args)                 -> dict
│   ├── cmd_props(model, args)                -> dict
│   ├── cmd_query(model, args)                -> dict
│   ├── cmd_quantities(model, args)           -> dict
│   ├── cmd_validate(model, filepath, args)   -> dict
│   └── cmd_export(model, args)               -> None (writes CSV)
│
├── ARGPARSE SETUP
│   └── build_parser()                        -> argparse.ArgumentParser
│
└── MAIN
    └── main()                                -> None
```

### 5.2 Constants

```python
# Quantity property preferences per element type (from spec section 4.1)
QTO_PREFERENCES = {
    "IfcWall":    {"area_prop": "NetSideArea",      "volume_prop": "NetVolume",  "qto_set": "Qto_WallBaseQuantities"},
    "IfcSlab":    {"area_prop": "NetArea",           "volume_prop": "NetVolume",  "qto_set": "Qto_SlabBaseQuantities"},
    "IfcDoor":    {"area_prop": "Area",              "volume_prop": None,         "qto_set": "Qto_DoorBaseQuantities"},
    "IfcWindow":  {"area_prop": "Area",              "volume_prop": None,         "qto_set": "Qto_WindowBaseQuantities"},
    "IfcRoof":    {"area_prop": "NetArea",           "volume_prop": None,         "qto_set": "Qto_RoofBaseQuantities"},
    "IfcColumn":  {"area_prop": "CrossSectionArea",  "volume_prop": "NetVolume",  "qto_set": "Qto_ColumnBaseQuantities"},
    "IfcBeam":    {"area_prop": "CrossSectionArea",  "volume_prop": "NetVolume",  "qto_set": "Qto_BeamBaseQuantities"},
}

# Building element types to scan in summary (these are the ones with cross-validation value)
BUILDING_ELEMENT_TYPES = [
    "IfcWall", "IfcDoor", "IfcWindow", "IfcSlab", "IfcRoof",
    "IfcColumn", "IfcBeam", "IfcStair", "IfcRailing", "IfcSpace",
    "IfcCovering", "IfcBuildingElementProxy", "IfcFurnishingElement",
    "IfcPlate", "IfcMember", "IfcCurtainWall", "IfcFooting",
]

# Expected property sets per element type (for validate command)
PSET_EXPECTATIONS = {
    "IfcDoor":    "Pset_DoorCommon",
    "IfcWindow":  "Pset_WindowCommon",
    "IfcWall":    "Pset_WallCommon",
    "IfcSlab":    "Pset_SlabCommon",
    "IfcRoof":    "Pset_RoofCommon",
    "IfcColumn":  "Pset_ColumnCommon",
    "IfcBeam":    "Pset_BeamCommon",
    "IfcStair":   "Pset_StairCommon",
    "IfcRailing": "Pset_RailingCommon",
    "IfcSpace":   "Pset_SpaceCommon",
    "IfcCovering":"Pset_CoveringCommon",
}
```

### 5.3 Core Helper: extract_element_data

This is the most important helper. It extracts all relevant data from a single IFC element into a flat dictionary matching the spec output format.

```python
def extract_element_data(element, model, compact=False):
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

    # Properties (Psets only, no Qtos)
    psets = ifcopenshell.util.element.get_psets(element, psets_only=True)
    # Remove the internal "id" key from each pset dict for clean output
    cleaned_psets = {}
    for pset_name, props in psets.items():
        cleaned_psets[pset_name] = {k: v for k, v in props.items() if k != "id"}
    data["properties"] = cleaned_psets

    # Quantities (Qtos only)
    qtos = ifcopenshell.util.element.get_psets(element, qtos_only=True)
    cleaned_qtos = {}
    for qto_name, props in qtos.items():
        cleaned_qtos[qto_name] = {k: v for k, v in props.items() if k != "id"}
    data["quantities"] = cleaned_qtos

    # Material
    data["material"] = extract_material_name(element)

    return data
```

---

## 6. Command Implementations

### 6.1 cmd_summary

```python
def cmd_summary(model, filepath, args):
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
```

### 6.2 cmd_list

```python
def cmd_list(model, args):
    """List all elements of a given type."""
    ifc_type = resolve_type(args.element_type)
    elements = safe_by_type(model, ifc_type)

    # Extract data for each element
    element_data = [extract_element_data(el, model, compact=args.compact) for el in elements]

    # Apply filters
    element_data = apply_output_filters(element_data, args)

    result = {
        "element_type": ifc_type,
        "count": len(elements),  # Total count before limit/offset
        "elements": element_data,
    }
    return result
```

### 6.3 cmd_props

```python
def cmd_props(model, args):
    """Get detailed properties for a specific element by GUID."""
    try:
        element = model.by_guid(args.guid)
    except RuntimeError:
        print(json.dumps(error_response("element_not_found",
              f"No element found with GUID: {args.guid}")), file=sys.stderr)
        sys.exit(1)

    data = extract_element_data(element, model, compact=False)
    data["ifc_class"] = element.is_a()  # e.g. "IfcDoor"
    return data
```

### 6.4 cmd_query

```python
def cmd_query(model, args):
    """Filter elements by property value."""
    ifc_type = resolve_type(args.element_type)
    elements = safe_by_type(model, ifc_type)

    pset_name, prop_name = parse_property_path(args.prop_path)

    matched = []
    for el in elements:
        value = ifcopenshell.util.element.get_pset(el, pset_name, prop_name)

        if args.not_null:
            # Match elements where property is not null/empty
            if value is not None and value != "" and value != "N/A":
                matched.append(el)
        elif args.value is not None:
            # Match by value (case-insensitive string comparison)
            if _values_match(value, args.value):
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

def parse_property_path(path: str) -> tuple[str, str]:
    """Parse 'Pset_DoorCommon.FireRating' into ('Pset_DoorCommon', 'FireRating')."""
    parts = path.split(".", 1)
    if len(parts) != 2:
        print(json.dumps(error_response("invalid_property_path",
              f"Property path must be in format 'PsetName.PropertyName', got: '{path}'")),
              file=sys.stderr)
        sys.exit(2)
    return parts[0], parts[1]

def _values_match(actual, expected_str: str) -> bool:
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
```

### 6.5 cmd_quantities (most complex)

This is the most important and complex command. It uses a hybrid approach: reads Qto_ property sets first, falls back to geometry computation for elements missing Qto_ data.

```python
def cmd_quantities(model, args):
    """Compute aggregated quantities (counts, areas, volumes) for an element type.

    Strategy (from spec):
    1. Read Qto_ property sets first (instant, authoritative)
    2. Fall back to geometry computation via ifcopenshell.util.shape for elements
       missing Qto_ data (~2% variance, slower)
    3. Track provenance in _source field
    """
    import multiprocessing

    start_time = time.time()
    ifc_type = resolve_type(args.element_type)
    elements = safe_by_type(model, ifc_type)

    prefs = QTO_PREFERENCES.get(ifc_type, {})
    qto_set_name = prefs.get("qto_set")
    area_prop = prefs.get("area_prop")
    volume_prop = prefs.get("volume_prop")

    # Phase 1: Extract from Qto_ property sets
    qto_elements = []     # Elements with Qto data
    missing_elements = [] # Elements needing geometry fallback

    area_total_qto = 0.0
    volume_total_qto = 0.0

    # Per-storey and per-type accumulators
    by_storey = {}  # storey_name -> {count, area, volume}
    by_type = {}    # type_name -> {count, area, volume}

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
        settings = ifcopenshell.geom.settings()
        settings.set("use-world-coords", True)

        iterator = ifcopenshell.geom.iterator(
            settings,
            model,
            multiprocessing.cpu_count(),
            include=missing_elements
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
                        # Choose geometry function based on element type
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

    # Build result
    total_area = round(area_total_qto + area_total_computed, 1) if area_prop else None
    total_volume = round(volume_total_qto + volume_total_computed, 1) if volume_prop else None

    totals = {"count": len(elements)}
    source = {}

    if area_prop:
        area_key = f"total_{area_prop.lower()}_m2"  # e.g. total_net_side_area_m2
        # Convert camelCase to snake_case for the key
        area_key = f"total_{_camel_to_snake(area_prop)}_m2"
        totals[area_key] = total_area
        source["area"] = f"qto ({len(qto_elements)}), computed ({len(missing_elements) - geometry_errors})"

    if volume_prop:
        volume_key = f"total_{_camel_to_snake(volume_prop)}_m3"
        totals[volume_key] = total_volume
        source["volume"] = f"qto ({len(qto_elements)}), computed ({len(missing_elements) - geometry_errors})"

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
        "qto_coverage": f"{len(qto_elements)} of {len(elements)} elements have {qto_set_name}" if qto_set_name else "No standard Qto set defined",
        "geometry_fallback_count": len(missing_elements),
        "geometry_errors": geometry_errors,
        "compute_time_seconds": round(time.time() - start_time, 1),
    }
    return result

def _camel_to_snake(name: str) -> str:
    """Convert CamelCase to snake_case. E.g. NetSideArea -> net_side_area."""
    import re
    s1 = re.sub(r'(.)([A-Z][a-z]+)', r'\1_\2', name)
    return re.sub(r'([a-z0-9])([A-Z])', r'\1_\2', s1).lower()
```

### 6.6 cmd_validate

```python
def cmd_validate(model, filepath, args):
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
        pset_pct = f"{round(with_pset/total*100)}%" if total > 0 else "0%"

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
            proxy_info = [{"guid": p.GlobalId, "name": getattr(p, "Name", None)} for p in proxies[:10]]
            issues.append({
                "severity": "warn",
                "type": "proxy_elements",
                "message": f"{len(proxies)} IfcBuildingElementProxy elements found - may be misclassified",
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
                    no_storey.append({"guid": el.GlobalId, "name": getattr(el, "Name", None),
                                      "type": el.is_a()})
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
```

### 6.7 cmd_export

```python
def cmd_export(model, args):
    """Export element data to CSV using pandas."""
    import pandas as pd

    ifc_type = resolve_type(args.element_type)
    elements = safe_by_type(model, ifc_type)

    rows = []
    for el in elements:
        data = extract_element_data(el, model, compact=args.compact)

        # Flatten properties into columns for CSV
        flat = {
            "guid": data["guid"],
            "name": data["name"],
            "type_name": data["type_name"],
            "storey": data["storey"],
            "material": data.get("material"),
        }

        if not args.compact:
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
    if args.fields:
        requested = [f.strip() for f in args.fields.split(",")]
        available = [c for c in requested if c in df.columns]
        df = df[available]

    df.to_csv(args.output, index=False)

    # Print confirmation to stdout
    print(json.dumps({
        "exported": True,
        "element_type": ifc_type,
        "count": len(rows),
        "output_file": args.output,
        "columns": list(df.columns),
    }))
```

---

## 7. Output Filtering Helpers

```python
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
                    # Check inside properties dicts for dotted field names
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

    from datetime import datetime

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
```

---

## 8. Main Function

```python
def main():
    parser = build_parser()
    args = parser.parse_args()

    # Open the IFC file
    model = safe_open(args.ifc_file)

    # Dispatch to command handler
    command_map = {
        "summary":    lambda: cmd_summary(model, args.ifc_file, args),
        "list":       lambda: cmd_list(model, args),
        "props":      lambda: cmd_props(model, args),
        "query":      lambda: cmd_query(model, args),
        "quantities": lambda: cmd_quantities(model, args),
        "validate":   lambda: cmd_validate(model, args.ifc_file, args),
        "export":     lambda: cmd_export(model, args),
    }

    handler = command_map.get(args.command)
    if handler is None:
        print(json.dumps(error_response("unknown_command",
              f"Unknown command: {args.command}")), file=sys.stderr)
        sys.exit(2)

    result = handler()

    # Export command handles its own output
    if args.command == "export":
        return

    # Save if --save flag is set
    saved_path = save_output(result, args.command, args)
    if saved_path:
        result["_saved_to"] = saved_path

    # Print JSON to stdout
    print(json.dumps(result, indent=2, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
```

---

## 9. Performance Notes

### 9.1 Geometry Iterator Threading

- The `ifcopenshell.geom.iterator` constructor takes `num_threads` as its third positional argument.
- Use `multiprocessing.cpu_count()` for the thread count. This uses C++ level threading, not Python multiprocessing, so it is NOT subject to the GIL.
- The iterator's `initialize()` method can be slow (it collects all shapes before multiprocessing begins). This is a known bottleneck.
- Memory usage climbs continuously during iteration. For very large files (>500MB), consider processing in batches by element type.
- The `include` parameter is critical for performance: only pass the elements that actually need geometry processing (i.e., those missing Qto_ data).

### 9.2 When Geometry Is Needed

- The `quantities` command is the ONLY command that needs geometry processing.
- Only elements MISSING Qto_ property sets need geometry fallback.
- In typical models, 90%+ of elements have Qto_ data, so geometry fallback affects ~10% of elements.
- Never process geometry for the `list`, `props`, `query`, `summary`, or `validate` commands.

### 9.3 File Loading

- `ifcopenshell.open()` loads the entire file into memory. A 116MB IFC file uses ~500MB-1GB RAM.
- Parse time for a 116MB file is typically 3-5 seconds.
- The file object is NOT pickleable (cannot be serialized for multiprocessing). The geometry iterator handles threading internally at the C++ level.

---

## 10. Edge Cases and Gotchas

### 10.1 Property Sets

- `get_psets()` returns an `"id"` key in every pset dict. **Strip this** before outputting to the user -- it's an internal entity ID, not a property.
- `should_inherit=True` (the default) means occurrence-level elements inherit psets from their type. This is almost always what you want.
- Some Revit exports store properties in custom pset names like `"Revit_Door_Common"` instead of `"Pset_DoorCommon"`. The validate command should note this but the tool doesn't need to remap them for PoC.

### 10.2 Materials

- Always pass `should_inherit=True` to `get_material()` -- otherwise doors/windows often return None because the material is assigned to the type, not the occurrence.
- The return type of `get_material()` varies (6+ possible types). The `extract_material_name()` helper handles all cases. Never assume it returns `IfcMaterial`.
- Some elements have no material at all. Return `None`, not an error.

### 10.3 Storeys

- Some elements have no spatial container (orphaned). `get_container()` returns `None`.
- Use `"Unassigned"` as the storey name for these elements in quantity grouping.

### 10.4 Element Types

- `by_type("IfcWall")` includes `IfcWallStandardCase` (an IFC2X3 subtype). This is correct behavior due to `include_subtypes=True` default.
- Passing an invalid type name to `by_type()` raises `RuntimeError`. Catch this and return structured error.
- The type shorthand resolver should be case-insensitive: `door`, `Door`, `DOOR` all map to `IfcDoor`.

### 10.5 Geometry

- `get_volume()` on non-manifold geometry returns unpredictable results. Wrap in try/except.
- `get_side_area()` defaults to Y axis, which gives the elevational area for walls (assuming standard orientation).
- `get_footprint_area()` defaults to Z axis, which gives the plan area for slabs/roofs.
- Some elements have no geometry (e.g., `IfcSpace` may be defined only by boundaries). `create_shape()` may raise `RuntimeError`. Always wrap geometry calls in try/except.

### 10.6 JSON Serialization

- IFC property values can be Python `bool`, `int`, `float`, `str`, `None`, or `tuple`.
- Tuples (from IfcPropertyBoundedValue etc.) need special handling. Use `default=str` in `json.dumps()` as a fallback.
- Some property values are entity instances. These need to be converted to strings or their `.Name` attribute extracted.

---

## 11. Imports Summary

```python
#!/usr/bin/env python3
"""ifc_extract.py - CLI tool for extracting structured data from IFC building models.

Wraps IfcOpenShell to query IFC files and return structured JSON.
Part of the BuildBrain project.
"""

import argparse
import json
import multiprocessing
import os
import re
import sys
import time
from typing import Any

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element
import ifcopenshell.util.shape

# pandas is only needed for the export command
# import pandas as pd  -- imported lazily in cmd_export
```

---

## 12. Testing Notes

- Test with IfcOpenShell sample files from https://github.com/IfcOpenShell/IfcOpenShell/tree/v0.8.0/test/input
- Also test with buildingSMART sample models (various export tools = various Pset coverage levels)
- Key test scenarios:
  1. File with full Pset coverage (all properties populated)
  2. File with empty Psets (common in Revit exports)
  3. File with IfcBuildingElementProxy elements
  4. File with missing Qto_ sets (triggers geometry fallback)
  5. Invalid file path
  6. Invalid element type name
  7. GUID lookup for non-existent GUID
  8. Query with `--not-null` on sparse properties
  9. Large file (>100MB) performance
  10. IFC2X3 vs IFC4 schema differences

---

## References

- [IfcOpenShell 0.8.4 API Reference](https://docs.ifcopenshell.org/autoapi/index.html)
- [ifcopenshell.util.element](https://docs.ifcopenshell.org/autoapi/ifcopenshell/util/element/)
- [ifcopenshell.util.shape](https://docs.ifcopenshell.org/autoapi/ifcopenshell/util/shape/index.html)
- [Geometry Processing](https://docs.ifcopenshell.org/ifcopenshell-python/geometry_processing.html)
- [Geometry Iterator](https://docs.ifcopenshell.org/ifcopenshell/geometry_iterator.html)
- [Geometry Settings](https://docs.ifcopenshell.org/ifcopenshell/geometry_settings.html)
- [Code Examples](https://docs.ifcopenshell.org/ifcopenshell-python/code_examples.html)
- [ifcopenshell.file](https://docs.ifcopenshell.org/autoapi/ifcopenshell/file/index.html)
- [OSArch Material Extraction](https://community.osarch.org/discussion/510/ifcopenshell-get-wall-layers-and-materials)
- [IfcOpenShell Geometry Iterator Memory Issue #6905](https://github.com/IfcOpenShell/IfcOpenShell/issues/6905)
- [IfcOpenShell SchemaError Issue #6886](https://github.com/IfcOpenShell/IfcOpenShell/issues/6886)
