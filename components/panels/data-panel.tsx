"use client";

import { useState } from "react";
import {
  FileText, AlertTriangle, Layers, ChevronDown, ChevronRight,
  Download, Eye, Clock, XCircle, Info, Filter, ArrowUpDown,
  FileSpreadsheet, ClipboardCheck, Scale, Table2, StickyNote, ListChecks,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";

const MOCK_ARTIFACTS = [
  { id: "a1", name: "Door Schedule", type: "schedule", status: "complete" as const, timestamp: "2 min ago", summary: "47 doors across 2 storeys, 12 fire-rated", format: "CSV" },
  { id: "a2", name: "Window QTO", type: "qto", status: "complete" as const, timestamp: "5 min ago", summary: "69 windows, 528.4 m\u00b2 total area", format: "CSV" },
  { id: "a3", name: "IFC vs PDF Cross-Validation", type: "validation", status: "complete" as const, timestamp: "8 min ago", summary: "3 mismatches, 2 absent from IFC, 18 passed", format: "MD" },
  { id: "a4", name: "Wall Material Takeoff", type: "qto", status: "generating" as const, timestamp: "Just now", summary: "Calculating quantities by material...", format: "CSV" },
  { id: "a5", name: "Fire Compliance Report", type: "compliance", status: "complete" as const, timestamp: "12 min ago", summary: "4 issues flagged - FRL gaps on Level 1", format: "PDF" },
];

const MOCK_ISSUES = [
  { id: "i1", severity: "error" as const, title: "FRL mismatch: D04", description: "IFC says FRL-30, PDF spec requires FRL-60", source: "Cross-validation", element: "D04" },
  { id: "i2", severity: "error" as const, title: "Missing Pset_DoorCommon", description: "23 of 47 doors missing standard property set", source: "IFC Validation", element: null },
  { id: "i3", severity: "warning" as const, title: "No U-Value on windows", description: "44 windows on Level 2 have no thermal data", source: "IFC Validation", element: null },
  { id: "i4", severity: "warning" as const, title: "Placeholder fire ratings", description: "69 windows have 'FireRating' as placeholder text", source: "IFC Validation", element: null },
  { id: "i5", severity: "info" as const, title: "8 misclassified elements", description: "IfcBuildingElementProxy used instead of specific types", source: "IFC Validation", element: null },
];

const MOCK_ELEMENT_GROUPS = [
  { name: "Doors", count: 47, items: [
    { mark: "D01", level: "Ground", size: "920x2040", type: "Single Swing", frl: "FRL-60" },
    { mark: "D02", level: "Ground", size: "920x2040", type: "Single Swing", frl: "FRL-60" },
    { mark: "D03", level: "Ground", size: "820x2040", type: "Single Swing", frl: "FRL-60" },
    { mark: "D04", level: "Ground", size: "1200x2040", type: "Double Swing", frl: "FRL-60" },
    { mark: "D09", level: "Level 1", size: "920x2040", type: "Single Swing", frl: "FRL-30" },
    { mark: "D10", level: "Level 1", size: "920x2040", type: "Single Swing", frl: "FRL-30" },
  ]},
  { name: "Windows", count: 69, items: [] },
  { name: "Walls", count: 156, items: [] },
  { name: "Slabs", count: 14, items: [] },
  { name: "Columns", count: 32, items: [] },
];

const ARTIFACT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  schedule: Table2, qto: FileSpreadsheet, validation: Scale, compliance: ClipboardCheck, notes: StickyNote, checklist: ListChecks,
};

