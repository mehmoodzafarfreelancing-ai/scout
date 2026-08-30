import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyFilter } from "@/lib/db/json-repo";
import type { Study } from "@/lib/db/types";
import { computeGaps, displayLabel, explainGap, gapScore, normaliseCondition } from "./gaps";
import { contentHash, studyId } from "./ids";

const study = (over: Partial<Study> = {}): Study => ({
  id: "x",
  source: "clinicaltrials",
  source_ref: "NCT00000001",
  source_url: "https://clinicaltrials.gov/study/NCT00000001",
  title: "A trial of something",
  condition: "type 2 diabetes",
  intervention: "metformin",
  study_type: "interventional",
  sample_size: 200,
  countries: ["Pakistan"],
  population_note: "Adults recruited at two hospitals in Lahore.",
  representation: "primary",
  year: 2024,
  confidence: 0.9,
  content_hash: "h",
  enriched: false,
  first_seen_at: "2026-01-01T00:00:00.000Z",
  last_seen_at: "2026-01-01T00:00:00.000Z",
  extracted_by: "test",
  ...over,
});

describe("ids", () => {
  it("gives the same id for the same reference regardless of case or padding", () => {
    assert.equal(studyId("clinicaltrials", " NCT12345 "), studyId("clinicaltrials", "nct12345"));
  });

  it("separates the same reference under different sources", () => {
    assert.notEqual(studyId("clinicaltrials", "123"), studyId("europepmc", "123"));
  });

  it("ignores whitespace and clock churn when hashing content", () => {
    // Without this, a "last updated 14:32" stamp re-triggers extraction daily.
    assert.equal(contentHash("Enrolled 14:32 today"), contentHash("Enrolled   09:01   today"));
  });

  it("still detects a real content change", () => {
    assert.notEqual(contentHash("Enrollment: 100"), contentHash("Enrollment: 200"));
  });
});

describe("normaliseCondition", () => {
  it("folds word order and the mellitus suffix together", () => {
    assert.equal(
      normaliseCondition("Diabetes Mellitus, Type 2"),
      normaliseCondition("type 2 diabetes"),
    );
  });

  it("keeps genuinely different conditions apart", () => {
    assert.notEqual(normaliseCondition("tuberculosis"), normaliseCondition("hepatitis c"));
  });
});

describe("displayLabel", () => {
  it("picks the most common spelling in the group", () => {
    const rows = [
      study({ condition: "tuberculosis" }),
      study({ condition: "tuberculosis" }),
      study({ condition: "Tuberculosis, Pulmonary" }),
    ];
    assert.equal(displayLabel(rows), "tuberculosis");
  });

  it("breaks ties on the shorter name, which is the cleaner one", () => {
    const rows = [study({ condition: "tuberculosis" }), study({ condition: "pulmonary tuberculosis" })];
    assert.equal(displayLabel(rows), "tuberculosis");
  });
});

describe("gapScore", () => {
  it("is zero when every study reached the region", () => {
    assert.equal(gapScore(10, 10, 0, 0), 0);
  });

  it("rises as coverage falls", () => {
    assert.ok(gapScore(10, 0, 0, 0) > gapScore(10, 5, 0, 0));
  });

  it("gives a partial cohort half the credit of a primary one", () => {
    assert.ok(gapScore(10, 0, 4, 0) > gapScore(10, 4, 0, 0));
  });

  it("excludes unreported records from the denominator rather than counting them as absent", () => {
    // The central rule. Eight studies, two that reported and both reached the
    // region: that is full coverage, not 25%.
    assert.equal(gapScore(8, 2, 0, 6), 0);
  });

  it("returns zero rather than dividing by zero when nothing reported", () => {
    assert.equal(gapScore(5, 0, 0, 5), 0);
  });

  it("weights a large evidence base above a small one at equal coverage", () => {
    assert.ok(gapScore(50, 0, 0, 0) > gapScore(3, 0, 0, 0));
  });

  it("saturates instead of running away with volume", () => {
    assert.ok(gapScore(5000, 0, 0, 0) <= 1);
  });

  it("is zero for an empty set", () => {
    assert.equal(gapScore(0, 0, 0, 0), 0);
  });
});

