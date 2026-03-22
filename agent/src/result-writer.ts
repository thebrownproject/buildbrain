import { config } from "./config.js";
import type {
  ConvexClientWrapper,
  ElementRef,
} from "./convex-client.js";

interface WriteContext {
  projectId: string;
  threadId: string;
  messageId: string;
  fileId?: string;
  sourceFile?: string;
}

/** Column order preferences per element type */
const COLUMN_ORDERS: Record<string, { columns: string[]; labels: Record<string, string> }> = {
  IfcDoor: {
    columns: ["name", "storey", "type_name", "material", "quantities.Qto_DoorBaseQuantities.Area"],
    labels: { name: "Mark", storey: "Level", type_name: "Type", material: "Material" },
  },
  IfcWindow: {
    columns: ["name", "storey", "type_name", "material"],
    labels: { name: "Mark", storey: "Level", type_name: "Type", material: "Material" },
  },
  IfcWall: {
    columns: ["name", "storey", "type_name", "material"],
    labels: { name: "Name", storey: "Level", type_name: "Type", material: "Material" },
  },
};

function getColumnConfig(elementType: string) {
  return COLUMN_ORDERS[elementType] ?? {
    columns: ["name", "storey", "type_name", "material"],
    labels: { name: "Name", storey: "Level", type_name: "Type", material: "Material" },
  };
}

function humanName(ifcType: string): string {
  return ifcType.replace(/^Ifc/, "").replace(/([a-z])([A-Z])/g, "$1 $2") + "s";
}

export async function writeElementList(
  toolResult: any,
  ctx: WriteContext,
  convex: ConvexClientWrapper,
): Promise<{ artifactId: string; elementRefs: ElementRef[] }> {
  const elements: any[] = toolResult.elements ?? [];
  const elementType: string = toolResult.element_type ?? "Unknown";
  const columnConfig = getColumnConfig(elementType);

  // Create element group (status: partial until all elements inserted)
  const groupId = await convex.createElementGroup({
    projectId: ctx.projectId,
    fileId: ctx.fileId ?? "",
    elementType,
    displayName: humanName(elementType),
    count: elements.length,
    columnOrder: columnConfig.columns,
    columnLabels: columnConfig.labels,
  });

  // Batch insert elements
  for (let i = 0; i < elements.length; i += config.elementBatchSize) {
    const batch = elements.slice(i, i + config.elementBatchSize).map((el: any) => ({
      globalId: el.guid ?? "",
      name: el.name,
      properties: {
        name: el.name,
        storey: el.storey,
        type_name: el.type_name,
        material: el.material,
        ...flattenProperties(el.properties),
        ...flattenQuantities(el.quantities),
      },
    }));

    await convex.batchInsertElements(groupId, ctx.projectId, batch);
  }

  await convex.markElementGroupComplete(groupId);

  // Create artifact for the Artifacts tab
  const contentInline = elements.length <= 200 ? toolResult : undefined;
  const artifactId = await convex.createArtifact({
    projectId: ctx.projectId,
    threadId: ctx.threadId,
    messageId: ctx.messageId,
    name: `${humanName(elementType)} - ${elementType}`,
    type: "element_list",
    format: "json",
    status: "complete",
    createdBy: "agent",
    summary: `${elements.length} ${humanName(elementType).toLowerCase()} extracted`,
    contentInline,
    elementType,
    sourceFile: ctx.sourceFile,
  });

  // Collect element refs for 3D highlighting
  const elementRefs: ElementRef[] = elements
    .filter((el: any) => el.guid)
    .map((el: any) => ({
      globalId: el.guid,
      label: el.name,
    }));

  return { artifactId, elementRefs };
}

export async function writeQuantityTakeoff(
  toolResult: any,
  ctx: WriteContext,
  convex: ConvexClientWrapper,
): Promise<string> {
  return convex.createArtifact({
    projectId: ctx.projectId,
    threadId: ctx.threadId,
    messageId: ctx.messageId,
    name: `QTO - ${toolResult.element_type ?? "Elements"}`,
    type: "quantity_takeoff",
    format: "json",
    status: "complete",
    createdBy: "agent",
    summary: `${toolResult.totals?.count ?? 0} elements, ${toolResult.totals?.total_net_side_area_m2 ?? toolResult.totals?.total_area_m2 ?? "N/A"} m2`,
    contentInline: toolResult,
    elementType: toolResult.element_type,
    sourceFile: ctx.sourceFile,
  });
}

export async function writePdfSchedule(
  toolResult: any,
  ctx: WriteContext,
  convex: ConvexClientWrapper,
): Promise<string> {
  const schedules = toolResult.schedules_found ?? [];
  const summary = schedules
    .map((s: any) => `${s.type} (p.${s.page}, ${s.row_count} rows)`)
    .join(", ");

  return convex.createArtifact({
    projectId: ctx.projectId,
    threadId: ctx.threadId,
    messageId: ctx.messageId,
    name: "PDF Schedules",
    type: "pdf_schedule",
    format: "json",
    status: "complete",
    createdBy: "agent",
    summary: summary || "No schedules found",
    contentInline: toolResult,
    sourceFile: ctx.sourceFile,
  });
}

export async function writeModelSummary(
  toolResult: any,
  ctx: WriteContext,
  convex: ConvexClientWrapper,
): Promise<string> {
  const counts = toolResult.element_counts ?? {};
  const total = Object.values(counts).reduce(
    (sum: number, n) => sum + (n as number),
    0,
  );

  return convex.createArtifact({
    projectId: ctx.projectId,
    threadId: ctx.threadId,
    messageId: ctx.messageId,
    name: `Model Summary - ${toolResult.project_name ?? toolResult.file ?? "IFC"}`,
    type: "model_summary",
    format: "json",
    status: "complete",
    createdBy: "agent",
    summary: `${total} elements across ${toolResult.storeys?.length ?? 0} storeys (${toolResult.schema ?? "IFC"})`,
    contentInline: toolResult,
    sourceFile: ctx.sourceFile,
  });
}

export async function writeValidationIssues(
  toolResult: any,
  artifactId: string | undefined,
  ctx: WriteContext,
  convex: ConvexClientWrapper,
): Promise<void> {
  const issues: any[] = toolResult.issues ?? [];
  for (const issue of issues) {
    await convex.createIssue({
      projectId: ctx.projectId,
      artifactId,
      severity: issue.severity === "warn" ? "warning" : issue.severity ?? "info",
      title: issue.message ?? issue.type ?? "Validation issue",
      description: `${issue.message}${issue.affected_count ? ` (${issue.affected_count} elements)` : ""}`,
      source: "IFC Validation",
      elementRef: issue.element_type,
    });
  }
}

/** Flatten nested property sets into dot-notation keys */
function flattenProperties(props?: Record<string, Record<string, unknown>>): Record<string, unknown> {
  if (!props) return {};
  const flat: Record<string, unknown> = {};
  for (const [pset, values] of Object.entries(props)) {
    if (typeof values === "object" && values !== null) {
      for (const [key, val] of Object.entries(values)) {
        flat[`${pset}.${key}`] = val;
      }
    }
  }
  return flat;
}

/** Flatten quantity sets into dot-notation keys */
function flattenQuantities(qtos?: Record<string, Record<string, unknown>>): Record<string, unknown> {
  if (!qtos) return {};
  const flat: Record<string, unknown> = {};
  for (const [qset, values] of Object.entries(qtos)) {
    if (typeof values === "object" && values !== null) {
      for (const [key, val] of Object.entries(values)) {
        flat[`${qset}.${key}`] = val;
      }
    }
  }
  return flat;
}
