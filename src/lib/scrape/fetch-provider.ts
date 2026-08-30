import { config } from "@/lib/config";
import { extractLinks, extractTitle, htmlToText } from "./html";
import { ScrapeError, type ScrapedPage, type Scraper } from "./types";

/** Plain HTTP + normaliser. Correct for server-rendered pages, which most
 *  government funding portals still are. Cheapest path; tried before a browser. */
export class FetchScraper implements Scraper {
  readonly name = "fetch";

  private async get(url: string): Promise<string> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), config.scrape.timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        redirect: "follow",
        headers: {
          "user-agent": config.scrape.userAgent,
          accept: "text/html,application/xhtml+xml",
          "accept-language": "en",
        },
      });
      if (!res.ok) {
        // 4xx is a bad URL; 5xx and 429 are worth another pass later.
        throw new ScrapeError(
          `HTTP ${res.status}`,
          url,
          res.status >= 500 || res.status === 429,
        );
      }
      return await res.text();
    } catch (err) {
      if (err instanceof ScrapeError) throw err;
      const aborted = err instanceof Error && err.name === "AbortError";
      throw new ScrapeError(
        aborted ? `timeout after ${config.scrape.timeoutMs}ms` : String(err),
        url,
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchPage(url: string, source: string): Promise<ScrapedPage> {
    const html = await this.get(url);
    return {
      url,
      source,
      title: extractTitle(html),
      text: htmlToText(html),
      fetchedAt: new Date().toISOString(),
      provider: this.name,
    };
  }

  async discover(listUrl: string): Promise<string[]> {
    return extractLinks(await this.get(listUrl), listUrl);
  }
}
