/**
 * Source registry.
 *
 * A source is a seed listing plus the rules for deciding which links off it are
 * real opportunity pages. Keeping that judgement here — rather than in the
 * scraper or the prompt — means adding a funder is a data change, not a code
 * change, and means we never spend an LLM call on a page we could have
 * rejected with a URL pattern.
 */

export type Source = {
  id: string;
  label: string;
  seed: string;
  /** A candidate link must match one of these to be fetched. */
  include: RegExp[];
  exclude?: RegExp[];
  /** Cap per run so one huge funder can't monopolise a free-tier budget. */
  maxPages: number;
  /** Optional Exa query used to find pages the seed listing doesn't link. */
  discoveryQuery?: string;
};

export const SOURCES: Source[] = [
  {
    id: "nsf",
    label: "US National Science Foundation",
    seed: "https://www.nsf.gov/funding/opportunities",
    include: [/nsf\.gov\/funding\/opp/i, /nsf\.gov\/pubs\//i],
    exclude: [/\.pdf$/i, /\/archive\//i],
    maxPages: 12,
    discoveryQuery: "NSF research funding opportunity call for proposals deadline 2026",
  },
  {
    id: "ukri",
    label: "UK Research and Innovation",
    seed: "https://www.ukri.org/opportunity/",
    include: [/ukri\.org\/opportunity\/[a-z0-9-]+/i],
    exclude: [/\/page\/\d+/i, /\?/],
    maxPages: 12,
    discoveryQuery: "UKRI funding opportunity apply deadline research grant",
  },
  {
    id: "wellcome",
    label: "Wellcome Trust",
    seed: "https://wellcome.org/research-funding/schemes",
    include: [/wellcome\.org\/(research-funding|grant-funding)\//i],
    exclude: [/\.pdf$/i],
    maxPages: 10,
    discoveryQuery: "Wellcome Trust grant scheme eligibility award deadline",
  },
];

export function sourceById(id: string): Source | undefined {
  return SOURCES.find((s) => s.id === id);
}

/** Filter discovered links down to plausible detail pages for this source. */
export function selectCandidates(source: Source, links: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const link of links) {
    const url = link.split("#")[0]!;
    if (seen.has(url)) continue;
    if (!source.include.some((re) => re.test(url))) continue;
    if (source.exclude?.some((re) => re.test(url))) continue;
    if (url.replace(/\/$/, "") === source.seed.replace(/\/$/, "")) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= source.maxPages) break;
  }
  return out;
}
