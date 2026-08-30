import { config, type ScrapeProvider } from "@/lib/config";
import { FetchScraper } from "./fetch-provider";
import { FirecrawlScraper } from "./firecrawl-provider";
import { FixtureScraper } from "./fixture-provider";
import { ScrapeError, type ScrapedPage, type Scraper } from "./types";

export * from "./types";

function build(kind: ScrapeProvider): Scraper {
  switch (kind) {
    case "firecrawl":
      return new FirecrawlScraper();
    case "fetch":
      return new FetchScraper();
    case "fixture":
      return new FixtureScraper();
    case "playwright":
      // Lazy: keeps the browser dependency out of the serverless bundle.
      throw new Error("use createScraper() — playwright must be loaded async");
  }
}

/**
 * A scraper that tries providers in order and degrades on failure.
 *
 * Rationale: Firecrawl has a hard free-tier credit ceiling and Playwright is
 * unavailable on Vercel. A single run should survive either dropping out
 * rather than losing the whole crawl, so failures cascade to the next provider
 * and only a total wipeout throws.
 */
class FallbackScraper implements Scraper {
  readonly name: string;
  constructor(private readonly chain: Scraper[]) {
    this.name = chain.map((s) => s.name).join(">");
  }

  private async attempt<T>(op: (s: Scraper) => Promise<T>, url: string): Promise<T> {
    let last: unknown;
    for (const scraper of this.chain) {
      try {
        return await op(scraper);
      } catch (err) {
        last = err;
        const fatal = err instanceof ScrapeError && !err.retryable;
        console.warn(`[scrape] ${scraper.name} failed on ${url}: ${String(err)}`);
        // A 404 will 404 for every provider; don't burn the rest of the chain.
        if (fatal && scraper.name !== "firecrawl") throw err;
      }
    }
    throw last instanceof Error ? last : new ScrapeError(String(last), url, false);
  }

  fetchPage(url: string, source: string): Promise<ScrapedPage> {
    return this.attempt((s) => s.fetchPage(url, source), url);
  }

  discover(listUrl: string, source: string): Promise<string[]> {
    return this.attempt((s) => s.discover(listUrl, source), listUrl);
  }

  async dispose(): Promise<void> {
    await Promise.all(this.chain.map((s) => s.dispose?.()));
  }
}

export async function createScraper(): Promise<Scraper> {
  const primary = config.scrape.provider;

  if (primary === "fixture") return new FixtureScraper();

  if (primary === "playwright") {
    const { PlaywrightScraper } = await import("./playwright-provider");
    return new FallbackScraper([new PlaywrightScraper(), new FetchScraper()]);
  }

  const chain: Scraper[] = [build(primary)];
  if (primary !== "fetch") chain.push(new FetchScraper());
  return new FallbackScraper(chain);
}
