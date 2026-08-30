import type { CompletionRequest, CompletionResult, LlmClient } from "./types";

/**
 * A deterministic, rule-based stand-in for a real model.
 *
 * Two jobs. First, it lets the whole pipeline run with zero API keys, so the
 * repo is clonable and CI is free. Second, and more usefully, it is the
 * baseline the real extractor is measured against. If a 70B model cannot beat
 * these rules on the eval set, the model is not earning its latency.
 *
 * Expect it to do well on ClinicalTrials.gov, where the fields it needs are
 * already labelled, and badly on Europe PMC, where the population exists only
 * in prose. That split is the point: pattern matching handles data someone has
 * already structured, and falls over exactly where reading starts.
 */

/**
 * Kept identical to the list in the extraction prompt.
 *
 * If these two drift, the baseline and the model are being graded against
 * different definitions of the same word, and the comparison means nothing.
 */
const SOUTH_ASIAN = [
  "pakistan",
  "india",
  "bangladesh",
  "sri lanka",
  "nepal",
  "bhutan",
  "maldives",
];

/** Cities big enough that a record naming one is naming a country. */
const SOUTH_ASIAN_CITIES = [
  "karachi",
  "lahore",
  "islamabad",
  "rawalpindi",
  "peshawar",
  "dhaka",
  "delhi",
  "mumbai",
  "chennai",
  "kolkata",
  "bengaluru",
  "bangalore",
  "hyderabad",
  "colombo",
  "kathmandu",
];

const field = (text: string, label: string): string | null => {
  const m = new RegExp(`^${label}:\\s*(.+)$`, "im").exec(text);
  const value = m?.[1]?.trim();
  return !value || /^not stated$/i.test(value) || /^not available$/i.test(value) ? null : value;
};

export function guessCountries(text: string): string[] {
  const stated = field(text, "Recruitment countries");
  if (stated) {
    return [...new Set(stated.split(";").map((c) => c.trim()).filter(Boolean))].slice(0, 30);
  }
  return [];
}

export function guessRepresentation(
  countries: string[],
  text: string,
): "none" | "partial" | "primary" | "unclear" {
  if (countries.length > 0) {
    const hits = countries.filter((c) => SOUTH_ASIAN.includes(c.toLowerCase().trim()));
    if (hits.length === 0) return "none";
    // Every listed site in the region means the study is about that population.
    // A single site among many means it is a slice of a wider cohort.
    return hits.length === countries.length ? "primary" : "partial";
  }

  // No country list. Fall back to looking for the region in the prose, which is
  // where this approach starts guessing rather than reading.
  const lower = text.toLowerCase();
  const mentioned =
    SOUTH_ASIAN.some((c) => lower.includes(c)) || SOUTH_ASIAN_CITIES.some((c) => lower.includes(c));

  // Deliberately "unclear" rather than "none". A record that did not say is not
  // a record that said no, and collapsing the two is the single worst error
  // this pipeline can make.
  return mentioned ? "partial" : "unclear";
}

export function guessStudyType(text: string): string {
  const declared = field(text, "Study type") ?? field(text, "Publication type") ?? "";
  const lower = declared.toLowerCase();

  if (/interventional/.test(lower)) return "interventional";
  if (/observational|cohort|cross-sectional|case-control/.test(lower)) return "observational";
  if (/review|meta-analysis/.test(lower)) return "review";
  if (/case report/.test(lower)) return "case-report";

  const body = text.toLowerCase();
  if (/randomi[sz]ed|placebo|double-blind/.test(body)) return "interventional";
  if (/systematic review|meta-analysis/.test(body)) return "review";
  if (/cohort|cross-sectional|observational/.test(body)) return "observational";
  return "other";
}

export function guessSampleSize(text: string): number | null {
  const enrolment = field(text, "Enrollment");
  if (enrolment) {
    const n = Number(enrolment.replace(/[^\d]/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }

  // Abstracts phrase it a dozen ways. These two carry most of them.
  const patterns = [
    /\b(?:n\s*=\s*|enrolled\s+|recruited\s+|included\s+)(\d[\d,]{1,7})\b/i,
    /\b(\d[\d,]{1,7})\s+(?:patients|participants|subjects|women|children|adults)\b/i,
  ];
  for (const re of patterns) {
    const n = Number(re.exec(text)?.[1]?.replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

export function guessYear(text: string): number | null {
  const stated = field(text, "Publication year") ?? field(text, "Start date");
  const year = Number(stated?.slice(0, 4));
  if (Number.isFinite(year) && year >= 1900 && year <= 2100) return year;
  return null;
}

export class MockLlmClient implements LlmClient {
  readonly name = "mock";
  readonly model = "rule-based-v2";

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const title = /TITLE:\s*\n(.+)/.exec(req.user)?.[1]?.trim() ?? "Untitled record";
    const body = req.user.split("CONTENT:").at(-1) ?? req.user;

    const countries = guessCountries(body);
    const representation = guessRepresentation(countries, body);

    const condition =
      field(body, "Condition\\(s\\)")?.split(";")[0]?.trim().toLowerCase() ??
      title.split(/[:,]/)[0]!.trim().toLowerCase().slice(0, 160);

    const interventions = field(body, "Interventions");
    const abstract = field(body, "Abstract") ?? "";

    const sentences = (abstract || body)
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter((s) => s.length > 40);

    const populationNote =
      countries.length > 0
        ? `Recruited in ${countries.join(", ")}.`
        : (sentences.find((s) => /patient|participant|adult|child|women|cohort|enrolled/i.test(s)) ??
          "The record does not describe the population.");

    return {
      text: JSON.stringify({
        title: title.slice(0, 400),
        condition: condition.length >= 2 ? condition : "unspecified",
        intervention: interventions && interventions !== "none" ? interventions.slice(0, 200) : null,
        study_type: guessStudyType(body),
        sample_size: guessSampleSize(body),
        countries,
        population_note: populationNote.slice(0, 500).padEnd(10, "."),
        representation,
        year: guessYear(body),
        // Honest about being a heuristic. Highest when the record handed it a
        // country list, lowest when it had to guess from prose.
        confidence: Number((countries.length > 0 ? 0.62 : 0.44).toFixed(2)),
      }),
      model: this.model,
      usage: null,
    };
  }
}
