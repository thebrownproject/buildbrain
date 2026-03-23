"use node";

// ── IFC Material Extraction ─────────────────────────────────────────────────
// Extracts material names from IFC elements, handling all 6 IFC material
// association patterns plus type product inheritance.
// No Convex actions/mutations — pure library functions.

import * as WebIFC from "web-ifc";

// web-ifc type constants for material types
const IFCMATERIAL = 1838606355;
const IFCMATERIALLAYERSETUSAGE = WebIFC.IFCMATERIALLAYERSETUSAGE;
const IFCMATERIALLAYERSET = WebIFC.IFCMATERIALLAYERSET;
const IFCMATERIALCONSTITUENTSET = WebIFC.IFCMATERIALCONSTITUENTSET;
const IFCMATERIALPROFILESETUSAGE = WebIFC.IFCMATERIALPROFILESETUSAGE;
const IFCMATERIALPROFILESET = WebIFC.IFCMATERIALPROFILESET;
const IFCMATERIALLIST = WebIFC.IFCMATERIALLIST;

/**
 * Get the material name(s) for an IFC element.
 *
 * Uses `ifcApi.properties.getMaterialsProperties(modelId, expressId, true)`
 * and handles all 6 IFC material association patterns:
 *
 * 1. IFCMATERIAL — single material, return Name
 * 2. IFCMATERIALLAYERSETUSAGE — resolve ForLayerSet, join layer material Names
 * 3. IFCMATERIALLAYERSET — join layer material Names
 * 4. IFCMATERIALCONSTITUENTSET — join constituent material Names
 * 5. IFCMATERIALPROFILESETUSAGE — resolve ForProfileSet, join profile material Names
 * 6. IFCMATERIALPROFILESET — join profile material Names
 * 7. IFCMATERIALLIST — join Materials Names
 *
 * Falls back to checking the type product for inherited materials.
 *
 * @returns Comma-separated string for multi-material, or null if none found.
 */
export async function getMaterialName(
  ifcApi: WebIFC.IfcAPI,
  modelId: number,
  expressId: number
): Promise<string | null> {
  try {
    const materials = await ifcApi.properties.getMaterialsProperties(
      modelId,
      expressId,
      true
    );

    if (Array.isArray(materials) && materials.length > 0) {
      const names = extractMaterialNames(materials);
      if (names.length > 0) {
        return names.join(", ");
      }
    }

    // Fallback: check type product for inherited materials
    return await getMaterialFromType(ifcApi, modelId, expressId);
  } catch {
    return null;
  }
}

// ── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Extract material names from the raw materials properties array.
 * Handles all IFC material association patterns by checking the `type` field.
 */
function extractMaterialNames(
  materials: Record<string, unknown>[]
): string[] {
  const names: string[] = [];

  for (const mat of materials) {
    if (!mat || typeof mat !== "object") continue;

    const matType = mat.type as number | undefined;

    switch (matType) {
      // 1. IFCMATERIAL — single material
      case IFCMATERIAL: {
        const name = getStringProp(mat, "Name");
        if (name) names.push(name);
        break;
      }

      // 2. IFCMATERIALLAYERSETUSAGE — resolve ForLayerSet then get layers
      case IFCMATERIALLAYERSETUSAGE: {
        const layerSet = mat.ForLayerSet as Record<string, unknown> | undefined;
        if (layerSet) {
          const layerNames = extractLayerSetNames(layerSet);
          names.push(...layerNames);
        }
        break;
      }

      // 3. IFCMATERIALLAYERSET — direct layer set
      case IFCMATERIALLAYERSET: {
        const layerNames = extractLayerSetNames(mat);
        names.push(...layerNames);
        break;
      }

      // 4. IFCMATERIALCONSTITUENTSET — join constituent material Names
      case IFCMATERIALCONSTITUENTSET: {
        const constituents = mat.MaterialConstituents as
          | Record<string, unknown>[]
          | undefined;
        if (Array.isArray(constituents)) {
          for (const constituent of constituents) {
            const constituentMat = constituent?.Material as
              | Record<string, unknown>
              | undefined;
            if (constituentMat) {
              const name = getStringProp(constituentMat, "Name");
              if (name) names.push(name);
            }
          }
        }
        break;
      }

      // 5. IFCMATERIALPROFILESETUSAGE — resolve ForProfileSet then get profiles
      case IFCMATERIALPROFILESETUSAGE: {
        const profileSet = mat.ForProfileSet as
          | Record<string, unknown>
          | undefined;
        if (profileSet) {
          const profileNames = extractProfileSetNames(profileSet);
          names.push(...profileNames);
        }
        break;
      }

      // 6. IFCMATERIALPROFILESET — direct profile set
      case IFCMATERIALPROFILESET: {
        const profileNames = extractProfileSetNames(mat);
        names.push(...profileNames);
        break;
      }

      // 7. IFCMATERIALLIST — join Materials Names
      case IFCMATERIALLIST: {
        const matList = mat.Materials as
          | Record<string, unknown>[]
          | undefined;
        if (Array.isArray(matList)) {
          for (const m of matList) {
            const name = getStringProp(m, "Name");
            if (name) names.push(name);
          }
        }
        break;
      }

      default: {
        // Unknown material type — try to extract Name directly
        const name = getStringProp(mat, "Name");
        if (name) names.push(name);
        break;
      }
    }
  }

  // Deduplicate while preserving order
  return Array.from(new Set(names));
}

