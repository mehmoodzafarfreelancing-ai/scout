import { config } from "@/lib/config";
import { ScrapeError, type ScrapedPage, type Scraper } from "./types";

/**
 * Firecrawl v1. Called over plain HTTP rather than via the SDK so the free-tier
 * credit spend is visible at the call site and the failure modes are ours to
 * handle. Firecrawl renders JS and returns markdown, which is a better LLM
 * input than our regex normaliser — so it is preferred when a key exists.
 */
export class FirecrawlScraper implements Scraper {
  readonly name = "firecrawl";

  private async call<T>(endpoint: string, body: unknown, url: string): Promise<T> {
    const res = await fetch(`https://api.firecrawl.dev/v1/${endpoint}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.scrape.firecrawlKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.scrape.timeoutMs * 2),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // 402 = out of credits. Not retryable, and the caller should fall back.
      throw new ScrapeError(
        `firecrawl ${res.status}: ${detail.slice(0, 200)}`,
        url,
        res.status >= 500 || res.status === 429,
      );
    }
    return (await res.json()) as T;
  }

  async fetchPage(url: string, source: string): Promise<ScrapedPage> {
    type Res = { data?: { markdown?: string; metadata?: { title?: string } } };
    const json = await this.call<Res>(
      "scrape",
      { url, formats: ["markdown"], onlyMainContent: true },
      url,
    );
    const text = json.data?.markdown?.trim();
    if (!text) throw new ScrapeError("firecrawl returned no content", url, true);
    return {
      url,
      source,
      title: json.data?.metadata?.title?.slice(0, 300) ?? url,
      text,
      fetchedAt: new Date().toISOString(),
      provider: this.name,
    };
  }

  async discover(listUrl: string): Promise<string[]> {
    type Res = { links?: string[]; data?: { links?: string[] } };
    const json = await this.call<Res>("map", { url: listUrl, limit: 200 }, listUrl);
    return json.links ?? json.data?.links ?? [];
  }
}
