export const PANEL_IDS = {
  chat: "panel-chat",
  ifc: "panel-ifc",
  pdf: "panel-pdf",
  workbench: "panel-workbench",
} as const;

export type PanelKey = keyof typeof PANEL_IDS;

export const PANEL_COMPONENTS = {
  chat: "chat",
  ifc: "ifc",
  pdf: "pdf",
  workbench: "workbench",
} as const satisfies Record<PanelKey, string>;

export const PANEL_TITLES: Record<PanelKey, string> = {
  chat: "Assistant",
  ifc: "Model",
  pdf: "Drawings",
  workbench: "Workbench",
};

export const LAYOUT_STORAGE_KEY = "buildbrain-dock-layout-v3";
