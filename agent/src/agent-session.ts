import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  createAgentSession,
  type AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import { config } from "./config.js";
import { buildSystemPrompt } from "./system-prompt.js";
import type { ConvexClientWrapper, ThreadContext, ToolCallRecord, ElementRef } from "./convex-client.js";
import { StreamWriter } from "./stream-writer.js";
import {
  writeElementList,
  writeQuantityTakeoff,
  writePdfSchedule,
  writeModelSummary,
  writeValidationIssues,
} from "./result-writer.js";

// Tool definitions
import { ifcExtractTool } from "./tools/ifc-extract.js";
import { pdfExtractTool } from "./tools/pdf-extract.js";
import { ifcCreateTool } from "./tools/ifc-create.js";
import { ifcPlaceTool } from "./tools/ifc-place.js";
import { ifcQueryTool } from "./tools/ifc-query.js";

export interface AgentRunResult {
  content: string;
  toolCalls: ToolCallRecord[];
  artifactIds: string[];
  elementRefs: ElementRef[];
  suggestions: Array<{ label: string; prompt: string }>;
}

export async function runAgent(
  userMessage: string,
  context: ThreadContext,
  messageId: string,
  convex: ConvexClientWrapper,
  streamWriter: StreamWriter,
): Promise<AgentRunResult> {
  const systemPrompt = buildSystemPrompt(context);

  const authStorage = AuthStorage.create();
  authStorage.setRuntimeApiKey("anthropic", config.anthropicApiKey);
  const modelRegistry = new ModelRegistry(authStorage);

  const model = getModel("anthropic", config.model);
  if (!model) throw new Error(`Model not found: ${config.model}`);

  // Custom resource loader with BuildBrain system prompt
  const resourceLoader = {
    getExtensions: () => ({ extensions: [], errors: [], runtime: undefined as any }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getAppendSystemPrompt: () => [],
    getPathMetadata: () => new Map(),
    extendResources: () => {},
    reload: async () => {},
  };

  const { session } = await createAgentSession({
    model,
    thinkingLevel: config.thinkingLevel,
    tools: [], // No built-in coding tools
    customTools: [ifcExtractTool, pdfExtractTool, ifcCreateTool, ifcPlaceTool, ifcQueryTool],
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
    authStorage,
    modelRegistry,
    resourceLoader,
  });

  // Track results
  const toolCalls: ToolCallRecord[] = [];
  const artifactIds: string[] = [];
  const elementRefs: ElementRef[] = [];

  // File lookup helpers -- resolve fileId/sourceFile from tool args
  const ifcFiles = context.files.filter((f) => f.type === "ifc");
  const pdfFiles = context.files.filter((f) => f.type === "pdf");

  function resolveFile(toolName: string, args: any) {
    const filename = args?.file ?? args?.model;
    if (filename) {
      const match = context.files.find((f) => f.name === filename);
      if (match) return { fileId: match._id, sourceFile: match.name };
    }
    // Fallback: first file of the matching type
    if (toolName.startsWith("ifc") && ifcFiles[0]) {
      return { fileId: ifcFiles[0]._id, sourceFile: ifcFiles[0].name };
    }
    if (toolName === "pdf_extract" && pdfFiles[0]) {
      return { fileId: pdfFiles[0]._id, sourceFile: pdfFiles[0].name };
    }
    return { fileId: context.files[0]?._id, sourceFile: context.files[0]?.name };
  }

  function makeWriteCtx(toolName: string, args: any) {
    const { fileId, sourceFile } = resolveFile(toolName, args);
    return {
      projectId: context.thread.projectId,
      threadId: context.thread._id,
      messageId,
      sourceFile,
      fileId,
    };
  }

  // Subscribe to streaming events
  session.subscribe(async (event: AgentSessionEvent) => {
    switch (event.type) {
      case "message_update":
        if (event.assistantMessageEvent.type === "text_delta") {
          streamWriter.append(event.assistantMessageEvent.delta);
        }
        break;

      case "tool_execution_start": {
        toolCalls.push({
          id: event.toolCallId,
          tool: event.toolName,
          args: event.args,
          status: "running",
          ephemeral: false,
        });
        // Update message with tool call status
        try {
          await convex.finalizeMessage({
            messageId,
            content: streamWriter.getFullContent(),
            toolCalls: [...toolCalls],
          });
        } catch {
          // Non-critical: UI update during streaming
        }
        break;
      }

      case "tool_execution_end": {
        const tc = toolCalls.find((t) => t.id === event.toolCallId);
        if (tc) {
          tc.status = event.isError ? "error" : "complete";

          // Process structured results based on tool + command
          if (!event.isError && event.result?.details?.raw) {
            try {
              const ctx = makeWriteCtx(tc.tool, tc.args);
              await processToolResult(
                tc.tool,
                tc.args,
                event.result.details.raw,
                ctx,
                convex,
                artifactIds,
                elementRefs,
              );
            } catch (err) {
              console.error("Failed to write tool result:", err);
            }
          }

          // Build summary for the tool call
          if (!event.isError && event.result?.details?.raw) {
            const raw = event.result.details.raw;
            tc.result = buildToolSummary(tc.tool, tc.args, raw);
          } else if (event.isError) {
            tc.result = "Error occurred";
          }
        }
        break;
      }
    }
  });

  // Inject conversation history as prior messages
  const historyPrompt = context.recentMessages
    .map((m) => `[${m.role}]: ${m.content}`)
    .join("\n\n");

  const fullPrompt = historyPrompt
    ? `Previous conversation:\n${historyPrompt}\n\n[user]: ${userMessage}`
    : userMessage;

  // Run the agent
  streamWriter.start();
  await session.prompt(fullPrompt);

  // Generate suggestions based on what was done
  const suggestions = generateSuggestions(toolCalls, context);

  // Clean up
  session.dispose();

  return {
    content: streamWriter.getFullContent(),
    toolCalls,
    artifactIds,
    elementRefs,
    suggestions,
  };
}

async function processToolResult(
  tool: string,
  args: any,
  rawResult: any,
  ctx: { projectId: string; threadId: string; messageId: string; sourceFile?: string; fileId?: string },
  convex: ConvexClientWrapper,
  artifactIds: string[],
  elementRefs: ElementRef[],
): Promise<void> {
  if (tool === "ifc_extract") {
    const command = args?.command;
    switch (command) {
      case "list": {
        const result = await writeElementList(rawResult, ctx, convex);
        artifactIds.push(result.artifactId);
        elementRefs.push(...result.elementRefs.slice(0, 50)); // Cap refs for message
        break;
      }
      case "quantities": {
        const id = await writeQuantityTakeoff(rawResult, ctx, convex);
        artifactIds.push(id);
        break;
      }
      case "summary": {
        const id = await writeModelSummary(rawResult, ctx, convex);
        artifactIds.push(id);
        // Update file metadata
        if (ctx.fileId) {
          await convex.updateIfcMeta({
            fileId: ctx.fileId,
            ifcSchema: rawResult.schema,
            elementCounts: rawResult.element_counts,
            storeyNames: rawResult.storeys,
          });
        }
        break;
      }
      case "validate": {
        await writeValidationIssues(rawResult, undefined, ctx, convex);
        if (ctx.fileId && rawResult.completeness) {
          const scores = Object.values(rawResult.completeness) as any[];
          const avg =
            scores.reduce((sum: number, s: any) => {
              const pct = parseInt(s.pset_coverage, 10) || 0;
              return sum + pct;
            }, 0) / (scores.length || 1);
          await convex.updateIfcMeta({
            fileId: ctx.fileId,
            validationScore: Math.round(avg),
          });
        }
        break;
      }
    }
  } else if (tool === "pdf_extract") {
    const command = args?.command;
    if (command === "schedules") {
      const id = await writePdfSchedule(rawResult, ctx, convex);
      artifactIds.push(id);
      if (ctx.fileId) {
        await convex.updatePdfMeta({
          fileId: ctx.fileId,
          schedulesFound: rawResult.schedules_found?.map((s: any) => ({
            type: s.type,
            page: s.page,
            rowCount: s.row_count,
          })),
        });
      }
    }
  }
}

function buildToolSummary(tool: string, args: any, raw: any): string {
  if (tool === "ifc_extract") {
    switch (args?.command) {
      case "summary":
        return `Model: ${raw.schema ?? "IFC"}, ${Object.values(raw.element_counts ?? {}).reduce((s: number, n) => s + (n as number), 0)} elements, ${raw.storeys?.length ?? 0} storeys`;
      case "list":
        return `Found ${raw.count ?? raw.elements?.length ?? 0} ${raw.element_type ?? "elements"}`;
      case "quantities":
        return `${raw.totals?.count ?? 0} elements, ${raw.totals?.total_net_side_area_m2 ?? raw.totals?.total_area_m2 ?? "N/A"} m2 total`;
      case "validate":
        return `${raw.issues?.length ?? 0} issues found`;
    }
  } else if (tool === "pdf_extract") {
    switch (args?.command) {
      case "schedules":
        return `Found ${raw.schedules_found?.length ?? 0} schedules`;
      case "search":
        return `${raw.match_count ?? 0} matches`;
    }
  }
  return "Complete";
}

function generateSuggestions(
  toolCalls: ToolCallRecord[],
  context: ThreadContext,
): Array<{ label: string; prompt: string }> {
  const suggestions: Array<{ label: string; prompt: string }> = [];
  const completedTools = toolCalls.filter((t) => t.status === "complete");

  // After a scan, suggest extraction
  const hasSummary = completedTools.some(
    (t) => t.tool === "ifc_extract" && (t.args as any)?.command === "summary",
  );
  if (hasSummary) {
    suggestions.push({
      label: "Extract all doors",
      prompt: "Extract all doors from the IFC model with their properties",
    });
    suggestions.push({
      label: "Cross-validate schedules",
      prompt: "Cross-validate the door schedule between IFC and PDF",
    });
  }

  // After element extraction, suggest QTO or cross-validation
  const hasElementList = completedTools.some(
    (t) => t.tool === "ifc_extract" && (t.args as any)?.command === "list",
  );
  if (hasElementList) {
    const elementType = completedTools.find(
      (t) => t.tool === "ifc_extract" && (t.args as any)?.command === "list",
    )?.args as any;
    suggestions.push({
      label: `Quantity takeoff for ${elementType?.type ?? "elements"}`,
      prompt: `Generate a quantity takeoff for ${elementType?.type ?? "all elements"} grouped by storey`,
    });
  }

  // After PDF extraction, suggest cross-validation
  const hasPdfSchedules = completedTools.some(
    (t) => t.tool === "pdf_extract" && (t.args as any)?.command === "schedules",
  );
  if (hasPdfSchedules && context.files.some((f) => f.type === "ifc")) {
    suggestions.push({
      label: "Cross-validate with IFC",
      prompt: "Cross-validate the PDF schedules against the IFC model data",
    });
  }

  // Default suggestions if nothing specific
  if (suggestions.length === 0) {
    if (context.files.some((f) => f.type === "ifc")) {
      suggestions.push({
        label: "Scan the project",
        prompt: "Scan the IFC model and PDF drawings to see what data is available",
      });
    }
  }

  return suggestions.slice(0, 3);
}
