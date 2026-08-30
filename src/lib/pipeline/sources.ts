import { htmlToText } from "@/lib/scrape/html";
import type { Scraper } from "@/lib/scrape";

/**
 * Source adapters.
 *
 * A source produces documents ready for extraction. Two of them call public
 * research APIs, which is the right way to read a registry that offers one:
 * structured, rate-limited politely, and no HTML parsing to break when the site
 * is redesigned.
 *
 * Scraping still has a job here, but a different one. Registry records are
 * often thin about *who* was enrolled, and the detail sits in the linked
 * full-text page. `needsEnrichment` marks those records, and the pipeline
 * fetches the page with Firecrawl or Playwright before extracting. Discovery by
 * API, enrichment by scraper, which is how you would actually build this.
 */

export type SourceDocument = {
  /** Stable identifier within the source, e.g. an NCT number or a PMID. */
  ref: string;
  url: string;
  title: string;
  text: string;
  /** URL to fetch for fuller population detail, when the record is thin. */
  enrichUrl?: string;
};

export type CollectContext = {
  /** Health condition to search for. */
  query: string;
  limit: number;
};

export type Source = {
  id: string;
  label: string;
  kind: "api" | "scrape";
  collect(ctx: CollectContext): Promise<SourceDocument[]>;
};

/** Records shorter than this rarely say who was enrolled. Worth enriching. */
const THIN_RECORD_CHARS = 900;

const UA = "ScoutBot/0.2 (research evidence-gap analysis; contact via repo)";

// ─── ClinicalTrials.gov ───────────────────────────────────────────────────────

type CtgStudy = {
  protocolSection?: {
    identificationModule?: { nctId?: string; briefTitle?: string; officialTitle?: string };
    descriptionModule?: { briefSummary?: string; detailedDescription?: string };
    conditionsModule?: { conditions?: string[] };
    designModule?: { studyType?: string; enrollmentInfo?: { count?: number } };
    armsInterventionsModule?: { interventions?: { name?: string; type?: string }[] };
    contactsLocationsModule?: { locations?: { country?: string; city?: string }[] };
    statusModule?: { startDateStruct?: { date?: string } };
    eligibilityModule?: { eligibilityCriteria?: string };
  };
};

export const clinicalTrials: Source = {
  id: "clinicaltrials",
  label: "ClinicalTrials.gov",
  kind: "api",

  async collect({ query, limit }): Promise<SourceDocument[]> {
    const url = new URL("https://clinicaltrials.gov/api/v2/studies");
    url.searchParams.set("query.cond", query);
    url.searchParams.set("pageSize", String(Math.min(limit, 100)));
    url.searchParams.set("format", "json");

    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": UA },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`clinicaltrials.gov ${res.status}`);

    const { studies = [] } = (await res.json()) as { studies?: CtgStudy[] };

    return studies.flatMap((s) => {
      const p = s.protocolSection;
      const nctId = p?.identificationModule?.nctId;
      if (!nctId) return [];

      // Countries come from the locations list rather than anywhere else on the
      // record. Where a trial recruited is the fact we care about, and it is
      // routinely different from where its authors work.
      const countries = [
        ...new Set((p?.contactsLocationsModule?.locations ?? []).map((l) => l.country).filter(Boolean)),
      ];

      const text = [
        `Condition(s): ${(p?.conditionsModule?.conditions ?? []).join("; ") || "not stated"}`,
        `Study type: ${p?.designModule?.studyType ?? "not stated"}`,
        `Enrollment: ${p?.designModule?.enrollmentInfo?.count ?? "not stated"}`,
        `Interventions: ${(p?.armsInterventionsModule?.interventions ?? []).map((i) => i.name).filter(Boolean).join("; ") || "none"}`,
        `Recruitment countries: ${countries.join("; ") || "not stated"}`,
        `Start date: ${p?.statusModule?.startDateStruct?.date ?? "not stated"}`,
        "",
        p?.descriptionModule?.briefSummary ?? "",
        p?.descriptionModule?.detailedDescription ?? "",
        "",
        `Eligibility: ${p?.eligibilityModule?.eligibilityCriteria ?? "not stated"}`,
      ]
        .join("\n")
        .trim();

      return [
        {
          ref: nctId,
          url: `https://clinicaltrials.gov/study/${nctId}`,
          title: p?.identificationModule?.briefTitle ?? p?.identificationModule?.officialTitle ?? nctId,
          text,
          // Registry entries with no listed countries are exactly the ones worth
          // opening the page for.
          ...(countries.length === 0 || text.length < THIN_RECORD_CHARS
            ? { enrichUrl: `https://clinicaltrials.gov/study/${nctId}` }
            : {}),
        },
      ];
    });
  },
};

