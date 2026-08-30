export type ScrapedPage = {
  url: string;
  source: string;
  /** Best-effort page title, used as an extraction hint and for logging. */
  title: string;
  /** Normalised plain text. This is what the LLM sees — never raw HTML. */
  text: string;
  fetchedAt: string;
  provider: string;
};

export interface Scraper {
  readonly name: string;
  /** Fetch and normalise a single detail page. */
  fetchPage(url: string, source: string): Promise<ScrapedPage>;
  /** Find candidate detail-page URLs from a listing/index page. */
  discover(listUrl: string, source: string): Promise<string[]>;
  dispose?(): Promise<void>;
}

export class ScrapeError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ScrapeError";
  }
}
