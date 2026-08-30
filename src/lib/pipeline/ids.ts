import { createHash } from "node:crypto";

/** Stable row id: the same source record always maps to the same row. */
export function studyId(source: string, ref: string): string {
  const canonical = ref.trim().toLowerCase();
  return `${source}_${createHash("sha256").update(canonical).digest("hex").slice(0, 16)}`;
}

/**
 * Hash of the record's meaningful content.
 *
 * Whitespace and digit-only churn (view counters, "last updated" stamps) would
 * otherwise make every record look changed on every run and burn the entire
 * LLM budget re-extracting text that is identical. Normalising both out means a
 * stable record costs one API read and zero tokens.
 */
export function contentHash(text: string): string {
  const normalised = text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, "")
    .trim();
  return createHash("sha256").update(normalised).digest("hex");
}

export function runId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
