import { config } from "@/lib/config";
import { getWriteRepo } from "@/lib/db";
import { ExtractedStudy, type IngestRun, type Study } from "@/lib/db/types";
import { createLlmClient, extractStructured } from "@/lib/llm";
import { createScraper, type Scraper } from "@/lib/scrape";
import { computeGaps } from "./gaps";
import { contentHash, runId, studyId } from "./ids";
import { fixtureSources } from "./fixture-source";
import {
  SOURCES,
  SOUTH_ASIA,
  TRACKED_CONDITIONS,
  enrich,
  sourceById,
  type Source,
  type SourceDocument,
} from "./sources";
import { MIN_CONFIDENCE, MIN_RECORD_CHARS } from "./thresholds";

export type RunOptions = {
  trigger: IngestRun["trigger"];
  /** Restrict to specific source ids. Empty means all registered sources. */
  sources?: string[];
  /** Restrict to specific conditions. Empty means all tracked conditions. */
  conditions?: string[];
  /** Extract even when the record hash is unchanged. */
  force?: boolean;
  /** Hard ceiling on LLM calls for this run. Protects the free tier. */
  budget?: number;
  /** Records to request per source, per condition. */
  perCondition?: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runIngest(opts: RunOptions): Promise<IngestRun> {
  const repo = await getWriteRepo();
  const scraper = await createScraper();
  const llm = createLlmClient();

  // With no keys the pipeline replays captured API responses, so a fresh clone
  // runs the whole thing offline. Same code path, different documents.
  const offline = config.scrape.provider === "fixture";
  const registry: Source[] = offline ? await fixtureSources() : SOURCES;

  const run: IngestRun = {
    id: runId(),
    started_at: new Date().toISOString(),
    finished_at: null,
    trigger: opts.trigger,
    scrape_provider: offline ? "fixture" : scraper.name,
    llm_provider: `${llm.name}:${llm.model}`,
    records_seen: 0,
    records_skipped: 0,
    enriched: 0,
    extracted: 0,
    rejected: 0,
    errors: [],
  };
  await repo.startRun(run);

  const sources = opts.sources?.length
    ? opts.sources.map((id) => registry.find((s) => s.id === id) ?? sourceById(id)).filter((s): s is Source => Boolean(s))
    : registry;
  const conditions = opts.conditions?.length ? opts.conditions : TRACKED_CONDITIONS;

  let budget = opts.budget ?? 60;
  const known = await repo.knownHashes();
  const harvested: Study[] = [];

  try {
    for (const source of sources) {
      for (const condition of conditions) {
        if (budget <= 0) break;

        // Two passes. The broad one shows what the literature looks like; the
        // region-targeted one finds work that would never rank highly enough to
        // appear in it. Comparing them is the whole analysis.
        const passes: { region?: string[] }[] = [{}, { region: SOUTH_ASIA }];
        const documents: SourceDocument[] = [];
        const seenRefs = new Set<string>();

        for (const pass of passes) {
          try {
            const found = await source.collect({
              query: condition,
              limit: opts.perCondition ?? 6,
              ...pass,
            });
            for (const doc of found) {
              // The same trial answers both passes. Keeping it twice would
              // double-count it in the gap arithmetic.
              if (seenRefs.has(doc.ref)) continue;
              seenRefs.add(doc.ref);
              documents.push(doc);
            }
          } catch (err) {
            run.errors.push(`${source.id}/${condition}: ${String(err).slice(0, 160)}`);
          }
          if (!offline) await sleep(config.scrape.delayMs);
        }

        console.log(`[ingest] ${source.id} · ${condition}: ${documents.length} record(s)`);

        for (const doc of documents) {
          if (budget <= 0) {
            run.errors.push(`budget exhausted during ${source.id}/${condition}`);
            break;
          }

          run.records_seen++;
          const id = studyId(source.id, doc.ref);

          try {
            let text = doc.text;

            if (text.length < MIN_RECORD_CHARS && !offline) {
              const extra = await enrich(scraper, doc);
              if (extra) {
                text = `${text}\n\nFull text:\n${extra}`;
                run.enriched++;
              }
            }

            if (text.length < MIN_RECORD_CHARS) {
              run.records_skipped++;
              continue;
            }

            const hash = contentHash(text);

            // The single biggest cost saving: unchanged records never reach the
            // model. A nightly re-run over a stable corpus spends nothing.
            if (!opts.force && known.get(id) === hash) {
              run.records_skipped++;
              continue;
            }

            budget--;
            const result = await extractStructured(llm, ExtractedStudy, {
              title: doc.title,
              text,
              url: doc.url,
            });

            if (!result.ok) {
              run.rejected++;
              run.errors.push(`${doc.ref}: ${result.error.split("\n")[0]}`);
              continue;
            }
            if (result.data.confidence < MIN_CONFIDENCE) {
              run.rejected++;
              continue;
            }

            const now = new Date().toISOString();
            harvested.push({
              ...result.data,
              id,
              source: source.id,
              source_ref: doc.ref,
              source_url: doc.url,
              content_hash: hash,
              enriched: text !== doc.text,
              first_seen_at: now,
              last_seen_at: now,
              extracted_by: `${result.meta.provider}:${result.meta.model}`,
            });
            run.extracted++;
          } catch (err) {
            run.rejected++;
            run.errors.push(`${doc.ref}: ${String(err).slice(0, 160)}`);
          }
        }
      }
    }

    if (harvested.length > 0) {
      const { inserted, updated } = await repo.upsertStudies(harvested);
      console.log(`[ingest] stored ${inserted} new, ${updated} updated`);
    }

    // Gaps are recomputed from the full corpus rather than from this run's rows,
    // so a partial run cannot leave the analysis describing only what it saw.
    const all = await repo.listStudies({ limit: 5000 });
    if (all.length > 0) await repo.saveGaps(computeGaps(all));
  } finally {
    await scraper.dispose?.();
    run.finished_at = new Date().toISOString();
    // Unbounded error arrays would eventually break the Postgres row limit.
    run.errors = run.errors.slice(0, 50);
    await repo.finishRun(run);
  }

  return run;
}

export type { Scraper };
