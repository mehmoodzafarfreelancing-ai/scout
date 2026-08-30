import type { Gap, IngestRun, Study } from "./types";

export type StudyFilter = {
  q?: string;
  source?: string;
  condition?: string;
  representation?: string;
  studyType?: string;
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

  upsertStudies(rows: Study[]): Promise<{ inserted: number; updated: number }>;
  listStudies(filter?: StudyFilter): Promise<Study[]>;
  getStudy(id: string): Promise<Study | null>;
  /** content_hash by id, so a re-crawl can skip records that haven't changed. */
  knownHashes(): Promise<Map<string, string>>;

  saveGaps(gaps: Gap[]): Promise<void>;
  listGaps(limit?: number): Promise<Gap[]>;

  startRun(run: IngestRun): Promise<void>;
  finishRun(run: IngestRun): Promise<void>;
  listRuns(limit?: number): Promise<IngestRun[]>;
}
