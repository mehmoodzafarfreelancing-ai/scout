import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { extractTitle, htmlToText } from "./html";
import { ScrapeError, type ScrapedPage, type Scraper } from "./types";

/**
 * Serves saved HTML from ./fixtures instead of hitting the network.
 *
 * This is what makes the pipeline testable: CI runs the real extraction and
 * storage code against byte-stable input, so a failing test means our logic
 * broke, not that a funder redesigned their site overnight.
 *
 * Fixture filename convention: `<source>__<slug>.html`
 */
export class FixtureScraper implements Scraper {
  readonly name = "fixture";
  private readonly dir: string;

  constructor(dir = path.join(process.cwd(), "fixtures")) {
    this.dir = dir;
  }

  private fileFor(url: string): string {
    const slug = url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    return path.join(this.dir, `${slug}.html`);
  }

  async fetchPage(url: string, source: string): Promise<ScrapedPage> {
    // Fixtures are addressed either by fixture:// name or by mirrored URL slug.
    const name = url.startsWith("fixture://") ? url.slice("fixture://".length) : null;
    const file = name ? path.join(this.dir, `${name}.html`) : this.fileFor(url);
    let html: string;
    try {
      html = await readFile(file, "utf8");
    } catch {
      throw new ScrapeError(`no fixture at ${path.basename(file)}`, url, false);
    }
    return {
      url,
      source,
      title: extractTitle(html),
      text: htmlToText(html),
      fetchedAt: new Date().toISOString(),
      provider: this.name,
    };
  }

  async discover(_listUrl: string, source: string): Promise<string[]> {
    const files = await readdir(this.dir).catch(() => [] as string[]);
    return files
      .filter((f) => f.endsWith(".html") && f.startsWith(`${source}__`))
      // Mirrors what `selectCandidates` does for live crawls: a listing page is
      // not a detail page. Live sources exclude them by URL pattern; fixtures
      // do it by name, so `-index` fixtures stay available to the eval (which
      // addresses them directly) without polluting the ingested corpus.
      .filter((f) => !/-index\.html$/.test(f))
      .map((f) => `fixture://${f.replace(/\.html$/, "")}`);
  }
}
