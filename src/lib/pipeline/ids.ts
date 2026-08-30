import { createHash } from "node:crypto";

/** Stable row id: same URL always maps to the same row across runs. */
export function opportunityId(source: string, url: string): string {
  const canonical = url.replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();
  return `${source}_${createHash("sha256").update(canonical).digest("hex").slice(0, 16)}`;
}

/**
 * Hash of the page's meaningful content.
 *
 * Whitespace and digit-only churn (view counters, "last updated" stamps) would
 * otherwise make every page look changed on every crawl and burn the entire
 * LLM budget re-extracting text that is identical. Normalising both out means
 * a stable page costs one fetch and zero tokens.
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