// ─── Europe PMC ───────────────────────────────────────────────────────────────

type EpmcResult = {
  id?: string;
  source?: string;
  pmid?: string;
  doi?: string;
  title?: string;
  abstractText?: string;
  pubYear?: string;
  pubTypeList?: { pubType?: string[] };
  authorList?: { author?: { affiliation?: string }[] };
  fullTextUrlList?: { fullTextUrl?: { url?: string; availability?: string }[] };
};

export const europePmc: Source = {
  id: "europepmc",
  label: "Europe PMC",
  kind: "api",

  async collect({ query, limit }): Promise<SourceDocument[]> {
    const url = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
    url.searchParams.set("query", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("pageSize", String(Math.min(limit, 100)));
    url.searchParams.set("resultType", "core");

    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": UA },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`europepmc ${res.status}`);

    const json = (await res.json()) as { resultList?: { result?: EpmcResult[] } };

    return (json.resultList?.result ?? []).flatMap((r) => {
      const id = r.id;
      if (!id || !r.title) return [];

      const affiliations = [
        ...new Set((r.authorList?.author ?? []).map((a) => a.affiliation).filter(Boolean)),
      ].slice(0, 6);

      const text = [
        `Publication year: ${r.pubYear ?? "not stated"}`,
        `Publication type: ${(r.pubTypeList?.pubType ?? []).join("; ") || "not stated"}`,
        "",
        `Abstract: ${r.abstractText ?? "not available"}`,
        "",
        // Affiliations are included but flagged, because a model will otherwise
        // read "author in Karachi" as "participants in Karachi". They are a hint
        // about the population, never evidence of it.
        `Author affiliations (where the authors work, NOT necessarily where participants were recruited): ${affiliations.join(" | ") || "not stated"}`,
      ]
        .join("\n")
        .trim();

      const openAccess = (r.fullTextUrlList?.fullTextUrl ?? []).find(
        (u) => u.availability === "Open access" && u.url,
      );

      return [
        {
          ref: id,
          url: r.doi
            ? `https://doi.org/${r.doi}`
            : `https://europepmc.org/article/${r.source ?? "MED"}/${id}`,
          title: r.title.replace(/\s+/g, " ").trim(),
          text,
          ...(!r.abstractText || text.length < THIN_RECORD_CHARS
            ? openAccess?.url
              ? { enrichUrl: openAccess.url }
              : {}
            : {}),
        },
      ];
    });
  },
};

export const SOURCES: Source[] = [clinicalTrials, europePmc];

export function sourceById(id: string): Source | undefined {
  return SOURCES.find((s) => s.id === id);
}

/**
 * The conditions the pipeline tracks.
 *
 * Chosen for burden in South Asia rather than at random: these are where an
 * evidence gap has the largest clinical cost.
 */
export const TRACKED_CONDITIONS = [
  "type 2 diabetes",
  "tuberculosis",
  "hepatitis C",
  "ischemic heart disease",
  "chronic kidney disease",
  "postpartum haemorrhage",
  "childhood stunting",
  "depression",
];

/** Pull fuller population detail from a linked page, best effort. */
export async function enrich(scraper: Scraper, doc: SourceDocument): Promise<string | null> {
  if (!doc.enrichUrl) return null;
  try {
    const page = await scraper.fetchPage(doc.enrichUrl, "enrich");
    const text = page.text.includes("<") ? htmlToText(page.text) : page.text;
    return text.length > 200 ? text.slice(0, 8000) : null;
  } catch {
    // Enrichment is an improvement, never a requirement.
    return null;
  }
}
