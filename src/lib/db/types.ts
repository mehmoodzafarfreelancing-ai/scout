import { z } from "zod";

/**
 * The extraction contract.
 *
 * This schema is the single source of truth in three places at once: it is
 * injected into the LLM prompt as the target shape, it validates the model's
 * response before anything touches the database, and it types the UI. If the
 * schema changes, all three move together and `tsc` finds the gaps.
 */

export const StudyType = z.enum([
  "interventional",
  "observational",
  "review",
  "case-report",
  "other",
]);
export type StudyType = z.infer<typeof StudyType>;

/**
 * How far the study's population reaches the region we care about.
 *
 * The four-way split matters. "none" and "unclear" look the same in a naive
 * count, but they are opposite findings: one is a measured absence, the other
 * is a reporting failure. A tool that collapses them tells you a gap exists
 * when the truth may be that nobody wrote down who they enrolled.
 */
export const Representation = z.enum([
  /** Explicitly not a South Asian population. */
  "none",
  /** South Asian participants included, but as part of a larger cohort. */
  "partial",
  /** The study population is primarily South Asian. */
  "primary",
  /** The source does not say. Reported separately, never counted as "none". */
  "unclear",
]);
export type Representation = z.infer<typeof Representation>;

/** What the LLM is asked to produce from one study record. */
export const ExtractedStudy = z.object({
  title: z.string().min(5).max(400),
  /** The primary health condition, normalised to a common name where possible. */
  condition: z.string().min(2).max(160),
  /** Drug, device or programme under test. Null for observational work. */
  intervention: z.string().max(200).nullable(),
  study_type: StudyType,
  /** Enrolled participants. Null when the source does not state a number. */
  sample_size: z.number().int().nonnegative().nullable(),
  /** Countries where participants were actually recruited, not author affiliations. */
  countries: z.array(z.string().min(2).max(60)).max(30),
  /** One sentence on who was studied. This is what a reviewer reads first. */
  population_note: z.string().min(10).max(500),
  representation: Representation,
  year: z.number().int().min(1900).max(2100).nullable(),
  /** The model's own confidence that it read the record correctly. */
  confidence: z.number().min(0).max(1),
});
export type ExtractedStudy = z.infer<typeof ExtractedStudy>;

/** A row as stored. Extraction output plus provenance we control, not the model. */
export const Study = ExtractedStudy.extend({
  id: z.string(),
  source: z.string(),
  source_ref: z.string(),
  source_url: z.string().refine((v) => {
    try {
      new URL(v);
      return true;
    } catch {
      return false;
    }
  }, "must be a parsable URL"),
  /** SHA-256 of the normalised record text; lets us skip unchanged records. */
  content_hash: z.string(),
  /** True when the scraper was used to pull full text the abstract lacked. */
  enriched: z.boolean(),
  first_seen_at: z.string(),
  last_seen_at: z.string(),
  extracted_by: z.string(),
});
export type Study = z.infer<typeof Study>;

/**
 * A condition, with how much of its evidence base reaches our region.
 *
 * Derived from studies rather than stored by the extractor, so it is always
 * consistent with the rows it summarises.
 */
export const Gap = z.object({
  condition: z.string(),
  total_studies: z.number().int(),
  // Named *_count to match the SQL columns exactly. "primary" is close enough
  // to reserved in Postgres to be worth stepping around, and having the two
  // namings differ would mean a mapping layer that can drift.
  primary_count: z.number().int(),
  partial_count: z.number().int(),
  none_count: z.number().int(),
  unclear_count: z.number().int(),
  /** Participants across studies that reached the region at all. */
  represented_participants: z.number().int(),
  total_participants: z.number().int(),
  /** 0 to 1. Higher means more evidence with less of it reaching the region. */
  gap_score: z.number().min(0).max(1),
  computed_at: z.string(),
});
export type Gap = z.infer<typeof Gap>;

/** One pipeline execution. Surfaced in the dashboard as an audit trail. */
export const IngestRun = z.object({
  id: z.string(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  trigger: z.enum(["manual", "cron", "webhook"]),
  scrape_provider: z.string(),
  llm_provider: z.string(),
  records_seen: z.number(),
  records_skipped: z.number(),
  enriched: z.number(),
  extracted: z.number(),
  rejected: z.number(),
  /** What this run actually spent. Null when the provider reports no usage. */
  llm_calls: z.number(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  errors: z.array(z.string()),
});
export type IngestRun = z.infer<typeof IngestRun>;
