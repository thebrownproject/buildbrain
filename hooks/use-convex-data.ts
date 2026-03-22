"use client";

import { useQuery, useMutation, usePaginatedQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

/**
 * Convex data hooks for BuildBrain panels.
 * All hooks gracefully return undefined when Convex is not connected
 * (no NEXT_PUBLIC_CONVEX_URL), allowing mock data fallback in components.
 */

// Projects
export function useProjects() {
  return useQuery(api.projects.listByUser);
}

export function useProject(projectId: Id<"projects"> | null) {
  return useQuery(api.projects.get, projectId ? { projectId } : "skip");
}

// Files
export function useProjectFiles(projectId: Id<"projects"> | null) {
  return useQuery(api.files.listByProject, projectId ? { projectId } : "skip");
}

// Threads
export function useThread(projectId: Id<"projects"> | null) {
  return useQuery(api.threads.getByProject, projectId ? { projectId } : "skip");
}

// Messages (paginated, newest-first)
export function useMessages(threadId: Id<"threads"> | null) {
  return usePaginatedQuery(
    api.messages.list,
    threadId ? { threadId } : "skip",
    { initialNumItems: 25 }
  );
}

export function useSendMessage() {
  return useMutation(api.messages.send);
}

// Stream deltas (conditional on streaming status)
export function useStreamDeltas(messageId: Id<"messages"> | null, enabled: boolean) {
  return useQuery(
    api.streamDeltas.list,
    enabled && messageId ? { messageId } : "skip"
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
  return usePaginatedQuery(
    api.elements.listByGroup,
    groupId ? { groupId } : "skip",
    { initialNumItems: 50 }
  );
}

// Agent jobs (real-time progress)
export function useActiveJobs(projectId: Id<"projects"> | null) {
  return useQuery(api.agentJobs.getActive, projectId ? { projectId } : "skip");
}

// User preferences
export function useUserPreferences() {
  return useQuery(api.users.getPreferences);
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
