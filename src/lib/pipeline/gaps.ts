import type { Gap, Study } from "@/lib/db/types";

/**
 * Evidence gap analysis.
 *
 * The question this answers: for a given condition, how much research exists
 * globally, and how little of it reached South Asian populations?
 *
 * The scoring is arithmetic on counts rather than a model, on purpose. A number
 * that decides where a research organisation spends a year of fieldwork has to
 * be defensible line by line, and every input here is a count someone can
 * recheck against the underlying rows.
 */

/**
 * A partial cohort counts for half.
 *
 * Being 4% of a European trial is not the same as being the population it was
 * designed around: the trial was not powered to detect a difference in that
 * subgroup, so it cannot answer the question for them. Half is a judgement, and
 * it is stated here rather than buried so it can be argued with.
 */
const PARTIAL_CREDIT = 0.5;

/**
 * Where volume stops adding to the gap.
 *
 * A condition with 200 studies and none reaching the region is a worse gap than
 * one with 20. A condition with 2000 is not ten times worse than 200, so the
 * curve saturates rather than running away.
 */
const VOLUME_SATURATION = 60;

export function computeGaps(studies: Study[], now = new Date()): Gap[] {
  const byCondition = new Map<string, Study[]>();
  for (const study of studies) {
    const key = normaliseCondition(study.condition);
    byCondition.set(key, [...(byCondition.get(key) ?? []), study]);
  }

  const computedAt = now.toISOString();

  return [...byCondition.entries()]
    .map(([, rows]) => {
      const count = (r: Study["representation"]) => rows.filter((s) => s.representation === r).length;

      const primary = count("primary");
      const partial = count("partial");
      const none = count("none");
      const unclear = count("unclear");

      const participants = (predicate: (s: Study) => boolean) =>
        rows.filter(predicate).reduce((sum, s) => sum + (s.sample_size ?? 0), 0);

      return {
        // The grouping key is word-sorted so spellings collapse, which makes it
        // unreadable ("2 diabetes type"). Store the label a person would write
        // instead, and pick it by frequency so one odd extraction cannot name
        // the whole group.
        condition: displayLabel(rows),
        total_studies: rows.length,
        primary_count: primary,
        partial_count: partial,
        none_count: none,
        unclear_count: unclear,
        represented_participants: participants(
          (s) => s.representation === "primary" || s.representation === "partial",
        ),
        total_participants: participants(() => true),
        gap_score: gapScore(rows.length, primary, partial, unclear),
        computed_at: computedAt,
      };
    })
    .sort((a, b) => b.gap_score - a.gap_score);
}

export function gapScore(total: number, primary: number, partial: number, unclear: number): number {
  if (total === 0) return 0;

  // Records that never said who was enrolled cannot count as coverage, and
  // cannot count against it either. Removing them from the denominator means an
  // under-reported literature does not masquerade as a measured absence.
  const known = total - unclear;

  // If nothing reported, there is no coverage ratio to compute. Scoring this as
  // a maximum gap would be asserting an absence that was never measured, which
  // is the exact error the unclear/none split exists to prevent. Unknown ranks
  // as zero and the count is surfaced in the UI instead.
  if (known <= 0) return 0;

  const coverage = Math.min(1, (primary + partial * PARTIAL_CREDIT) / known);

  const volume = Math.min(1, Math.log1p(total) / Math.log1p(VOLUME_SATURATION));

  return Number((volume * (1 - coverage)).toFixed(3));
}

/** Plain sentences explaining a gap score, shown next to it in the UI. */
export function explainGap(gap: Gap): string[] {
  const reasons: string[] = [];

  const reached = gap.primary_count + gap.partial_count;
  if (reached === 0) {
    reasons.push(`No study in this set recruited a South Asian population.`);
  } else {
    reasons.push(
      `${reached} of ${gap.total_studies} studies reached the region ` +
        `(${gap.primary_count} primarily, ${gap.partial_count} as part of a wider cohort).`,
    );
  }

  if (gap.unclear_count > 0) {
    const pct = Math.round((gap.unclear_count / gap.total_studies) * 100);
    reasons.push(
      `${gap.unclear_count} record${gap.unclear_count === 1 ? "" : "s"} (${pct}%) did not report where participants were recruited. ` +
        `Excluded from the ratio rather than counted as absent.`,
    );
  }

  if (gap.total_participants > 0) {
    const pct = Math.round((gap.represented_participants / gap.total_participants) * 100);
    reasons.push(
      `${gap.represented_participants.toLocaleString()} of ${gap.total_participants.toLocaleString()} ` +
        `reported participants (${pct}%) were in a study that reached the region.`,
    );
  }

  if (gap.total_studies < 5) {
    reasons.push(`Only ${gap.total_studies} studies matched. Too few to draw a firm conclusion.`);
  }

  return reasons;
}

/**
 * Fold trivially different spellings of the same condition together.
 *
 * Registries are inconsistent: "Type 2 Diabetes", "type 2 diabetes mellitus"
 * and "Diabetes Mellitus, Type 2" are one condition. Without this, the counts
 * split across near-duplicate rows and every gap looks smaller than it is.
 */
export function normaliseCondition(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[(),.]/g, " ")
    .replace(/\bmellitus\b/g, "")
    .replace(/\bdisease[s]?\b/g, "disease")
    .replace(/\s+/g, " ")
    .trim();

  // "diabetes mellitus, type 2" and "type 2 diabetes" are the same words in a
  // different order, so ordering them makes the two collapse.
  const words = cleaned.split(" ").filter(Boolean).sort();
  return words.join(" ");
}

/** The most common raw spelling in a group, used as its display name. */
export function displayLabel(rows: Study[]): string {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const label = r.condition.trim().toLowerCase();
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  // Ties break on the shorter string, which is almost always the cleaner name:
  // "tuberculosis" over "tuberculosis, pulmonary, drug-resistant".
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0] ?? "unspecified";
}
