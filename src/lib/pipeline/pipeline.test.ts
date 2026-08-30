import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyFilter } from "@/lib/db/json-repo";
import type { Opportunity, Profile } from "@/lib/db/types";
import { contentHash, opportunityId } from "./ids";
import { formatMoney, scoreOpportunity } from "./match";
import { SOURCES, selectCandidates } from "./sources";

const opp = (over: Partial<Opportunity> = {}): Opportunity => ({
  id: "x",
  source: "nsf",
  source_url: "https://example.org/x",
  title: "Machine Learning Systems Grant",
  funder: "NSF",
  programme: null,
  summary: "Funding for distributed systems and machine learning research.",
  disciplines: ["computer science", "engineering"],
  eligibility: null,
  award: { min: 100_000, max: 500_000, currency: "USD" },
  deadline: "2026-12-01",
  status: "open",
  confidence: 0.9,
  content_hash: "h",
  first_seen_at: "2026-01-01T00:00:00.000Z",
  last_seen_at: "2026-01-01T00:00:00.000Z",
  extracted_by: "test",
  ...over,
});

const profile: Profile = {
  id: "p",
  name: "Test",
  disciplines: ["computer science", "engineering"],
  keywords: ["machine learning", "distributed systems"],
  career_stage: "early-career",
  country: "PK",
  min_award: 50_000,
};

const NOW = new Date("2026-09-01T00:00:00.000Z");

describe("ids", () => {
  it("gives the same id for URLs differing only in case or trailing slash", () => {
    assert.equal(
      opportunityId("nsf", "https://Example.org/Funding/A/"),
      opportunityId("nsf", "https://example.org/funding/a"),
    );
  });

  it("separates the same path under different sources", () => {
    assert.notEqual(
      opportunityId("nsf", "https://e.org/a"),
      opportunityId("ukri", "https://e.org/a"),
    );
  });

  it("ignores whitespace and clock churn when hashing content", () => {
    // Without this, a "last updated 14:32" stamp re-triggers extraction daily.
    assert.equal(contentHash("Deadline 14:32 today"), contentHash("Deadline   09:01   today"));
  });

  it("still detects a real content change", () => {
    assert.notEqual(contentHash("Award up to $1m"), contentHash("Award up to $2m"));
  });
});

describe("scoreOpportunity", () => {
  it("scores a strong match highly and explains why", () => {
    const { score, reasons } = scoreOpportunity(opp(), profile, NOW);
    assert.ok(score > 0.8, `expected > 0.8, got ${score}`);
    assert.ok(reasons.some((r) => r.includes("computer science")));
    assert.ok(reasons.some((r) => r.includes("machine learning")));
  });

  it("collapses the score for a passed deadline", () => {
    const { score, reasons } = scoreOpportunity(opp({ deadline: "2026-01-01" }), profile, NOW);
    assert.ok(score < 0.25, `expected < 0.25, got ${score}`);
    assert.ok(reasons.some((r) => /passed/i.test(r)));
  });

  it("collapses the score for a closed call", () => {
    const { score } = scoreOpportunity(opp({ status: "closed" }), profile, NOW);
    assert.ok(score < 0.25);
  });

  it("flags a tight turnaround without hiding the opportunity", () => {
    const { score, reasons } = scoreOpportunity(opp({ deadline: "2026-09-08" }), profile, NOW);
    assert.ok(score > 0.5);
    assert.ok(reasons.some((r) => /tight turnaround/.test(r)));
  });

  it("warns when the extraction was low confidence", () => {
    const { reasons } = scoreOpportunity(opp({ confidence: 0.3 }), profile, NOW);
    assert.ok(reasons.some((r) => /verify on the source page/.test(r)));
  });

  it("notes an award below the threshold the researcher set", () => {
    const small = opp({ award: { min: 1_000, max: 5_000, currency: "USD" } });
    const { reasons } = scoreOpportunity(small, profile, NOW);
    assert.ok(reasons.some((r) => /threshold/.test(r)));
  });

  it("never exceeds 1", () => {
    const { score } = scoreOpportunity(opp({ confidence: 1 }), profile, NOW);
    assert.ok(score <= 1);
  });
});

describe("selectCandidates", () => {
  const nsf = SOURCES.find((s) => s.id === "nsf")!;

  it("keeps only links matching the detail-page pattern for the source", () => {
    const picked = selectCandidates(nsf, [
      "https://www.nsf.gov/funding/opp/cise-core",
      "https://www.nsf.gov/news/story",
      "https://twitter.com/nsf",
    ]);
    assert.deepEqual(picked, ["https://www.nsf.gov/funding/opp/cise-core"]);
  });

  it("applies exclusions and drops the seed page itself", () => {
    const picked = selectCandidates(nsf, ["https://www.nsf.gov/funding/opp/a.pdf", nsf.seed]);
    assert.deepEqual(picked, []);
  });

  it("respects maxPages", () => {
    const many = Array.from({ length: 50 }, (_, i) => `https://www.nsf.gov/funding/opp/${i}`);
    assert.equal(selectCandidates(nsf, many).length, nsf.maxPages);
  });
});

describe("applyFilter", () => {
  const rows = [
    opp({ id: "a", deadline: "2027-01-01", disciplines: ["biology"] }),
    opp({ id: "b", deadline: "2026-10-01" }),
    opp({ id: "c", deadline: null, status: "rolling" }),
  ];

  it("sorts by soonest deadline with undated rows last", () => {
    assert.deepEqual(
      applyFilter(rows, {}).map((r) => r.id),
      ["b", "a", "c"],
    );
  });

  it("sinks closed and expired calls below everything actionable", () => {
    // Regression: ordering purely by deadline put a call that closed in 2024 at
    // the top of the list, because its date was the earliest one present.
    const withDead = [
      opp({ id: "closed", deadline: "2024-05-30", status: "closed" }),
      opp({ id: "expired", deadline: "2026-01-01", status: "open" }),
      ...rows,
    ];
    const ids = applyFilter(withDead, {}).map((r) => r.id);
    assert.deepEqual(ids.slice(0, 3), ["b", "a", "c"]);
    assert.deepEqual(ids.slice(3).sort(), ["closed", "expired"]);
  });

  it("filters by discipline", () => {
    assert.deepEqual(
      applyFilter(rows, { discipline: "Biology" }).map((r) => r.id),
      ["a"],
    );
  });

  it("searches title, funder and summary case-insensitively", () => {
    assert.equal(applyFilter(rows, { q: "MACHINE learning" }).length, 3);
    assert.equal(applyFilter(rows, { q: "no such thing" }).length, 0);
  });

  it("paginates", () => {
    assert.deepEqual(
      applyFilter(rows, { limit: 1, offset: 1 }).map((r) => r.id),
      ["a"],
    );
  });
});

describe("formatMoney", () => {
  it("abbreviates by magnitude", () => {
    assert.equal(formatMoney(3_000_000, "GBP"), "£3M");
    assert.equal(formatMoney(1_200_000, "GBP"), "£1.2M");
    assert.equal(formatMoney(750_000, "USD"), "$750k");
    assert.equal(formatMoney(400, "EUR"), "€400");
  });

  it("falls back to the code for unknown currencies", () => {
    assert.equal(formatMoney(500, "PKR"), "PKR 500");
  });
});
