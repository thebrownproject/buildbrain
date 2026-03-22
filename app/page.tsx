"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { DockviewApi } from "dockview-core";
import { DockWorkspace } from "@/components/dock/workspace";
import { togglePanel, type PanelVisibility } from "@/lib/dock/workspace-helpers";
import type { PanelKey } from "@/lib/dock/constants";
import {
  MessageSquare, Briefcase, ChevronDown, Box, FileText, Building2,
} from "lucide-react";
import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";
import {
  ViewerCommandContext, WorkbenchCommandContext,
  type ViewerCommand, type WorkbenchCommand,
} from "@/lib/contexts";

const DEFAULT_VISIBILITY: PanelVisibility = {
  chat: true, ifc: true, pdf: false, workbench: true,
};

export default function Home() {
  const dockApiRef = useRef<DockviewApi | null>(null);
  const [visibility, setVisibility] = useState<PanelVisibility>(DEFAULT_VISIBILITY);

  const viewerCommandRef = useRef<((cmd: ViewerCommand) => void) | null>(null);
  const workbenchCommandRef = useRef<((cmd: WorkbenchCommand) => void) | null>(null);
  const viewerCtx = useMemo(() => ({ sendCommand: (cmd: ViewerCommand) => viewerCommandRef.current?.(cmd) }), []);
  const workbenchCtx = useMemo(() => ({ sendCommand: (cmd: WorkbenchCommand) => workbenchCommandRef.current?.(cmd) }), []);

  const onApiReady = useCallback((api: DockviewApi) => { dockApiRef.current = api; }, []);
  const handleToggle = useCallback((key: PanelKey) => {
    const api = dockApiRef.current;
    if (api) togglePanel(api, key);
  }, []);

  return (
    <ViewerCommandContext.Provider value={viewerCtx}>
    <WorkbenchCommandContext.Provider value={workbenchCtx}>
    <div className="flex h-screen flex-col bg-bg">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-bg-card px-4">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent">
            <span className="text-[12px] font-bold text-white">B</span>
          </div>
          <span className="text-[14px] font-semibold tracking-tight text-text-primary">BuildBrain</span>
        </div>

        <div className="h-5 w-px bg-border" />

        {/* Project selector */}
        <button type="button" className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-[14px] transition-colors duration-150 hover:bg-bg-muted">
          <Building2 className="h-4 w-4 text-text-muted" />
          <span className="font-medium text-text-primary">Clinic Project</span>
          <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
        </button>

        {/* Metadata pills */}
        <div className="flex items-center gap-1.5">
          <MetaPill>Class 5</MetaPill>
          <MetaPill>VIC</MetaPill>
          <MetaPill>Type A</MetaPill>
        </div>

        {/* Panel toggles */}
        <div className="ml-auto flex items-center gap-2">
          <PanelToggle pressed={visibility.chat} onToggle={() => handleToggle("chat")} icon={MessageSquare} label="Assistant" />
          <PanelToggle pressed={visibility.ifc} onToggle={() => handleToggle("ifc")} icon={Box} label="Model" />
          <PanelToggle pressed={visibility.pdf} onToggle={() => handleToggle("pdf")} icon={FileText} label="Drawings" />
          <PanelToggle pressed={visibility.workbench} onToggle={() => handleToggle("workbench")} icon={Briefcase} label="Workbench" />
        </div>
      </header>

      <DockWorkspace
        className="min-h-0 flex-1 p-2"
        onApiReady={onApiReady}
        onVisibilityChange={setVisibility}
      />
    </div>
    </WorkbenchCommandContext.Provider>
    </ViewerCommandContext.Provider>
  );
}

function PanelToggle({ pressed, onToggle, icon: Icon, label }: {
  pressed: boolean; onToggle: () => void;
  icon: React.ComponentType<{ className?: string }>; label: string;
}) {
  return (
    <Toggle
      pressed={pressed}
      onPressedChange={onToggle}
      size="default"
      className={cn(
        "h-8 gap-2 rounded-full border px-4 text-[13px] font-medium transition-colors duration-150",
        pressed
          ? "border-transparent bg-bg-muted text-text-primary"
          : "border-border bg-bg-card text-text-muted hover:bg-bg-card hover:text-text-secondary"
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Toggle>
  );
}

function MetaPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-bg-muted px-2.5 py-0.5 text-[12px] font-medium text-text-secondary">
      {children}
    </span>
  );
}
