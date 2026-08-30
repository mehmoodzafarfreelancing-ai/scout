import { mkdir, readFile, writeFile } from "node:fs/promises";
// Type-only imports are erased, so they are safe above loadEnv().
import type { FieldGrade, Label } from "@/lib/evals/grade";
import { loadEnv } from "./env";

loadEnv();

const { ExtractedStudy } = await import("@/lib/db/types");
const { createLlmClient, extractStructured } = await import("@/lib/llm");
const { gradeCase, confusionOf } = await import("@/lib/evals/grade");
// The same gates the pipeline applies, imported rather than restated: an eval
// that grades a different accept path measures a system nobody is running.
const { MIN_CONFIDENCE, MIN_RECORD_CHARS } = await import("@/lib/pipeline/thresholds");

/**
 * Measures an extractor against hand-labelled records, field by field.
 *
 * The point is to make "the model is better than the rules" a number rather
 * than an assertion. Run once with LLM_PROVIDER=mock for the baseline and again
 * with a real key; the two reports are directly comparable because the input
 * records and the grader are identical.
 *
 *   npm run eval               whichever provider the env selects
 *   npm run eval:baseline      forces the rule-based extractor
 */

type Captured = { source: string; condition: string; ref: string; url: string; title: string; text: string };

type CaseResult = {
  ref: string;
  source: string;
  outcome: "graded" | "missed" | "error";
  confidence: number | null;
  grades: FieldGrade[];
  detail?: string;
};

const [labelsFile, records] = await Promise.all([
  readFile("evals/labels.json", "utf8").then((t) => JSON.parse(t) as { cases: Label[] }),
  readFile("fixtures/records.json", "utf8").then((t) => JSON.parse(t) as Captured[]),
]);

const llm = createLlmClient();
console.log(`\nEvaluating ${llm.name}:${llm.model} over ${labelsFile.cases.length} labelled records\n`);

const results: CaseResult[] = [];

for (const label of labelsFile.cases) {
  const record = records.find((r) => r.ref === label.ref && r.source === label.source);

  if (!record) {
    results.push({
      ref: label.ref,
      source: label.source,
      outcome: "error",
      confidence: null,
      grades: [],
      detail: "not in fixtures/records.json — re-run `npm run capture`",
    });
    continue;
  }

  try {
    if (record.text.length < MIN_RECORD_CHARS) {
      results.push({
        ref: label.ref,
        source: label.source,
        outcome: "missed",
        confidence: null,
        grades: [],
        detail: `record ${record.text.length} chars, below ${MIN_RECORD_CHARS}`,
      });
      continue;
    }

    const res = await extractStructured(llm, ExtractedStudy, {
      title: record.title,
      text: record.text,
      url: record.url,
    });

    if (!res.ok) {
      results.push({
        ref: label.ref,
        source: label.source,
        outcome: "missed",
        confidence: null,
        grades: [],
        detail: res.error.split("\n")[0],
      });
      continue;
    }

    if (res.data.confidence < MIN_CONFIDENCE) {
      results.push({
        ref: label.ref,
        source: label.source,
        outcome: "missed",
        confidence: res.data.confidence,
        grades: [],
        detail: `confidence ${res.data.confidence} below ${MIN_CONFIDENCE}`,
      });
      continue;
    }

    results.push({
      ref: label.ref,
      source: label.source,
      outcome: "graded",
      confidence: res.data.confidence,
      grades: gradeCase(label, res.data),
    });
  } catch (err) {
    results.push({
      ref: label.ref,
      source: label.source,
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
  for (const g of r.grades) byField.set(g.field, [...(byField.get(g.field) ?? []), g.score]);
}

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
const bar = (n: number) => "█".repeat(Math.round(n * 20)).padEnd(20, "·");

console.log("  field           score");
console.log("  ───────────────────────────────────────────────");
const fieldScores: Record<string, number> = {};
for (const [f, scores] of [...byField].sort()) {
  fieldScores[f] = mean(scores);
  const flag = f === "representation" ? "  <- the field the analysis rests on" : "";
  console.log(`  ${f.padEnd(15)} ${bar(mean(scores))} ${pct(mean(scores)).padStart(4)}${flag}`);
}

const graded = results.filter((r) => r.outcome === "graded");
const overall = mean(graded.flatMap((r) => r.grades.map((g) => g.score)));
console.log("  ───────────────────────────────────────────────");
console.log(`  ${"overall".padEnd(15)} ${bar(overall)} ${pct(overall).padStart(4)}\n`);

// ── Per-source, because the two behave very differently ──────────────────────
for (const source of [...new Set(results.map((r) => r.source))].sort()) {
  const rows = graded.filter((r) => r.source === source);
  if (rows.length === 0) continue;
  const s = mean(rows.flatMap((r) => r.grades.map((g) => g.score)));
  const rep = mean(
    rows.flatMap((r) => r.grades.filter((g) => g.field === "representation").map((g) => g.score)),
  );
  console.log(`  ${source.padEnd(15)} overall ${pct(s).padStart(4)} · representation ${pct(rep).padStart(4)}`);
}

// ── Representation confusions, counted by direction ──────────────────────────
const confusions = new Map<string, number>();
for (const r of graded) {
  for (const g of r.grades.filter((x) => x.field === "representation")) {
    const c = confusionOf(g.expected, g.got);
    if (c) confusions.set(c, (confusions.get(c) ?? 0) + 1);
  }
}
if (confusions.size > 0) {
  console.log("\n  representation confusions");
  console.log("  ───────────────────────────────────────────────");
  for (const [c, n] of [...confusions].sort((a, b) => b[1] - a[1])) {
    // Calling a silent record a measured absence is the damaging direction: it
    // manufactures a gap that the evidence never showed.
    const severe = c.startsWith("unclear→none") ? "   <- invents a measured absence" : "";
    console.log(`  ${c.padEnd(20)} ${n}${severe}`);
  }
}

// ── Every field the extractor got wrong ──────────────────────────────────────
const misses = graded.flatMap((r) => r.grades.filter((g) => g.score < 1).map((g) => ({ r, g })));
if (misses.length > 0) {
  console.log("\n  misses");
  console.log("  ───────────────────────────────────────────────");
  for (const { r, g } of misses) {
    console.log(`  ${r.source}/${r.ref}  ${g.field} ${pct(g.score)}`);
    console.log(`      want: ${g.expected}`);
    console.log(`      got:  ${g.got}`);
  }
}

for (const r of results.filter((x) => x.outcome !== "graded")) {
  console.log(`  ! ${r.source}/${r.ref}: ${r.outcome}${r.detail ? ` — ${r.detail}` : ""}`);
}

await mkdir("evals/reports", { recursive: true });
const reportPath = `evals/reports/${llm.name}.json`;
await writeFile(
  reportPath,
  JSON.stringify(
    {
      provider: llm.name,
      model: llm.model,
      run_at: new Date().toISOString(),
      overall,
      fieldScores,
      confusions: Object.fromEntries(confusions),
      results,
    },
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
