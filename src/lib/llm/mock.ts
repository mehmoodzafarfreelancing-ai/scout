import type { CompletionRequest, CompletionResult, LlmClient } from "./types";

/**
 * A deterministic, rule-based stand-in for a real model.
 *
 * Two jobs. First, it lets the whole pipeline run with zero API keys, so the
 * repo is clonable and CI is free. Second — and more usefully — it is the
 * baseline the real extractor is measured against: if a 70B model can't beat
 * these regexes on the eval set, the model isn't earning its latency.
 */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Cue words that tend to precede the date that actually matters. */
const DEADLINE_CUES = /deadline|clos(?:e|es|ed|ing)|due|submission|apply by/gi;

function firstDateIn(scope: string): string | null {
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(scope);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const long = /\b(\d{1,2})\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})\b/i.exec(scope);
  if (long) {
    const m = MONTHS[long[2]!.toLowerCase()];
    if (m) return `${long[3]}-${String(m).padStart(2, "0")}-${long[1]!.padStart(2, "0")}`;
  }

  const us = /\b([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i.exec(scope);
  if (us) {
    const m = MONTHS[us[1]!.toLowerCase()];
    if (m) return `${us[3]}-${String(m).padStart(2, "0")}-${us[2]!.padStart(2, "0")}`;
  }
  return null;
}

/**
 * Find the submission deadline.
 *
 * Anchoring on the *first* cue word is wrong: pages say "this scheme is closed"
 * or "eight years before the closing date" long before they state the real
 * date. So every cue gets its own window, and only if none of them contains a
 * date do we fall back to scanning the whole page.
 */
export function guessDeadline(text: string): string | null {
  for (const cue of text.matchAll(DEADLINE_CUES)) {
    const found = firstDateIn(text.slice(cue.index, cue.index + 220));
    if (found) return found;
  }
  return firstDateIn(text);
}

export function guessAward(text: string) {
  const cur = /£/.test(text) ? "GBP" : /€/.test(text) ? "EUR" : "USD";
  const nums = [...text.matchAll(/[$£€]\s?([\d,]+(?:\.\d+)?)\s*(million|m|k)?/gi)]
    .map((m) => {
      const base = Number(m[1]!.replace(/,/g, ""));
      const unit = m[2]?.toLowerCase();
      if (!Number.isFinite(base)) return null;
      return unit === "million" || unit === "m" ? base * 1e6 : unit === "k" ? base * 1e3 : base;
    })
    .filter((n): n is number => n !== null && n >= 500);

  if (nums.length === 0) return null;
  return { min: Math.min(...nums), max: Math.max(...nums), currency: cur };
}

const DISCIPLINES = [
  "biology", "chemistry", "physics", "mathematics", "computer science",
  "engineering", "medicine", "neuroscience", "climate", "materials science",
  "economics", "psychology", "genomics", "robotics", "energy",
];

export class MockLlmClient implements LlmClient {
  readonly name = "mock";
  readonly model = "rule-based-v1";

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    // The pipeline passes the page as "TITLE:\n...\n\nCONTENT:\n..."
    const title = /TITLE:\s*\n(.+)/.exec(req.user)?.[1]?.trim() ?? "Untitled opportunity";
    const body = req.user.split("CONTENT:").at(-1) ?? req.user;
    const lower = body.toLowerCase();

    const funder =
      /(National Science Foundation|National Institutes of Health|Wellcome Trust|Wellcome|UKRI|UK Research and Innovation|European Research Council|Horizon Europe|NSF|NIH|ERC)/i.exec(
        body,
      )?.[1] ?? "Unknown funder";

    const sentences = body
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter((s) => s.length > 40);

    const summary = (sentences.slice(0, 3).join(" ") || body.slice(0, 200)).slice(0, 1100);
    const disciplines = DISCIPLINES.filter((d) => lower.includes(d)).slice(0, 12);
    const deadline = guessDeadline(body);

    const status = /closed|no longer accepting/i.test(lower)
      ? "closed"
      : /rolling|continuous submission|no deadline/i.test(lower)
        ? "rolling"
        : deadline
          ? "open"
          : "unknown";

    const eligibility =
      /eligibilit(?:y|ies)[:\s]([\s\S]{0,400})/i.exec(body)?.[1]?.replace(/\s+/g, " ").trim() ??
      null;

    return {
      text: JSON.stringify({
        title: title.slice(0, 300),
        funder,
        programme: null,
        summary: summary.length >= 20 ? summary : `${summary} (insufficient page text)`,
        disciplines,
        eligibility,
        award: guessAward(body),
        deadline,
        status,
        // Honest about being a heuristic: never claims high confidence.
        confidence: Number((0.35 + Math.min(disciplines.length, 4) * 0.05).toFixed(2)),
      }),
      model: this.model,
      usage: null,
    };
  }
}
