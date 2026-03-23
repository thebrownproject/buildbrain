"use client";

import { useQuery, useMutation } from "convex/react";
import { useUIMessages, optimisticallySendMessage } from "@convex-dev/agent/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

/**
 * Convex data hooks for BuildBrain panels.
 * All hooks gracefully return undefined when Convex is not connected
 * (no NEXT_PUBLIC_CONVEX_URL), allowing mock data fallback in components.
 */

// Projects
export function useProjects(userId: Id<"users"> | null) {
  return useQuery(api.projects.listByUser, userId ? { userId } : "skip");
}

export function useProject(projectId: Id<"projects"> | null) {
  return useQuery(api.projects.get, projectId ? { projectId } : "skip");
}

// Files
export function useProjectFiles(projectId: Id<"projects"> | null) {
  return useQuery(api.files.listByProject, projectId ? { projectId } : "skip");
}

// ── V3 Agent Chat Hooks ──────────────────────────────────────────────────

// Thread messages with real-time streaming support.
// Uses useUIMessages from @convex-dev/agent/react which handles:
//   - Pagination via usePaginatedQuery
//   - Real-time streaming via syncStreams / useStreamingUIMessages
//   - Deduplication of messages that transition from streaming -> persisted
export function useThreadMessages(threadId: string | null) {
  return useUIMessages(
    api.agents.actions.listMessages,
    threadId ? { threadId } : "skip",
    { stream: true, initialNumItems: 50 },
  );
}

// Send a message with optimistic UI update.
// optimisticallySendMessage adds the user message to the local cache
// immediately, before the mutation round-trips to the server.
export function useSendMessage() {
  return useMutation(api.agents.actions.sendMessage).withOptimisticUpdate(
    optimisticallySendMessage(api.agents.actions.listMessages),
  );
}

// Create a new agent thread linked to a project.
export function useCreateThread() {
  return useMutation(api.agents.actions.createNewThread);
}

// Get all agent threads for a project.
export function useProjectThreads(projectId: Id<"projects"> | null) {
  return useQuery(
    api.agents.actions.getThreadsByProject,
    projectId ? { projectId } : "skip",
  );
}

// Artifacts
export function useArtifacts(projectId: Id<"projects"> | null) {
  return useQuery(api.artifacts.listByProject, projectId ? { projectId } : "skip");
}

export function useArtifactContent(artifactId: Id<"artifacts"> | null) {
  return useQuery(api.artifacts.getContent, artifactId ? { artifactId } : "skip");
}

// Issues
export function useIssues(projectId: Id<"projects"> | null) {
  return useQuery(api.issues.listByProject, projectId ? { projectId } : "skip");
}

export function useUpdateIssueStatus() {
  return useMutation(api.issues.updateStatus);
}

// Element groups + elements
export function useElementGroups(projectId: Id<"projects"> | null) {
  return useQuery(api.elementGroups.listByProject, projectId ? { projectId } : "skip");
}

export function useElements(groupId: Id<"elementGroups"> | null) {
  return useQuery(
    api.elements.listByGroup,
    groupId ? { groupId } : "skip",
  );
}

// User preferences
export function useUserPreferences(userId: Id<"users"> | null) {
  return useQuery(api.users.getPreferences, userId ? { userId } : "skip");
}

export function useUpdatePreferences() {
  return useMutation(api.users.updatePreferences);
}

// File upload
export function useGenerateUploadUrl() {
  return useMutation(api.files.generateUploadUrl);
}

export function useSaveUpload() {
  return useMutation(api.files.saveUpload);
}
