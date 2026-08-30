import { config } from "@/lib/config";
import { extractLinks, extractTitle, htmlToText } from "./html";
import { ScrapeError, type ScrapedPage, type Scraper } from "./types";

/**
 * Headless Chromium for sources that render their listings client-side.
 *
 * The browser is expensive to start, so one instance is shared across a whole
 * run and closed by the pipeline's `dispose()`. Playwright is imported lazily
 * so that Vercel's serverless bundle — which has no browser binary — never
 * touches it; the web app only ever uses fetch/firecrawl.
 */
export class PlaywrightScraper implements Scraper {
  readonly name = "playwright";
  private browser: import("playwright").Browser | null = null;

  private async page() {
    if (!this.browser) {
      const { chromium } = await import("playwright");
      this.browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
    }
    const ctx = await this.browser.newContext({
      userAgent: config.scrape.userAgent,
      locale: "en-GB",
      viewport: { width: 1366, height: 900 },
    });
    // Images and fonts are pure cost for a text pipeline.
    await ctx.route("**/*", (route) =>
      ["image", "font", "media"].includes(route.request().resourceType())
        ? route.abort()
        : route.continue(),
    );
    return { ctx, page: await ctx.newPage() };
  }

  private async html(url: string): Promise<string> {
    const { ctx, page } = await this.page();
    try {
      const res = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: config.scrape.timeoutMs,
      });
      if (res && !res.ok()) {
        throw new ScrapeError(`HTTP ${res.status()}`, url, res.status() >= 500);
      }
      // Listings often stream in after first paint; settle briefly, don't hang.
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
      return await page.content();
    } catch (err) {
      if (err instanceof ScrapeError) throw err;
      throw new ScrapeError(String(err), url, true);
    } finally {
      await ctx.close();
    }
  }

  async fetchPage(url: string, source: string): Promise<ScrapedPage> {
    const html = await this.html(url);
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
    return extractLinks(await this.html(listUrl), listUrl);
  }

  async dispose(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
  }
}
