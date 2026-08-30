import { readFile, writeFile, mkdir } from "node:fs/promises";
// Type-only imports are erased, so they are safe above loadEnv().
import type { FieldGrade, Label } from "@/lib/evals/grade";
import { loadEnv } from "./env";

loadEnv();

const { ExtractedOpportunity } = await import("@/lib/db/types");
const { createLlmClient, extractStructured } = await import("@/lib/llm");
const { FixtureScraper } = await import("@/lib/scrape/fixture-provider");
const { gradeCase } = await import("@/lib/evals/grade");
// The same gates the pipeline applies, imported rather than restated: an eval
// that grades a different accept path measures a system nobody is running.
const { MIN_CONFIDENCE, MIN_PAGE_CHARS } = await import("@/lib/pipeline/thresholds");

/**
 * Measures an extractor against hand-labelled fixtures, field by field.
 *
 * The point is to make "the model is better than the regexes" a number rather
 * than an assertion. Run it once with LLM_PROVIDER=mock for the baseline and
 * again with a real key; the two reports are directly comparable because the
 * input pages and the grader are identical.
 *
 *   npm run eval               # whichever provider the env selects
 *   npm run eval:baseline      # forces the rule-based extractor
 */


type CaseResult = {
  fixture: string;
  outcome: "graded" | "correctly-rejected" | "missed" | "hallucinated" | "error";
  confidence: number | null;
  grades: FieldGrade[];
  detail?: string;
};

const labelsFile = JSON.parse(await readFile("evals/labels.json", "utf8")) as { cases: Label[] };
const scraper = new FixtureScraper();
const llm = createLlmClient();

console.log(`\nEvaluating ${llm.name}:${llm.model} over ${labelsFile.cases.length} labelled pages\n`);

const results: CaseResult[] = [];

for (const label of labelsFile.cases) {
  const url = `fixture://${label.fixture}`;
  try {
    const page = await scraper.fetchPage(url, label.fixture.split("__")[0] ?? "unknown");

    if (page.text.length < MIN_PAGE_CHARS) {
      results.push({
        fixture: label.fixture,
        outcome: label.should_extract ? "missed" : "correctly-rejected",
        confidence: null,
        grades: [],
        detail: `page text ${page.text.length} chars, below ${MIN_PAGE_CHARS}`,
      });
      continue;
    }

    const res = await extractStructured(llm, ExtractedOpportunity, page);

    if (!res.ok) {
      results.push({
        fixture: label.fixture,
        // Failing to produce valid output on a page that is not an opportunity
        // is the right answer, not a failure.
        outcome: label.should_extract ? "missed" : "correctly-rejected",
        confidence: null,
        grades: [],
        detail: res.error.split("\n")[0],
      });
      continue;
    }

    const accepted = res.data.confidence >= MIN_CONFIDENCE;

    if (!label.should_extract) {
      results.push({
        fixture: label.fixture,
        outcome: accepted ? "hallucinated" : "correctly-rejected",
        confidence: res.data.confidence,
        grades: [],
        detail: accepted ? `claimed ${res.data.title.slice(0, 60)}` : undefined,
      });
      continue;
    }

    if (!accepted) {
      results.push({
        fixture: label.fixture,
        outcome: "missed",
        confidence: res.data.confidence,
        grades: [],
        detail: `confidence ${res.data.confidence} below ${MIN_CONFIDENCE}`,
      });
      continue;
    }

    results.push({
      fixture: label.fixture,
      outcome: "graded",
      confidence: res.data.confidence,
      grades: gradeCase(label, res.data),
    });
  } catch (err) {
    results.push({
      fixture: label.fixture,
      outcome: "error",
      confidence: null,
      grades: [],
      detail: String(err).slice(0, 160),
    });
  }
}

// ── Per-field aggregate ───────────────────────────────────────────────────────
const byField = new Map<string, number[]>();
for (const r of results) {
  for (const g of r.grades) {
    byField.set(g.field, [...(byField.get(g.field) ?? []), g.score]);
  }
}

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
const bar = (n: number) => "█".repeat(Math.round(n * 20)).padEnd(20, "·");

console.log("  field         score");
console.log("  ─────────────────────────────────────────────");
const fieldScores: Record<string, number> = {};
for (const [field, scores] of [...byField].sort()) {
  fieldScores[field] = mean(scores);
  console.log(`  ${field.padEnd(13)} ${bar(mean(scores))} ${pct(mean(scores)).padStart(4)}`);
}

const graded = results.filter((r) => r.outcome === "graded");
const overall = mean(graded.flatMap((r) => r.grades.map((g) => g.score)));
console.log("  ─────────────────────────────────────────────");
console.log(`  ${"overall".padEnd(13)} ${bar(overall)} ${pct(overall).padStart(4)}\n`);

// ── Page-level outcomes ───────────────────────────────────────────────────────
const counts = results.reduce<Record<string, number>>((acc, r) => {
  acc[r.outcome] = (acc[r.outcome] ?? 0) + 1;
  return acc;
}, {});
console.log(
  `  pages: ${counts["graded"] ?? 0} graded · ${counts["correctly-rejected"] ?? 0} correctly rejected · ` +
    `${counts["missed"] ?? 0} missed · ${counts["hallucinated"] ?? 0} hallucinated · ${counts["error"] ?? 0} error\n`,
);

// ── Every field the extractor got wrong, so failures are actionable ───────────
const misses = graded.flatMap((r) => r.grades.filter((g) => g.score < 1).map((g) => ({ r, g })));
if (misses.length > 0) {
  console.log("  misses");
  console.log("  ─────────────────────────────────────────────");
  for (const { r, g } of misses) {
    console.log(`  ${r.fixture}  ${g.field} ${pct(g.score)}`);
    console.log(`      want: ${g.expected}`);
    console.log(`      got:  ${g.got}`);
  }
  console.log("");
}
for (const r of results.filter((x) => x.outcome === "missed" || x.outcome === "hallucinated" || x.outcome === "error")) {
  console.log(`  ! ${r.fixture}: ${r.outcome}${r.detail ? ` — ${r.detail}` : ""}`);
}

// ── Report on disk, so two providers can be diffed ────────────────────────────
await mkdir("evals/reports", { recursive: true });
const reportPath = `evals/reports/${llm.name}.json`;
await writeFile(
  reportPath,
  JSON.stringify(
    { provider: llm.name, model: llm.model, run_at: new Date().toISOString(), overall, fieldScores, counts, results },
    null,
    2,
  ),
  "utf8",
);
console.log(`\n  report written to ${reportPath}\n`);

const minArg = process.argv.find((a) => a.startsWith("--min="))?.split("=")[1];
if (minArg && overall < Number(minArg)) {
  console.error(`  overall ${pct(overall)} is below the required ${pct(Number(minArg))}`);
  process.exit(1);
}
// Opt-in: the checked-in baseline is *expected* to hallucinate on an index
// page — that failure is the finding, not a broken build. Gate a real model on
// it with `npm run eval -- --strict`.
if (process.argv.includes("--strict") && (counts["hallucinated"] ?? 0) > 0) {
  console.error("  a non-opportunity page was extracted with high confidence");
  process.exit(1);
}
