import { mkdir, writeFile } from "node:fs/promises";
import { loadEnv } from "./env";

loadEnv();

const { SOURCES, SOUTH_ASIA, TRACKED_CONDITIONS } = await import("@/lib/pipeline/sources");

/**
 * Saves real API responses to `fixtures/records.json`.
 *
 * The offline demo and the eval both run against these. Capturing real records
 * rather than writing plausible ones matters more here than it looks: registry
 * data is messy in specific ways that invented data never is. Trials that never
 * say where they recruited, abstracts that name a country only in an author's
 * address, enrollment counts that are absent. Those are exactly the cases the
 * extractor has to get right, and you cannot imagine them accurately.
 *
 *   npm run capture                      every source, every tracked condition
 *   npm run capture -- --limit=4         fewer records per condition
 */

const flag = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const limit = Number(flag("limit") ?? 5);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Captured = {
  source: string;
  condition: string;
  ref: string;
  url: string;
  title: string;
  text: string;
  enrichUrl?: string;
};

const captured: Captured[] = [];
const seen = new Set<string>();

for (const source of SOURCES) {
  for (const condition of TRACKED_CONDITIONS) {
    // Same two passes the pipeline runs, so the fixtures are a faithful
    // snapshot of what a live run sees rather than a tidier subset.
    let added = 0;
    for (const pass of [{}, { region: SOUTH_ASIA }]) {
      try {
        const docs = await source.collect({ query: condition, limit, ...pass });

        for (const doc of docs) {
          const key = `${source.id}:${doc.ref}`;
          // The same trial legitimately answers several queries. Keep the
          // first, or the fixture set double-counts in every gap.
          if (seen.has(key)) continue;
          seen.add(key);
          captured.push({ source: source.id, condition, ...doc });
          added++;
        }
      } catch (err) {
        console.warn(`  ${source.id} / ${condition}: ${String(err).slice(0, 120)}`);
      }

      // These APIs are free and public. Pausing between calls is the rent.
      await sleep(1200);
    }

    console.log(`  ${source.id.padEnd(16)} ${condition.padEnd(24)} ${added} new record(s)`);
  }
}

await mkdir("fixtures", { recursive: true });
await writeFile("fixtures/records.json", `${JSON.stringify(captured, null, 2)}\n`, "utf8");

const bySource = captured.reduce<Record<string, number>>((acc, r) => {
  acc[r.source] = (acc[r.source] ?? 0) + 1;
  return acc;
}, {});

const thin = captured.filter((r) => r.text.length < 400).length;
const noCountry = captured.filter((r) => /Recruitment countries: not stated/.test(r.text)).length;

console.log(
  [
    "",
    `  captured        ${captured.length} records`,
    `  by source       ${JSON.stringify(bySource)}`,
    `  thin (<400ch)   ${thin}`,
    `  no country      ${noCountry}   <- the records the extractor has to call "unclear"`,
    `  written to      fixtures/records.json`,
    "",
  ].join("\n"),
);
