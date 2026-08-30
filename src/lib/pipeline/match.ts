import type { Match, Opportunity, Profile } from "@/lib/db/types";

/**
 * Explainable relevance scoring.
 *
 * Deliberately not embeddings. A researcher deciding whether to spend three
 * weeks on an application needs to know *why* something surfaced, and a cosine
 * distance cannot tell them. Every point here traces to a named reason shown in
 * the UI. Embeddings would be the right upgrade for recall once there are
 * enough rows that keyword overlap starts missing things — the interface
 * wouldn't change, only the body of this function.
 */

const WEIGHTS = {
  discipline: 0.4,
  keyword: 0.25,
  deadline: 0.15,
  award: 0.1,
  confidence: 0.1,
} as const;

const norm = (s: string) => s.toLowerCase().trim();

export function scoreOpportunity(
  opp: Opportunity,
  profile: Profile,
  now = new Date(),
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // ── Discipline overlap ──────────────────────────────────────────────────
  const oppDisciplines = new Set(opp.disciplines.map(norm));
  const hits = profile.disciplines.filter((d) => oppDisciplines.has(norm(d)));
  if (hits.length > 0) {
    const ratio = Math.min(hits.length / Math.max(profile.disciplines.length, 1), 1);
    score += WEIGHTS.discipline * ratio;
    reasons.push(`Matches your field: ${hits.join(", ")}`);
  }

  // ── Keyword presence in title/summary ───────────────────────────────────
  const haystack = norm(`${opp.title} ${opp.summary} ${opp.programme ?? ""}`);
  const kwHits = profile.keywords.filter((k) => haystack.includes(norm(k)));
  if (kwHits.length > 0) {
    score += WEIGHTS.keyword * Math.min(kwHits.length / 3, 1);
    reasons.push(`Mentions ${kwHits.slice(0, 3).join(", ")}`);
  }

  // ── Deadline pressure ───────────────────────────────────────────────────
  if (opp.status === "closed") {
    reasons.push("Closed — shown for reference only");
    return { score: Math.min(score * 0.2, 1), reasons };
  }
  if (opp.deadline) {
    const days = Math.ceil((Date.parse(opp.deadline) - now.getTime()) / 864e5);
    if (days < 0) {
      reasons.push("Deadline has passed");
      return { score: Math.min(score * 0.2, 1), reasons };
    }
    if (days <= 14) {
      // Urgent but still actionable — worth surfacing, flagged as tight.
      score += WEIGHTS.deadline * 0.6;
      reasons.push(`Closes in ${days} day${days === 1 ? "" : "s"} — tight turnaround`);
    } else if (days <= 120) {
      score += WEIGHTS.deadline;
      reasons.push(`${days} days to prepare`);
    } else {
      score += WEIGHTS.deadline * 0.5;
      reasons.push(`Opens well ahead — ${days} days out`);
    }
  } else if (opp.status === "rolling") {
    score += WEIGHTS.deadline * 0.8;
    reasons.push("Rolling submission — apply any time");
  }

  // ── Award size vs. the floor the researcher cares about ─────────────────
  if (profile.min_award !== null && opp.award) {
    const ceiling = opp.award.max ?? opp.award.min;
    if (ceiling !== null && ceiling >= profile.min_award) {
      score += WEIGHTS.award;
      reasons.push(`Award up to ${formatMoney(ceiling, opp.award.currency)}`);
    } else if (ceiling !== null) {
      reasons.push(`Below your ${formatMoney(profile.min_award, "USD")} threshold`);
    }
  } else if (opp.award) {
    score += WEIGHTS.award * 0.5;
  }

  // ── Extraction confidence gates everything else ─────────────────────────
  score += WEIGHTS.confidence * opp.confidence;
  if (opp.confidence < 0.5) reasons.push("Low-confidence extraction — verify on the source page");

  return { score: Number(Math.min(score, 1).toFixed(3)), reasons };
}

export function scoreAll(opps: Opportunity[], profile: Profile, now = new Date()): Match[] {
  const scoredAt = now.toISOString();
  return opps
    .map((opp) => {
      const { score, reasons } = scoreOpportunity(opp, profile, now);
      return { opportunity_id: opp.id, profile_id: profile.id, score, reasons, scored_at: scoredAt };
    })
    .sort((a, b) => b.score - a.score);
}

export function formatMoney(amount: number, currency: string): string {
  const symbol = { USD: "$", GBP: "£", EUR: "€" }[currency] ?? `${currency} `;
  if (amount >= 1e6) return `${symbol}${(amount / 1e6).toFixed(amount % 1e6 === 0 ? 0 : 1)}M`;
  if (amount >= 1e3) return `${symbol}${Math.round(amount / 1e3)}k`;
  return `${symbol}${amount}`;
}
