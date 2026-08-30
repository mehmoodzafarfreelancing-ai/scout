import { readFile } from "node:fs/promises";
import path from "node:path";
import { normaliseCondition } from "./gaps";
import type { Source, SourceDocument } from "./sources";

/**
 * Replays captured API responses instead of calling the live registries.
 *
 * The documents in `fixtures/records.json` are real responses from
 * ClinicalTrials.gov and Europe PMC, saved by `npm run capture`. They are not
 * invented, which matters: the offline demo and the eval both run against
 * records with the messiness that real registry data has, including the ones
 * that never say who was enrolled.
 */

type Captured = SourceDocument & { source: string; condition: string };

export async function fixtureSources(): Promise<Source[]> {
  const file = path.join(process.cwd(), "fixtures", "records.json");
  let records: Captured[] = [];

  try {
    records = JSON.parse(await readFile(file, "utf8")) as Captured[];
  } catch {
    console.warn(`[fixtures] no capture at ${file}. Run \`npm run capture\` with network access.`);
  }

  const bySource = new Map<string, Captured[]>();
  for (const r of records) bySource.set(r.source, [...(bySource.get(r.source) ?? []), r]);

  return [...bySource.entries()].map(([id, rows]) => ({
    id,
    label: `${id} (captured)`,
    kind: "api" as const,
    async collect({ query, limit }) {
      const wanted = normaliseCondition(query);
      return rows
        .filter((r) => normaliseCondition(r.condition) === wanted)
        .slice(0, limit)
        .map(({ source: _source, condition: _condition, ...doc }) => doc);
    },
  }));
}
