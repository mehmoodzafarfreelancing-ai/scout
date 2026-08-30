import { loadEnv } from "./env";
loadEnv();

// Imported after loadEnv() so config.ts reads a populated process.env.
const { runIngest } = await import("@/lib/pipeline/run");
const { activeStack } = await import("@/lib/config");

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=");
}

const list = (name: string) =>
  flag(name)?.split(",").map((s) => s.trim()).filter(Boolean);

const sources = list("sources");
const conditions = list("conditions");
const budget = flag("budget") ? Number(flag("budget")) : undefined;
const perCondition = flag("per") ? Number(flag("per")) : undefined;
const force = process.argv.includes("--force");

console.log("[ingest] stack:", activeStack());

const run = await runIngest({ trigger: "manual", sources, conditions, budget, perCondition, force });

const ms = Date.parse(run.finished_at ?? run.started_at) - Date.parse(run.started_at);
console.log(
  [
    "",
    `  run        ${run.id}`,
    `  duration   ${(ms / 1000).toFixed(1)}s`,
    `  scraper    ${run.scrape_provider}`,
    `  model      ${run.llm_provider}`,
    `  seen       ${run.records_seen}`,
    `  skipped    ${run.records_skipped}  (unchanged or too short)`,
    `  enriched   ${run.enriched}  (full text fetched for thin records)`,
    `  extracted  ${run.extracted}`,
    `  rejected   ${run.rejected}`,
    "",
  ].join("\n"),
);

if (run.errors.length > 0) {
  console.log(`  ${run.errors.length} error(s):`);
  for (const e of run.errors.slice(0, 10)) console.log(`   - ${e}`);
  console.log("");
}

process.exit(run.extracted === 0 && run.records_seen > 0 && run.records_skipped === 0 ? 1 : 0);
