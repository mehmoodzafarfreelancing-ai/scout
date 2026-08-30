import { config } from "@/lib/config";

/**
 * Exa neural search, used for *discovery* rather than fetching.
 *
 * Crawling a listing page only finds calls the funder chose to list today.
 * Exa finds pages that read like a funding call regardless of where they sit,
 * which is how the pipeline picks up sources nobody hard-coded. Optional: with
 * no key the pipeline falls back to the configured seed listings.
 */

export type ExaHit = { url: string; title: string; publishedDate?: string };

export async function exaSearch(query: string, limit = 10): Promise<ExaHit[]> {
  if (!config.scrape.exaKey) return [];

  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "x-api-key": config.scrape.exaKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query,
      numResults: limit,
      type: "neural",
      useAutoprompt: true,
      category: "research paper",
      startPublishedDate: new Date(Date.now() - 180 * 864e5).toISOString(),
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    // Discovery is an enhancement, never a hard dependency — degrade quietly.
    console.warn(`[exa] search failed: ${res.status} ${await res.text().catch(() => "")}`);
    return [];
  }

  const json = (await res.json()) as { results?: ExaHit[] };
  return json.results ?? [];
}
