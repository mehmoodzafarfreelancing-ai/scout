import type { ExtractedStudy } from "@/lib/db/types";

/**
 * Field-level grading for extraction output.
 *
 * Two principles. Grade meaning, not strings: "type 2 diabetes" and "Diabetes
 * Mellitus, Type 2" are the same condition and both are correct. And grade each
 * field separately, because a run that reads every population correctly but
 * misses every sample size is a very different failure from the reverse, and a
 * single accuracy number hides which one you have.
 */

export type Label = {
  ref: string;
  source: string;
  should_extract: boolean;
  condition_accept?: string[];
  study_type?: string;
  sample_size?: number | null;
  countries?: string[];
  representation?: string;
  year?: number | null;
  note?: string;
};

export type FieldGrade = { field: string; score: number; expected: string; got: string };

const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const show = (v: unknown) => (v === null || v === undefined ? "—" : String(v));

/** Set F1: rewards recall without letting a scattergun answer win. */
export function setF1(expected: string[], got: string[]): number {
  const e = new Set(expected.map(norm));
  const g = new Set(got.map(norm));
  if (e.size === 0 && g.size === 0) return 1;
  if (e.size === 0 || g.size === 0) return 0;

  let hits = 0;
  for (const x of g) if (e.has(x)) hits++;
  const precision = hits / g.size;
  const recall = hits / e.size;
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

function conditionScore(accept: string[], got: string): number {
  const g = norm(got);
  // Word-set overlap, so "type 2 diabetes" matches "diabetes mellitus type 2"
  // without needing every alias spelled out in the labels.
  return accept.some((a) => {
    const e = norm(a);
    if (g === e || g.includes(e) || e.includes(g)) return true;
    const ew = new Set(e.split(" "));
    const gw = e.split(" ").length === 0 ? [] : g.split(" ");
    const shared = gw.filter((w) => ew.has(w)).length;
    return shared >= Math.max(2, Math.ceil(ew.size * 0.6));
  })
    ? 1
    : 0;
}

export function gradeCase(label: Label, got: ExtractedStudy): FieldGrade[] {
  const grades: FieldGrade[] = [];

  if (label.condition_accept) {
    grades.push({
      field: "condition",
      score: conditionScore(label.condition_accept, got.condition),
      expected: label.condition_accept[0] ?? "—",
      got: got.condition,
    });
  }

  if (label.study_type !== undefined) {
    grades.push({
      field: "study_type",
      score: label.study_type === got.study_type ? 1 : 0,
      expected: label.study_type,
      got: got.study_type,
    });
  }

  if (label.sample_size !== undefined) {
    grades.push({
      field: "sample_size",
      score: label.sample_size === got.sample_size ? 1 : 0,
      expected: show(label.sample_size),
      got: show(got.sample_size),
    });
  }

  if (label.countries) {
    grades.push({
      field: "countries",
      score: setF1(label.countries, got.countries),
      expected: label.countries.join(", ") || "—",
      got: got.countries.join(", ") || "—",
    });
  }

  if (label.year !== undefined) {
    grades.push({
      field: "year",
      score: label.year === got.year ? 1 : 0,
      expected: show(label.year),
      got: show(got.year),
    });
  }

  /**
   * Representation is graded last and weighted nowhere, because it does not
   * need weighting: it is reported as its own line and it is the only field the
   * product's conclusions actually rest on. Everything else is context.
   *
   * There is no partial credit. Calling an unreported population "none" is the
   * failure this whole system exists to avoid, and scoring it as "nearly right"
   * would hide exactly the error that matters.
   */
  if (label.representation !== undefined) {
    grades.push({
      field: "representation",
      score: label.representation === got.representation ? 1 : 0,
      expected: label.representation,
      got: got.representation,
    });
  }

  return grades;
}

/**
 * Confusions worth counting separately.
 *
 * "said none when the truth was unclear" is a different and more damaging error
 * than "said unclear when the truth was none": the first invents a measured
 * absence out of a silent record and inflates every gap score downstream.
 */
export function confusionOf(expected: string, got: string): string | null {
  if (expected === got) return null;
  return `${expected}→${got}`;
}
