// ── Shared Ingest Helpers ──────────────────────────────────────────────────
// Constants and utilities shared across IFC and PDF extractors.
// No "use node" directive — pure constants and types.

/** Maximum elements/rows per batch insert mutation call. */
export const BATCH_SIZE = 50;

/**
 * Format an error into a prefixed message string.
 * Extracts .message from Error instances, otherwise stringifies.
 */
export function formatError(error: unknown, prefix: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${prefix}: ${message}`;
}
