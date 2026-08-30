/**
 * Dependency-free HTML -> text normaliser.
 *
 * Deliberately not cheerio/jsdom: this runs on every page of every crawl and
 * in a GitHub Actions job, so a 40-line regex pass that never allocates a DOM
 * is the right trade. Extraction quality comes from the LLM, not from the
 * parser — the parser only has to remove noise and preserve reading order.
 */

// <head> goes too: its <title> is read separately by extractTitle, and leaving
// it in duplicates the page title at the top of every extracted summary.
const STRIP_BLOCKS =
  /<(head|script|style|noscript|svg|template|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi;
const BLOCK_TAGS = /<\/?(p|div|section|article|header|footer|li|tr|h[1-6]|br|hr|table)\b[^>]*>/gi;
const ANY_TAG = /<[^>]+>/g;

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
  "&#39;": "'", "&apos;": "'", "&mdash;": "—", "&ndash;": "–", "&hellip;": "…",
};

export function decodeEntities(input: string): string {
  return input
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m)
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

export function extractTitle(html: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  const raw = (h1 ?? title ?? "").replace(ANY_TAG, " ");
  return decodeEntities(raw).replace(/\s+/g, " ").trim().slice(0, 300);
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(STRIP_BLOCKS, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(BLOCK_TAGS, "\n")
      .replace(ANY_TAG, " "),
  )
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    // An open+close tag pair emits two newlines; one break per block is enough,
    // and every extra newline is a token we pay for on real pages.
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Absolute, de-duplicated, same-origin-or-allowed links found in `html`. */
export function extractLinks(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
    const href = m[1];
    if (!href || href.startsWith("mailto:") || href.startsWith("javascript:")) continue;
    try {
      const abs = new URL(href, base);
      abs.hash = "";
      if (abs.protocol === "http:" || abs.protocol === "https:") out.add(abs.toString());
    } catch {
      // Malformed href on the page — skip rather than fail the whole crawl.
    }
  }
  return [...out];
}
