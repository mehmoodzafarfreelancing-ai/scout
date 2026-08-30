import { config } from "@/lib/config";
import { getWriteRepo } from "@/lib/db";
import { ExtractedOpportunity, type IngestRun, type Opportunity } from "@/lib/db/types";
import { createLlmClient, extractStructured } from "@/lib/llm";
import { createScraper, exaSearch, type Scraper } from "@/lib/scrape";
import { contentHash, opportunityId, runId } from "./ids";
import { scoreAll } from "./match";
import { SOURCES, selectCandidates, sourceById, type Source } from "./sources";

export type RunOptions = {
  trigger: IngestRun["trigger"];
  /** Restrict to specific source ids. Empty = all registered sources. */
  sources?: string[];
  /** Extract even when the page content hash is unchanged. */
  force?: boolean;
  /** Hard ceiling on LLM calls for this run. Protects the free tier. */
  budget?: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pages below this are almost certainly index/news pages, not real calls. */
const MIN_CONFIDENCE = 0.4;
/** Below this a page has no extractable content; don't spend a call on it. */
const MIN_PAGE_CHARS = 400;

export async function runIngest(opts: RunOptions): Promise<IngestRun> {
  const repo = await getWriteRepo();
  const scraper = await createScraper();
  const llm = createLlmClient();

  const run: IngestRun = {
    id: runId(),
    started_at: new Date().toISOString(),
    finished_at: null,
    trigger: opts.trigger,
    scrape_provider: scraper.name,
    llm_provider: `${llm.name}:${llm.model}`,
    pages_fetched: 0,
    pages_skipped: 0,
    extracted: 0,
    rejected: 0,
    errors: [],
  };
  await repo.startRun(run);

  const targets = opts.sources?.length
    ? opts.sources.map(sourceById).filter((s): s is Source => Boolean(s))
    : SOURCES;

  let budget = opts.budget ?? 60;
  const known = await repo.knownHashes();
  const harvested: Opportunity[] = [];

  try {
    for (const source of targets) {
      const candidates = await discoverFor(scraper, source, run);
      console.log(`[ingest] ${source.id}: ${candidates.length} candidate page(s)`);

      for (const url of candidates) {
        if (budget <= 0) {
          run.errors.push(`budget exhausted before finishing ${source.id}`);
          break;
        }

        try {
          const page = await scraper.fetchPage(url, source.id);
          run.pages_fetched++;
          await sleep(config.scrape.delayMs);

          if (page.text.length < MIN_PAGE_CHARS) {
            run.pages_skipped++;
            continue;
          }

          const id = opportunityId(source.id, url);
          const hash = contentHash(page.text);

          // The single biggest cost saving in the pipeline: unchanged pages
          // never reach the model.
          if (!opts.force && known.get(id) === hash) {
            run.pages_skipped++;
            continue;
          }

          budget--;
          const result = await extractStructured(llm, ExtractedOpportunity, page);

          if (!result.ok) {
            run.rejected++;
            run.errors.push(`${url}: ${result.error.split("\n")[0]}`);
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
            source_url: url,
            content_hash: hash,
            first_seen_at: now,
            last_seen_at: now,
            extracted_by: `${result.meta.provider}:${result.meta.model}`,
          });
          run.extracted++;
        } catch (err) {
          run.rejected++;
          run.errors.push(`${url}: ${String(err).slice(0, 200)}`);
        }
      }
    }

    if (harvested.length > 0) {
      const { inserted, updated } = await repo.upsertOpportunities(harvested);
      console.log(`[ingest] stored ${inserted} new, ${updated} updated`);
      await rescore(repo);
    }
  } finally {
    await scraper.dispose?.();
    run.finished_at = new Date().toISOString();
    // Unbounded error arrays would eventually break the Postgres row limit.
    run.errors = run.errors.slice(0, 50);
    await repo.finishRun(run);
  }

  return run;
}

async function discoverFor(scraper: Scraper, source: Source, run: IngestRun): Promise<string[]> {
  const found = new Set<string>();

  try {
    const links = await scraper.discover(source.seed, source.id);
    // Fixture URLs are already source-scoped by filename, so the live-site URL
    // patterns would reject every one of them.
    const candidates =
      scraper.name === "fixture" ? links.slice(0, source.maxPages) : selectCandidates(source, links);
    for (const url of candidates) found.add(url);
  } catch (err) {
    run.errors.push(`discover ${source.id}: ${String(err).slice(0, 200)}`);
  }

  // Exa fills gaps the seed listing doesn't link. Best-effort, never fatal.
  if (source.discoveryQuery && found.size < source.maxPages) {
    const hits = await exaSearch(source.discoveryQuery, source.maxPages).catch(() => []);
    for (const url of selectCandidates(source, hits.map((h) => h.url))) {
      if (found.size >= source.maxPages) break;
      found.add(url);
    }
  }

  return [...found].slice(0, source.maxPages);
}

/** Re-score every profile against the full corpus after new rows land. */
async function rescore(repo: Awaited<ReturnType<typeof getWriteRepo>>): Promise<void> {
  const [profiles, opportunities] = await Promise.all([
    repo.listProfiles(),
    repo.listOpportunities({ limit: 1000 }),
  ]);
  for (const profile of profiles) {
    await repo.saveMatches(scoreAll(opportunities, profile));
  }
}
