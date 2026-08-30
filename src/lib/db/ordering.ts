import type { Study } from "./types";

/**
 * The default ordering, shared by both stores.
 *
 * Having the JSON store and Supabase disagree about row order is the kind of
 * bug that only shows up in a demo. Since a page is capped at a couple of
 * hundred rows, both stores fetch and then sort here: one comparator, one
 * behaviour.
 */
export function compareStudies(a: Study, b: Study): number {
  // Records that reached the region lead, because they are the ones a reader is
  // looking for when they are checking whether a gap is real.
  const rank = tier(a) - tier(b);
  if (rank !== 0) return rank;

  if (a.year !== b.year) {
    if (a.year === null) return 1;
    if (b.year === null) return -1;
    return b.year - a.year;
  }

  if (a.confidence !== b.confidence) return b.confidence - a.confidence;
  return a.title.localeCompare(b.title);
}

function tier(s: Study): number {
  switch (s.representation) {
    case "primary":
      return 0;
    case "partial":
      return 1;
    case "unclear":
      return 2;
    case "none":
      return 3;
  }
}