describe("computeGaps", () => {
  const rows = [
    study({ id: "a", condition: "Type 2 Diabetes", representation: "primary", sample_size: 100 }),
    study({ id: "b", condition: "diabetes mellitus, type 2", representation: "none", sample_size: 900 }),
    study({ id: "c", condition: "type 2 diabetes", representation: "unclear", sample_size: null }),
    study({ id: "d", condition: "tuberculosis", representation: "none", sample_size: 50 }),
  ];

  it("groups spellings of one condition into a single row", () => {
    const gaps = computeGaps(rows);
    assert.equal(gaps.length, 2);
    const diabetes = gaps.find((g) => g.condition.includes("diabetes"))!;
    assert.equal(diabetes.total_studies, 3);
  });

  it("names the group readably rather than by its sort key", () => {
    // Regression: the grouping key is word-sorted, so using it as the label
    // rendered "2 diabetes type" on the dashboard.
    const label = computeGaps(rows).find((g) => g.condition.includes("diabetes"))!.condition;
    assert.ok(!/^2 /.test(label), `expected a readable label, got "${label}"`);
  });

  it("counts each representation state separately", () => {
    const diabetes = computeGaps(rows).find((g) => g.condition.includes("diabetes"))!;
    assert.equal(diabetes.primary_count, 1);
    assert.equal(diabetes.none_count, 1);
    assert.equal(diabetes.unclear_count, 1);
  });

  it("sums participants, treating a missing sample size as zero", () => {
    const diabetes = computeGaps(rows).find((g) => g.condition.includes("diabetes"))!;
    assert.equal(diabetes.total_participants, 1000);
    assert.equal(diabetes.represented_participants, 100);
  });

  it("sorts the worst gap first", () => {
    const gaps = computeGaps(rows);
    assert.ok(gaps[0]!.gap_score >= gaps[1]!.gap_score);
  });
});

describe("explainGap", () => {
  it("says plainly when nothing reached the region", () => {
    const gap = computeGaps([study({ representation: "none" })])[0]!;
    assert.ok(explainGap(gap).some((r) => /No study/.test(r)));
  });

  it("reports unreported records as excluded, not as absent", () => {
    const gap = computeGaps([
      study({ id: "a", representation: "unclear" }),
      study({ id: "b", representation: "none" }),
    ])[0]!;
    assert.ok(explainGap(gap).some((r) => /did not report/.test(r) && /Excluded/.test(r)));
  });

  it("warns when the sample is too small to conclude from", () => {
    const gap = computeGaps([study()])[0]!;
    assert.ok(explainGap(gap).some((r) => /Too few/.test(r)));
  });
});

describe("applyFilter", () => {
  const rows = [
    study({ id: "a", representation: "none", year: 2020 }),
    study({ id: "b", representation: "primary", year: 2024 }),
    study({ id: "c", representation: "unclear", year: 2022, condition: "tuberculosis" }),
  ];

  it("leads with the studies that reached the region", () => {
    assert.deepEqual(
      applyFilter(rows, {}).map((r) => r.id),
      ["b", "c", "a"],
    );
  });

  it("filters by representation", () => {
    assert.deepEqual(
      applyFilter(rows, { representation: "unclear" }).map((r) => r.id),
      ["c"],
    );
  });

  it("matches a condition through its normalised form", () => {
    assert.deepEqual(
      applyFilter(rows, { condition: "Diabetes Mellitus, Type 2" }).map((r) => r.id),
      ["b", "a"],
    );
  });

  it("searches title, condition and population note case-insensitively", () => {
    assert.equal(applyFilter(rows, { q: "LAHORE" }).length, 3);
    assert.equal(applyFilter(rows, { q: "no such thing" }).length, 0);
  });

  it("paginates", () => {
    assert.deepEqual(
      applyFilter(rows, { limit: 1, offset: 1 }).map((r) => r.id),
      ["c"],
    );
  });
});