/**
 * Extract material names from an IfcMaterialLayerSet.
 * Walks the MaterialLayers array and gets each layer's Material.Name.
 */
function extractLayerSetNames(
  layerSet: Record<string, unknown>
): string[] {
  const names: string[] = [];
  const layers = layerSet.MaterialLayers as
    | Record<string, unknown>[]
    | undefined;

  if (Array.isArray(layers)) {
    for (const layer of layers) {
      const layerMat = layer?.Material as
        | Record<string, unknown>
        | undefined;
      if (layerMat) {
        const name = getStringProp(layerMat, "Name");
        if (name) names.push(name);
      }
    }
  }

  return names;
}

/**
 * Extract material names from an IfcMaterialProfileSet.
 * Walks the MaterialProfiles array and gets each profile's Material.Name.
 */
function extractProfileSetNames(
  profileSet: Record<string, unknown>
): string[] {
  const names: string[] = [];
  const profiles = profileSet.MaterialProfiles as
    | Record<string, unknown>[]
    | undefined;

  if (Array.isArray(profiles)) {
    for (const profile of profiles) {
      const profileMat = profile?.Material as
        | Record<string, unknown>
        | undefined;
      if (profileMat) {
        const name = getStringProp(profileMat, "Name");
        if (name) names.push(name);
      }
    }
  }

  return names;
}

/**
 * Fallback: check type product for inherited materials.
 * Some elements inherit their material from the type rather than
 * having a direct material association.
 */
async function getMaterialFromType(
  ifcApi: WebIFC.IfcAPI,
  modelId: number,
  expressId: number
): Promise<string | null> {
  try {
    const typeProps = await ifcApi.properties.getTypeProperties(
      modelId,
      expressId,
      true
    );

    if (!Array.isArray(typeProps) || typeProps.length === 0) return null;

    const typeObj = typeProps[0];
    if (!typeObj || typeof typeObj !== "object") return null;
    if (typeof typeObj.expressID !== "number") return null;

    // Get materials for the type product
    const typeMaterials = await ifcApi.properties.getMaterialsProperties(
      modelId,
      typeObj.expressID,
      true
    );

    if (Array.isArray(typeMaterials) && typeMaterials.length > 0) {
      const names = extractMaterialNames(
        typeMaterials as Record<string, unknown>[]
      );
      if (names.length > 0) return names.join(", ");
    }
  } catch {
    // Type material lookup can fail
  }

  return null;
}

/**
 * Safely get a string property from an IFC object.
 * Handles both raw strings and { value: "string" } wrappers.
 */
function getStringProp(
  obj: Record<string, unknown>,
  key: string
): string | null {
  const val = obj[key];
  if (val === null || val === undefined) return null;
  if (typeof val === "string") return val || null;
  if (typeof val === "object" && val !== null && "value" in val) {
    const v = (val as Record<string, unknown>).value;
    return typeof v === "string" && v ? v : null;
  }
  return null;
}
