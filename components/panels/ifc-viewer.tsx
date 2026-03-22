"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  RotateCcw,
  Upload,
  Home,
  Ruler,
  Scissors,
  StickyNote,
  Camera,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";

export function IFCViewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const [status, setStatus] = useState<string>("Initializing...");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;

    async function init() {
      const THREE = await import("three");
      const OBC = await import("@thatopen/components");
      const OBCF = await import("@thatopen/components-front");
      const BUI = await import("@thatopen/ui");

      BUI.Manager.init();
      if (disposed || !containerRef.current) return;

      const components = new OBC.Components();
      const worlds = components.get(OBC.Worlds);
      const world = worlds.create();

      world.scene = new OBC.SimpleScene(components);
      world.scene.setup();
      world.scene.three.background = new THREE.Color(0xffffff);

      const viewport = document.createElement("bim-viewport");
      viewport.style.width = "100%";
      viewport.style.height = "100%";
      containerRef.current.appendChild(viewport);

      world.renderer = new OBCF.RendererWith2D(components, viewport);
      world.camera = new OBC.OrthoPerspectiveCamera(components);

      const resizeObserver = new ResizeObserver(() => {
        world.renderer?.resize();
        world.camera.updateAspect();
      });
      resizeObserver.observe(containerRef.current);

      const grid = components.get(OBC.Grids).create(world);
      grid.config.color = new THREE.Color(0xdddddd);
      components.init();

      const fragments = components.get(OBC.FragmentsManager);
      fragments.init("/fragment-worker.mjs");

      world.camera.controls.addEventListener("update", () =>
        fragments.core.update()
      );
      fragments.list.onItemSet.add(({ value: model }: { value: any }) => {
        model.useCamera(world.camera.three);
        world.scene.three.add(model.object);
        fragments.core.update(true);
      });

      const ifcLoader = components.get(OBC.IfcLoader);
      await ifcLoader.setup({
        autoSetWasm: false,
        wasm: { path: "https://unpkg.com/web-ifc@0.0.77/", absolute: true },
      });

      const highlighter = components.get(OBCF.Highlighter);
      highlighter.setup({ world });
      highlighter.zoomToSelection = true;

      const hoverer = components.get(OBCF.Hoverer);
      hoverer.world = world;
      hoverer.enabled = true;
      hoverer.material = new THREE.MeshBasicMaterial({
        color: 0x3b82f6,
        transparent: true,
        opacity: 0.4,
        depthTest: false,
      });

      viewerRef.current = {
        components, world, ifcLoader, fragments, viewport, resizeObserver,
        loadIfc: async (file: File) => {
          setStatus("Loading model...");
          const buffer = new Uint8Array(await file.arrayBuffer());
          await ifcLoader.load(buffer, true, file.name);
          setStatus(file.name);
        },
        loadIfcFromUrl: async (url: string) => {
          setStatus("Loading model...");
          try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const buffer = new Uint8Array(await resp.arrayBuffer());
            await ifcLoader.load(buffer, true, url.split("/").pop() || "model.ifc");
            setStatus(url.split("/").pop() || "model.ifc");
          } catch (err) {
            setStatus("Failed to load");
            console.error(err);
          }
        },
        fitToView: () => world.camera.fit(world.scene.three),
      };

      setStatus("Ready - load a model");

      viewport.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); });
      viewport.addEventListener("drop", async (e) => {
        e.preventDefault(); e.stopPropagation();
        const file = e.dataTransfer?.files[0];
        if (file?.name.toLowerCase().endsWith(".ifc")) await viewerRef.current?.loadIfc(file);
      });
    }

    init();
    return () => {
      disposed = true;
      if (viewerRef.current) {
        viewerRef.current.resizeObserver?.disconnect();
        viewerRef.current.viewport?.remove();
        viewerRef.current.components?.dispose();
        viewerRef.current = null;
      }
    };
  }, []);

  const handleLoadSample = useCallback(async () => { await viewerRef.current?.loadIfcFromUrl("/model.ifc"); }, []);
  const handleFileUpload = useCallback(() => { fileInputRef.current?.click(); }, []);
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await viewerRef.current?.loadIfc(file);
  }, []);
  const handleFitToView = useCallback(() => { viewerRef.current?.fitToView(); }, []);

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-white">
      <div className="flex h-[36px] shrink-0 items-center justify-between border-b border-border px-4">
        <Badge variant="secondary" className="rounded border-0 font-mono text-text-muted">
          {status}
        </Badge>
        <div className="flex items-center gap-1.5">
          <ToolbarButton icon={Ruler} label="Measure" />
          <ToolbarButton icon={Scissors} label="Section Cut" />
          <ToolbarButton icon={StickyNote} label="Annotate" />
          <ToolbarButton icon={Camera} label="Screenshot" />
          <div className="mx-1 h-5 w-px bg-border" />
          <ToolbarButton icon={Home} label="Load sample model" onClick={handleLoadSample} />
          <ToolbarButton icon={Upload} label="Upload IFC file" onClick={handleFileUpload} />
          <ToolbarButton icon={RotateCcw} label="Fit to view" onClick={handleFitToView} />
        </div>
      </div>
      <div ref={containerRef} className="relative flex-1" />
      <input ref={fileInputRef} type="file" accept=".ifc" className="hidden" onChange={handleFileChange} />
    </div>
  );
}

function ToolbarButton({ icon: Icon, label, onClick, active }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            onClick={onClick}
            aria-label={label}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full border transition-colors duration-150",
              active
                ? "border-border bg-bg-muted text-text-primary"
                : "border-border bg-bg-card text-text-secondary hover:bg-bg-muted hover:text-text-primary"
            )}
          />
        }
      >
        <Icon className="h-4 w-4" />
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
