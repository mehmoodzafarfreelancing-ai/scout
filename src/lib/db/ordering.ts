import type { Opportunity } from "./types";

/**
 * The default ordering, shared by both stores.
 *
 * Postgres cannot express "closed last, then soonest deadline, then undated"
 * in a single index-friendly ORDER BY without a computed column, and having
 * the JSON store and Supabase disagree about row order is the kind of bug that
 * only shows up in a demo. Since a page is capped at a couple of hundred rows,
 * both stores fetch and then sort here — one comparator, one behaviour.
 */
export function compareOpportunities(a: Opportunity, b: Opportunity, now = new Date()): number {
  const rankA = tier(a, now);
  const rankB = tier(b, now);
  if (rankA !== rankB) return rankA - rankB;

  // Within a tier: soonest deadline first, undated last, then most recent.
  if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
  if (a.deadline) return -1;
  if (b.deadline) return 1;
  return b.last_seen_at.localeCompare(a.last_seen_at);
}

/** 0 = still actionable, 1 = closed or the deadline has passed. */
function tier(o: Opportunity, now: Date): number {
  if (o.status === "closed") return 1;
  if (o.deadline && Date.parse(o.deadline) < now.getTime()) return 1;
  return 0;
}
