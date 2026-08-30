import type { ExtractedOpportunity } from "@/lib/db/types";

/**
 * Field-level grading for extraction output.
 *
 * Two principles. Grade identity, not strings: "NSF" and "National Science
 * Foundation" name the same funder and both are correct. And grade each field
 * separately: a run that nails every deadline but guesses every award is a very
 * different failure from one that does the reverse, and a single accuracy
 * number hides which one you have.
 */

export type Label = {
  fixture: string;
  should_extract: boolean;
  funder_accept?: string[];
  deadline?: string | null;
  status?: string;
  award?: { min: number | null; max: number | null; currency: string } | null;
  disciplines?: string[];
};

export type FieldGrade = { field: string; score: number; expected: string; got: string };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const show = (v: unknown) => (v === null || v === undefined ? "—" : String(v));

/** Amounts are correct within 1%; funders round and restate figures constantly. */
function moneyMatches(expected: number | null, got: number | null): boolean {
  if (expected === null) return got === null;
  if (got === null) return false;
  return Math.abs(got - expected) <= Math.max(expected * 0.01, 1);
}

function funderScore(accept: string[], got: string): number {
  const g = norm(got);
  // Substring either way: "Wellcome" inside "Wellcome Trust" is right, and so
  // is an extractor that supplies the fuller official name.
  return accept.some((a) => {
    const e = norm(a);
    return g === e || g.includes(e) || e.includes(g);
  })
    ? 1
    : 0;
}

/** F1 over normalised sets: rewards recall without letting a scattergun win. */
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

export function gradeCase(label: Label, got: ExtractedOpportunity): FieldGrade[] {
  const grades: FieldGrade[] = [];

  if (label.funder_accept) {
    grades.push({
      field: "funder",
      score: funderScore(label.funder_accept, got.funder),
      expected: label.funder_accept[0] ?? "—",
      got: got.funder,
    });
  }

  if (label.deadline !== undefined) {
    grades.push({
      field: "deadline",
      score: label.deadline === got.deadline ? 1 : 0,
      expected: show(label.deadline),
      got: show(got.deadline),
    });
  }

  if (label.status !== undefined) {
    grades.push({
      field: "status",
      score: label.status === got.status ? 1 : 0,
      expected: label.status,
      got: got.status,
    });
  }

  if (label.award !== undefined) {
    // Min and max are scored separately: reading the ceiling correctly while
    // missing the floor is a partial success, and averaging says so.
    const expected = label.award;
    const got_ = got.award;
    const parts = expected === null || got_ === null
      ? [expected === got_ ? 1 : 0]
      : [
          moneyMatches(expected.min, got_.min) ? 1 : 0,
          moneyMatches(expected.max, got_.max) ? 1 : 0,
          expected.currency === got_.currency ? 1 : 0,
        ];
    grades.push({
      field: "award",
      score: parts.reduce((a, b) => a + b, 0) / parts.length,
      expected: expected ? `${show(expected.min)}–${show(expected.max)} ${expected.currency}` : "—",
      got: got_ ? `${show(got_.min)}–${show(got_.max)} ${got_.currency}` : "—",
    });
  }

  if (label.disciplines) {
    grades.push({
      field: "disciplines",
      score: setF1(label.disciplines, got.disciplines),
      expected: label.disciplines.join(", "),
      got: got.disciplines.join(", ") || "—",
    });
  }

  // Summary prose can't be graded without a judge model. Checking that it is
  // present and substantive is honest; claiming to score its quality is not.
  grades.push({
    field: "summary",
    score: got.summary.trim().length >= 60 ? 1 : 0,
    expected: "≥60 chars",
    got: `${got.summary.trim().length} chars`,
  });

  return grades;
}
