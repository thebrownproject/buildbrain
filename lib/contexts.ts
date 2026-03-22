"use client";

import { createContext, useContext } from "react";

export type ViewerCommand =
  | { type: "highlight"; guids: string[] }
  | { type: "isolate"; guids: string[] }
  | { type: "clearHighlight" }
  | { type: "fitToElement"; guid: string };

export const ViewerCommandContext = createContext<{
  sendCommand: (cmd: ViewerCommand) => void;
}>({ sendCommand: () => {} });

export function useViewerCommand() {
  return useContext(ViewerCommandContext);
}

export type WorkbenchCommand =
  | { type: "focusArtifact"; artifactId: string }
  | { type: "focusIssue"; issueId: string }
  | { type: "scrollToRow"; artifactId: string; rowIndex: number };

export const WorkbenchCommandContext = createContext<{
  sendCommand: (cmd: WorkbenchCommand) => void;
}>({ sendCommand: () => {} });

export function useWorkbenchCommand() {
  return useContext(WorkbenchCommandContext);
}
