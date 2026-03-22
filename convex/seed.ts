/**
 * Seed data for testing Convex queries.
 * Run via: npx convex run seed:run
 */
import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

export const run = internalAction({
  args: {},
  handler: async (ctx): Promise<Record<string, unknown>> => {
    // Delegate to mutation, passing storage IDs for placeholder files
    const ifcStorageId = await ctx.storage.store(
      new Blob(["PLACEHOLDER_IFC"], { type: "application/octet-stream" })
    );
    const pdfStorageId = await ctx.storage.store(
      new Blob(["PLACEHOLDER_PDF"], { type: "application/pdf" })
    );
    const result: Record<string, unknown> = await ctx.runMutation(
      internal.seed.seedData,
      { ifcStorageId, pdfStorageId }
    );
    return result;
  },
});

export const seedData = internalMutation({
  args: {
    ifcStorageId: v.id("_storage"),
    pdfStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    // ── User ──────────────────────────────────────────────
    const userId = await ctx.db.insert("users", {
      clerkId: "seed_user_001",
      name: "Fraser Brown",
      email: "fraser@buildbrain.dev",
      preferences: {
        dockviewLayout: undefined,
        lastProjectId: undefined,
      },
    });

    // ── Project ───────────────────────────────────────────
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      name: "Clinic Project - Office A",
      description: "3-storey commercial office building, Class 5, Type A construction",
      ownerId: userId,
      metadata: {
        buildingClass: "Class 5",
        state: "VIC",
        constructionType: "Type A",
      },
      createdAt: now,
      updatedAt: now,
    });

    // ── IFC File ──────────────────────────────────────────
    const ifcFileId = await ctx.db.insert("files", {
      projectId,
      storageId: args.ifcStorageId,
      name: "clinic-project.ifc",
      type: "ifc",
      sizeBytes: 87_000_000,
      uploadedBy: userId,
      uploadedAt: now - 3600_000,
      revisionNumber: 1,
      ifcSchema: "IFC4",
      elementCounts: {
        IfcWall: 156,
        IfcDoor: 47,
        IfcWindow: 69,
        IfcSlab: 12,
        IfcColumn: 34,
        IfcBeam: 28,
        IfcStair: 4,
        IfcRailing: 8,
        IfcSpace: 42,
      },
      storeyNames: ["Ground Floor", "Level 1", "Level 2"],
      validationScore: 78,
    });

    // ── PDF File ──────────────────────────────────────────
    const pdfFileId = await ctx.db.insert("files", {
      projectId,
      storageId: args.pdfStorageId,
      name: "clinic-drawings-A2.pdf",
      type: "pdf",
      sizeBytes: 15_000_000,
      uploadedBy: userId,
      uploadedAt: now - 3600_000,
      revisionNumber: 1,
      pageCount: 48,
      schedulesFound: [
        { type: "door_schedule", page: 12, rowCount: 47 },
        { type: "window_schedule", page: 14, rowCount: 69 },
        { type: "finish_schedule", page: 16, rowCount: 42 },
      ],
    });

    // ── Thread ────────────────────────────────────────────
    const threadId = await ctx.db.insert("threads", {
      projectId,
      userId,
      title: "Initial model review",
      contextSummary:
        "Reviewing clinic-project.ifc (IFC4, 3 storeys). 47 doors, 69 windows. PDF has matching schedules on pages 12-16. Validation score 78/100 - some missing property sets.",
      createdAt: now - 1800_000,
      updatedAt: now - 60_000,
    });

    // ── Messages ──────────────────────────────────────────
    const userMsg1 = await ctx.db.insert("messages", {
      threadId,
      role: "user",
      content: "How many doors are in the model?",
      status: "complete",
      createdAt: now - 1800_000,
    });

    const assistantMsg1 = await ctx.db.insert("messages", {
      threadId,
      role: "assistant",
      content:
        "The model contains **47 doors** across 3 storeys:\n\n- Ground Floor: 18 doors\n- Level 1: 16 doors\n- Level 2: 13 doors\n\nMost are single swing (900x2100mm). 12 doors have fire ratings specified, 35 have null fire rating values.",
      status: "complete",
      toolCalls: [
        {
          id: "tc_001",
          tool: "ifc_extract",
          displayName: "Extracting doors from clinic-project.ifc",
          args: { command: "list", type: "door" },
          result: "47 doors found",
          status: "complete" as const,
          ephemeral: false,
        },
      ],
      suggestions: [
        { label: "Cross-validate doors vs PDF", prompt: "Cross-validate the door data against the PDF door schedule" },
        { label: "Show fire-rated doors", prompt: "Which doors have fire ratings?" },
        { label: "Generate door schedule", prompt: "Generate a door schedule report" },
      ],
      createdAt: now - 1740_000,
    });

    const userMsg2 = await ctx.db.insert("messages", {
      threadId,
      role: "user",
      content: "Cross-validate the door data against the PDF door schedule",
      status: "complete",
      createdAt: now - 1680_000,
    });

    const assistantMsg2 = await ctx.db.insert("messages", {
      threadId,
      role: "assistant",
      content:
        "Cross-validation complete. **3 issues found:**\n\n- **WARN:** FRL mismatch on D04 - IFC shows null, PDF specifies -/60/30\n- **WARN:** D12 missing from IFC model but present in PDF schedule\n- **INFO:** 12 doors have no fire rating in IFC (PDF specifies ratings for all)\n\n42 of 47 doors match between IFC and PDF.",
      status: "complete",
      toolCalls: [
        {
          id: "tc_002",
          tool: "pdf_extract",
          displayName: "Extracting door schedule from drawings",
          args: { command: "tables", pages: "12-13" },
          result: "47 rows extracted",
          status: "complete" as const,
        },
        {
          id: "tc_003",
          tool: "cross_validate",
          displayName: "Comparing IFC doors vs PDF schedule",
          args: { elementType: "door" },
          result: "3 issues found",
          status: "complete" as const,
        },
      ],
      createdAt: now - 1620_000,
    });

    // ── Element Groups + Elements (doors) ─────────────────
    const doorGroupId = await ctx.db.insert("elementGroups", {
      projectId,
      fileId: ifcFileId,
      elementType: "IfcDoor",
      displayName: "Doors",
      count: 5, // seed subset
      columnOrder: ["mark", "level", "size", "type", "frl", "hardware", "material"],
      columnLabels: {
        mark: "Mark",
        level: "Level",
        size: "Size (WxH)",
        type: "Type",
        frl: "Fire Rating",
        hardware: "Hardware",
        material: "Material",
      },
      status: "complete",
      extractedAt: now - 1740_000,
    });

    const seedDoors = [
      { globalId: "2O2Fr$t4X7Zf8NOew3FNr0", name: "D01", properties: { mark: "D01", level: "Ground Floor", size: "900x2100", type: "Single Swing", frl: "-", hardware: "Lever Set", material: "Solid Core Timber" } },
      { globalId: "2O2Fr$t4X7Zf8NOew3FNr1", name: "D02", properties: { mark: "D02", level: "Ground Floor", size: "900x2100", type: "Single Swing", frl: "-/60/30", hardware: "Lever Set + Closer", material: "Solid Core Timber" } },
      { globalId: "2O2Fr$t4X7Zf8NOew3FNr2", name: "D03", properties: { mark: "D03", level: "Ground Floor", size: "1200x2100", type: "Double Swing", frl: "-", hardware: "Push Plate", material: "Aluminium Frame" } },
      { globalId: "2O2Fr$t4X7Zf8NOew3FNr3", name: "D04", properties: { mark: "D04", level: "Level 1", size: "900x2100", type: "Single Swing", frl: "-", hardware: "Lever Set", material: "Solid Core Timber" } },
      { globalId: "2O2Fr$t4X7Zf8NOew3FNr4", name: "D05", properties: { mark: "D05", level: "Level 1", size: "820x2040", type: "Single Swing", frl: "-/60/30", hardware: "Lever Set + Closer", material: "Solid Core Timber" } },
    ];

    for (const door of seedDoors) {
      await ctx.db.insert("elements", {
        groupId: doorGroupId,
        projectId,
        globalId: door.globalId,
        name: door.name,
        properties: door.properties,
      });
    }

    // ── Window Group ──────────────────────────────────────
    const windowGroupId = await ctx.db.insert("elementGroups", {
      projectId,
      fileId: ifcFileId,
      elementType: "IfcWindow",
      displayName: "Windows",
      count: 3,
      columnOrder: ["mark", "level", "size", "type", "glazing", "frame", "external"],
      columnLabels: {
        mark: "Mark",
        level: "Level",
        size: "Size (WxH)",
        type: "Type",
        glazing: "Glazing",
        frame: "Frame",
        external: "External",
      },
      status: "complete",
      extractedAt: now - 1740_000,
    });

    const seedWindows = [
      { globalId: "3P4Gs$u5Y8Ag9OPfx4GOt0", name: "W01", properties: { mark: "W01", level: "Ground Floor", size: "1200x1200", type: "Fixed", glazing: "Double", frame: "Aluminium", external: "Yes" } },
      { globalId: "3P4Gs$u5Y8Ag9OPfx4GOt1", name: "W02", properties: { mark: "W02", level: "Ground Floor", size: "1800x1500", type: "Fixed", glazing: "Double", frame: "Aluminium", external: "Yes" } },
      { globalId: "3P4Gs$u5Y8Ag9OPfx4GOt2", name: "W03", properties: { mark: "W03", level: "Level 1", size: "1200x1200", type: "Awning", glazing: "Double", frame: "Aluminium", external: "Yes" } },
    ];

    for (const win of seedWindows) {
      await ctx.db.insert("elements", {
        groupId: windowGroupId,
        projectId,
        globalId: win.globalId,
        name: win.name,
        properties: win.properties,
      });
    }

    // ── Artifacts ─────────────────────────────────────────
    await ctx.db.insert("artifacts", {
      projectId,
      threadId,
      messageId: assistantMsg2,
      name: "Cross-Validation: Doors",
      type: "cross_validation",
      format: "json",
      status: "complete",
      summary: "47 doors checked. 3 issues found: 1 FRL mismatch, 1 missing element, 12 absent fire ratings.",
      contentInline: {
        kind: "report",
        title: "Door Cross-Validation Report",
        summary: "Compared 47 IFC doors against PDF door schedule (page 12-13)",
        sections: [
          {
            heading: "Discrepancies",
            items: [
              { status: "fail", label: "D04 FRL mismatch", detail: "IFC: null, PDF: -/60/30" },
              { status: "fail", label: "D12 missing from IFC", detail: "Present in PDF schedule row 12, not found in model" },
              { status: "warn", label: "12 doors missing fire ratings in IFC", detail: "PDF specifies ratings for all doors. Likely Revit export settings issue." },
            ],
          },
          {
            heading: "Passed Checks",
            items: [
              { status: "pass", label: "Door count matches", detail: "47 in IFC, 47 in PDF schedule" },
              { status: "pass", label: "42 doors fully matched", detail: "Mark, size, type, and hardware all agree" },
            ],
          },
        ],
      },
      elementType: "IfcDoor",
      sourceFile: "clinic-project.ifc",
      createdAt: now - 1620_000,
      createdBy: "agent",
    });

    await ctx.db.insert("artifacts", {
      projectId,
      threadId,
      messageId: assistantMsg1,
      name: "Door Schedule",
      type: "element_list",
      format: "json",
      status: "complete",
      summary: "47 doors across 3 storeys. 12 fire-rated, 35 without fire rating.",
      contentInline: {
        kind: "table",
        title: "Door Schedule - All Levels",
        summary: "47 doors extracted from clinic-project.ifc",
        columns: ["Mark", "Level", "Size", "Type", "Fire Rating", "Hardware", "Material"],
        rows: [
          ["D01", "Ground Floor", "900x2100", "Single Swing", "-", "Lever Set", "Solid Core Timber"],
          ["D02", "Ground Floor", "900x2100", "Single Swing", "-/60/30", "Lever Set + Closer", "Solid Core Timber"],
          ["D03", "Ground Floor", "1200x2100", "Double Swing", "-", "Push Plate", "Aluminium Frame"],
          ["D04", "Level 1", "900x2100", "Single Swing", "-", "Lever Set", "Solid Core Timber"],
          ["D05", "Level 1", "820x2040", "Single Swing", "-/60/30", "Lever Set + Closer", "Solid Core Timber"],
        ],
        notes: ["Showing 5 of 47 doors (seed data subset)", "12 doors have fire ratings, 35 show '-'"],
      },
      elementType: "IfcDoor",
      sourceFile: "clinic-project.ifc",
      createdAt: now - 1740_000,
      createdBy: "agent",
    });

    // ── Issues ────────────────────────────────────────────
    await ctx.db.insert("issues", {
      projectId,
      severity: "warning",
      title: "FRL mismatch on D04",
      description: "IFC model shows null fire rating for D04, but PDF door schedule specifies -/60/30. Check with architect.",
      source: "Cross-validation",
      elementRef: "D04",
      elementGuid: "2O2Fr$t4X7Zf8NOew3FNr3",
      status: "open",
      createdAt: now - 1620_000,
    });

    await ctx.db.insert("issues", {
      projectId,
      severity: "error",
      title: "D12 missing from IFC model",
      description: "Door D12 appears in PDF door schedule (row 12) but has no corresponding element in the IFC model. May indicate a modelling omission.",
      source: "Cross-validation",
      elementRef: "D12",
      status: "open",
      createdAt: now - 1620_000,
    });

    await ctx.db.insert("issues", {
      projectId,
      severity: "info",
      title: "12 doors missing fire ratings in IFC",
      description: "PDF schedule specifies fire ratings for all 47 doors, but 12 IFC doors have null Pset_DoorCommon.FireRating. Likely caused by Revit 'Export IFC common property sets' checkbox not enabled.",
      source: "Cross-validation",
      status: "open",
      createdAt: now - 1620_000,
    });

    await ctx.db.insert("issues", {
      projectId,
      severity: "warning",
      title: "23 doors missing Pset_DoorCommon",
      description: "23 of 47 IfcDoor elements have no Pset_DoorCommon property set at all. Property completeness: 51%.",
      source: "IFC Validation",
      status: "open",
      createdAt: now - 1740_000,
    });

    // ── Completed Agent Job ───────────────────────────────
    await ctx.db.insert("agentJobs", {
      projectId,
      type: "chat_response",
      status: "completed",
      progress: 100,
      progressMessage: "Complete",
      input: { threadId, messageId: userMsg2, message: "Cross-validate the door data against the PDF door schedule" },
      output: { artifactCount: 1, issueCount: 3 },
      messageId: userMsg2,
      queuedAt: now - 1680_000,
      claimedAt: now - 1679_000,
      startedAt: now - 1678_000,
      completedAt: now - 1620_000,
    });

    return {
      seeded: true,
      ids: {
        userId,
        projectId,
        ifcFileId,
        pdfFileId,
        threadId,
        doorGroupId,
        windowGroupId,
      },
    };
  },
});
