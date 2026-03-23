"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DockviewReact } from "dockview";
import type { DockviewApi, IDockviewPanelProps } from "dockview-core";
import { cn } from "@/lib/utils";
import { AIChat } from "@/components/panels/ai-chat";
import { IFCViewer } from "@/components/panels/ifc-viewer";
import { PDFViewer } from "@/components/panels/pdf-viewer";
import { DataPanel } from "@/components/panels/data-panel";
import { LAYOUT_STORAGE_KEY } from "@/lib/dock/constants";
import {
  applyDefaultLayout,
  tryLoadStoredLayout,
  visibilityFromApi,
  type PanelVisibility,
} from "@/lib/dock/workspace-helpers";

const dockComponents = {
  chat: (_props: IDockviewPanelProps) => <AIChat threadId={null} />,
  ifc: (_props: IDockviewPanelProps) => <IFCViewer />,
  pdf: (_props: IDockviewPanelProps) => <PDFViewer />,
  workbench: (_props: IDockviewPanelProps) => <DataPanel />,
};

export type DockWorkspaceProps = {
  className?: string;
  onApiReady?: (api: DockviewApi) => void;
  onVisibilityChange?: (v: PanelVisibility) => void;
};

export function DockWorkspace({
  className,
  onApiReady,
  onVisibilityChange,
}: DockWorkspaceProps) {
  const [api, setApi] = useState<DockviewApi | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const emitVisibility = useCallback(
    (dock: DockviewApi) => {
      onVisibilityChange?.(visibilityFromApi(dock));
    },
    [onVisibilityChange]
  );

  const scheduleSave = useCallback((dock: DockviewApi) => {
    if (typeof window === "undefined") return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      try {
        const json = dock.toJSON();
        if (json && json.grid) {
          localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(json));
        }
      } catch {
        /* serialisation failed or quota / private mode */
      }
    }, 450);
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const onReady = useCallback(
    (event: { api: DockviewApi }) => {
      const dock = event.api;
      if (!tryLoadStoredLayout(dock)) {
        applyDefaultLayout(dock);
      }
      setApi(dock);
      emitVisibility(dock);
      onApiReady?.(dock);
    },
    [emitVisibility, onApiReady]
  );

  useEffect(() => {
    if (!api) return;
    const safe = (fn: () => void) => () => {
      try { fn(); } catch { /* layout mid-transition */ }
    };
    const subLayout = api.onDidLayoutChange(safe(() => {
      scheduleSave(api);
      emitVisibility(api);
    }));
    const subAdd = api.onDidAddPanel(safe(() => emitVisibility(api)));
    const subRemove = api.onDidRemovePanel(safe(() => emitVisibility(api)));
    return () => {
      subLayout.dispose();
      subAdd.dispose();
      subRemove.dispose();
    };
  }, [api, emitVisibility, scheduleSave]);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div
        className={cn(
          "dockview-theme-light dockview-buildbrain h-full min-h-0 w-full overflow-hidden rounded-xl border border-border"
        )}
      >
        <DockviewReact
          className="h-full w-full"
          components={dockComponents}
          onReady={onReady}
        />
      </div>
    </div>
  );
}