export function DataPanel() {
  const [expandedGroup, setExpandedGroup] = useState<string | null>("Doors");
  const issueCount = MOCK_ISSUES.filter((i) => i.severity === "error").length;

  return (
    <Tabs defaultValue="artifacts" className="flex h-full flex-col gap-0">
      <TabsList variant="line" className="h-[36px] min-h-[36px] w-full justify-start px-1">
        <TabsTrigger value="artifacts" className="gap-2 text-[13px]">
          <FileText className="h-3.5 w-3.5" />Artifacts
        </TabsTrigger>
        <TabsTrigger value="issues" className="gap-2 text-[13px]">
          <AlertTriangle className="h-3.5 w-3.5" />Issues
          {issueCount > 0 && (
            <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-error/10 px-1 text-[10px] font-medium tabular-nums text-error">{issueCount}</span>
          )}
        </TabsTrigger>
        <TabsTrigger value="elements" className="gap-2 text-[13px]">
          <Layers className="h-3.5 w-3.5" />Elements
        </TabsTrigger>
      </TabsList>

      <TabsContent value="artifacts" className="mt-0 flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="space-y-1 p-3">
            {MOCK_ARTIFACTS.map((artifact) => {
              const Icon = ARTIFACT_ICONS[artifact.type] || FileText;
              return (
                <div key={artifact.id} className="group rounded-lg p-3 transition-colors duration-150 hover:bg-bg-muted">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-muted">
                      <Icon className="h-4 w-4 text-accent" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2.5">
                        <span className="text-[14px] font-medium text-text-primary">{artifact.name}</span>
                        {artifact.status === "generating" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-accent-muted px-2 py-px text-[11px] text-accent">
                            <span className="h-1 w-1 animate-pulse rounded-full bg-accent" />Generating
                          </span>
                        ) : (
                          <span className="rounded-full bg-bg-muted px-1.5 py-px font-mono text-[11px] text-text-muted">{artifact.format}</span>
                        )}
                      </div>
                      <p className="mt-1 text-[13px] text-text-secondary">{artifact.summary}</p>
                      <div className="mt-2 flex items-center gap-4">
                        <span className="flex items-center gap-1.5 text-[12px] text-text-muted">
                          <Clock className="h-3.5 w-3.5" />{artifact.timestamp}
                        </span>
                        {artifact.status === "complete" && (
                          <div className="flex items-center gap-2 opacity-0 transition-opacity duration-100 group-hover:opacity-100">
                            <button className="flex cursor-pointer items-center gap-1 text-[11px] text-accent hover:text-accent-hover"><Eye className="h-3 w-3" />Preview</button>
                            <button className="flex cursor-pointer items-center gap-1 text-[11px] text-accent hover:text-accent-hover"><Download className="h-3 w-3" />Export</button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="issues" className="mt-0 flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="space-y-1 p-3">
            {MOCK_ISSUES.map((issue) => {
              const Icon = issue.severity === "error" ? XCircle : issue.severity === "warning" ? AlertTriangle : Info;
              const color = issue.severity === "error" ? "text-error" : issue.severity === "warning" ? "text-warning" : "text-text-muted";
              return (
                <div key={issue.id} className="flex items-start gap-3 rounded-lg p-3 transition-colors duration-150 hover:bg-bg-muted">
                  <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", color)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5">
                      <span className="text-[14px] font-medium text-text-primary">{issue.title}</span>
                      {issue.element && (
                        <span className="rounded-full bg-accent-muted px-2 py-px font-mono text-[11px] text-accent">{issue.element}</span>
                      )}
                    </div>
                    <p className="mt-1 text-[13px] text-text-secondary">{issue.description}</p>
                    <span className="mt-1.5 inline-block text-[12px] text-text-muted">{issue.source}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="elements" className="mt-0 flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-3">
            {MOCK_ELEMENT_GROUPS.map((group) => (
              <div key={group.name} className="mb-1">
                <button
                  onClick={() => setExpandedGroup(expandedGroup === group.name ? null : group.name)}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors duration-150 hover:bg-bg-muted"
                >
                  {expandedGroup === group.name ? <ChevronDown className="h-4 w-4 text-text-muted" /> : <ChevronRight className="h-4 w-4 text-text-muted" />}
                  <span className="text-[14px] font-medium text-text-primary">{group.name}</span>
                  <span className="rounded-full bg-bg-muted px-2 py-0.5 text-[12px] tabular-nums text-text-muted">{group.count}</span>
                  {expandedGroup === group.name && (
                    <span className="ml-auto flex items-center gap-1 text-text-muted"><Filter className="h-3 w-3" /><ArrowUpDown className="h-3 w-3" /></span>
                  )}
                </button>
                {expandedGroup === group.name && group.items.length > 0 && (
                  <div className="mt-1 overflow-x-auto rounded-md border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-bg-muted">
                          <TableHead className="h-7 px-2 text-[11px]">Mark</TableHead>
                          <TableHead className="h-7 px-2 text-[11px]">Level</TableHead>
                          <TableHead className="h-7 px-2 text-[11px]">Size</TableHead>
                          <TableHead className="h-7 px-2 text-[11px]">Type</TableHead>
                          <TableHead className="h-7 px-2 text-[11px]">FRL</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.items.map((item) => (
                          <TableRow key={item.mark} className="border-border-subtle">
                            <TableCell className="px-2 py-1.5 font-mono text-[12px] font-medium text-accent">{item.mark}</TableCell>
                            <TableCell className="px-2 py-1.5 text-[12px] text-text-secondary">{item.level}</TableCell>
                            <TableCell className="px-2 py-1.5 font-mono text-[12px] tabular-nums text-text-primary">{item.size}</TableCell>
                            <TableCell className="px-2 py-1.5 text-[12px] text-text-secondary">{item.type}</TableCell>
                            <TableCell className="px-2 py-1.5">
                              <span className={cn("rounded-full px-2 py-px font-mono text-[11px]", item.frl === "FRL-60" ? "bg-warning/10 text-warning" : "bg-info/10 text-info")}>{item.frl}</span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {expandedGroup === group.name && group.items.length === 0 && (
                  <p className="px-8 py-3 text-[12px] text-text-muted">Ask BuildBrain AI to extract {group.name.toLowerCase()} data</p>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
}
