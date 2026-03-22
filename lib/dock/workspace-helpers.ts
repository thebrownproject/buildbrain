import type { DockviewApi, DockviewPanelRenderer } from "dockview-core";
import {
  LAYOUT_STORAGE_KEY,
  PANEL_COMPONENTS,
  PANEL_IDS,
  PANEL_TITLES,
  type PanelKey,
} from "./constants";

const ORDER: PanelKey[] = ["chat", "ifc", "pdf", "workbench"];

export type PanelVisibility = Record<PanelKey, boolean>;

export function visibilityFromApi(api: DockviewApi): PanelVisibility {
  return {
    chat: !!api.getPanel(PANEL_IDS.chat),
    ifc: !!api.getPanel(PANEL_IDS.ifc),
    pdf: !!api.getPanel(PANEL_IDS.pdf),
    workbench: !!api.getPanel(PANEL_IDS.workbench),
  };
}

function findRightmostReferenceId(api: DockviewApi): string | undefined {
  for (let i = ORDER.length - 1; i >= 0; i--) {
    const id = PANEL_IDS[ORDER[i]!];
    if (api.getPanel(id)) return id;
  }
  return undefined;
}

function rendererFor(key: PanelKey): DockviewPanelRenderer | undefined {
  return key === "ifc" || key === "pdf" ? "always" : undefined;
}

export function addPanel(api: DockviewApi, key: PanelKey): void {
  const id = PANEL_IDS[key];
  if (api.getPanel(id)) return;

  const base = {
    id,
    component: PANEL_COMPONENTS[key],
    title: PANEL_TITLES[key],
    renderer: rendererFor(key),
  } as const;

  const refId = findRightmostReferenceId(api);
  if (refId) {
    api.addPanel({
      ...base,
      floating: false,
      position: { direction: "right", referencePanel: refId },
    });
  } else {
    api.addPanel({ ...base });
  }
}

export function removePanel(api: DockviewApi, key: PanelKey): void {
  const p = api.getPanel(PANEL_IDS[key]);
  if (p) api.removePanel(p);
}

export function togglePanel(api: DockviewApi, key: PanelKey): void {
  if (api.getPanel(PANEL_IDS[key])) removePanel(api, key);
  else addPanel(api, key);
}

export function applyDefaultLayout(api: DockviewApi): void {
  api.clear();
  api.addPanel({
    id: PANEL_IDS.chat,
    component: PANEL_COMPONENTS.chat,
    title: PANEL_TITLES.chat,
    initialWidth: 320,
  });
  api.addPanel({
    id: PANEL_IDS.ifc,
    component: PANEL_COMPONENTS.ifc,
    title: PANEL_TITLES.ifc,
    renderer: "always",
    floating: false,
    position: { direction: "right", referencePanel: PANEL_IDS.chat },
  });
  api.addPanel({
    id: PANEL_IDS.workbench,
    component: PANEL_COMPONENTS.workbench,
    title: PANEL_TITLES.workbench,
    floating: false,
    initialWidth: 340,
    position: { direction: "right", referencePanel: PANEL_IDS.ifc },
  });
}

export function tryLoadStoredLayout(api: DockviewApi): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return false;
    try {
      api.fromJSON(data);
      return true;
    } catch {
      localStorage.removeItem(LAYOUT_STORAGE_KEY);
      return false;
    }
  } catch {
    return false;
  }
}
