import { z } from "zod";

/**
 * The extraction contract.
 *
 * This schema is the single source of truth in three places at once: it is
 * injected into the LLM prompt as the target shape, it validates the model's
 * response before anything touches the database, and it types the UI. If the
 * schema changes, all three move together and `tsc` finds the gaps.
 */

export const OpportunityStatus = z.enum(["open", "closed", "rolling", "unknown"]);
export type OpportunityStatus = z.infer<typeof OpportunityStatus>;

/** Money as reported by the funder. Ranges are common; single values are not. */
export const AwardAmount = z.object({
  min: z.number().nonnegative().nullable(),
  max: z.number().nonnegative().nullable(),
  currency: z.string().length(3).default("USD"),
});
export type AwardAmount = z.infer<typeof AwardAmount>;

/** What the LLM is asked to produce from one page of scraped text. */
export const ExtractedOpportunity = z.object({
  title: z.string().min(3).max(300),
  funder: z.string().min(2).max(200),
  programme: z.string().max(200).nullable(),
  summary: z.string().min(20).max(1200),
  disciplines: z.array(z.string().min(2).max(60)).max(12),
  eligibility: z.string().max(1000).nullable(),
  award: AwardAmount.nullable(),
  /** ISO-8601 date (YYYY-MM-DD). Null when the call is rolling or undated. */
  deadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
    .nullable(),
  status: OpportunityStatus,
  /** Model's own confidence that this page really is a funding call. */
  confidence: z.number().min(0).max(1),
});
export type ExtractedOpportunity = z.infer<typeof ExtractedOpportunity>;

/** A row as stored. Extraction output plus provenance we control, not the model. */
export const Opportunity = ExtractedOpportunity.extend({
  id: z.string(),
  source: z.string(),
  // Not z.url(): the fixture scraper addresses pages as fixture://<name>, and
  // the store must round-trip those for offline runs and CI.
  source_url: z.string().refine((v) => {
    try {
      new URL(v);
      return true;
    } catch {
      return false;
    }
  }, "must be a parsable URL"),
  /** SHA-256 of the normalised page text; lets us skip unchanged pages. */
  content_hash: z.string(),
  first_seen_at: z.string(),
  last_seen_at: z.string(),
  extracted_by: z.string(),
});
export type Opportunity = z.infer<typeof Opportunity>;

/** The profile an opportunity is scored against. */
export const Profile = z.object({
  id: z.string(),
  name: z.string(),
  disciplines: z.array(z.string()),
  keywords: z.array(z.string()),
  career_stage: z.enum(["student", "postdoc", "early-career", "established"]),
  country: z.string(),
  min_award: z.number().nonnegative().nullable(),
});
export type Profile = z.infer<typeof Profile>;

export const Match = z.object({
  opportunity_id: z.string(),
  profile_id: z.string(),
  score: z.number().min(0).max(1),
  reasons: z.array(z.string()),
  scored_at: z.string(),
});
export type Match = z.infer<typeof Match>;

/** One pipeline execution. Surfaced in the dashboard as an audit trail. */
export const IngestRun = z.object({
  id: z.string(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  trigger: z.enum(["manual", "cron", "webhook"]),
  scrape_provider: z.string(),
  llm_provider: z.string(),
  pages_fetched: z.number(),
  pages_skipped: z.number(),
  extracted: z.number(),
  rejected: z.number(),
  errors: z.array(z.string()),
});
export type IngestRun = z.infer<typeof IngestRun>;
