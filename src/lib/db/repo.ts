import type { IngestRun, Match, Opportunity, Profile } from "./types";

export type OpportunityFilter = {
  q?: string;
  source?: string;
  status?: string;
  discipline?: string;
  minConfidence?: number;
  limit?: number;
  offset?: number;
};

/**
 * Storage boundary.
 *
 * Both implementations satisfy this: Supabase in production, a JSON file
 * locally. The pipeline and every page import this type, never a client, so
 * swapping the backing store is a one-line change in the factory.
 */
export interface Repo {
  readonly name: string;

  upsertOpportunities(rows: Opportunity[]): Promise<{ inserted: number; updated: number }>;
  listOpportunities(filter?: OpportunityFilter): Promise<Opportunity[]>;
  getOpportunity(id: string): Promise<Opportunity | null>;
  /** content_hash by id, so a re-crawl can skip pages that haven't changed. */
  knownHashes(): Promise<Map<string, string>>;

  listProfiles(): Promise<Profile[]>;
  upsertProfile(profile: Profile): Promise<void>;

  saveMatches(matches: Match[]): Promise<void>;
  listMatches(profileId: string, limit?: number): Promise<Match[]>;

  startRun(run: IngestRun): Promise<void>;
  finishRun(run: IngestRun): Promise<void>;
  listRuns(limit?: number): Promise<IngestRun[]>;
}
