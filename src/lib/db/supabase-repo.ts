import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "@/lib/config";
import { normaliseCondition } from "@/lib/pipeline/gaps";
import { compareStudies } from "./ordering";
import type { Repo, StudyFilter } from "./repo";
import type { Gap, IngestRun, Study } from "./types";

/**
 * Supabase-backed store.
 *
 * Reads use the anon key, since RLS allows public select, so the dashboard can
 * render on the edge. Writes require the service-role key, which only ever
 * exists in the ingest job's environment. Constructing a writer without it
 * fails loudly at startup rather than silently returning empty results.
 */
export class SupabaseRepo implements Repo {
  readonly name = "supabase";
  private readonly db: SupabaseClient;

  constructor(private readonly write = false) {
    const key = write ? config.store.supabaseServiceKey : config.store.supabaseAnonKey;
    if (!config.store.supabaseUrl || !key) {
      throw new Error(
        write
          ? "SUPABASE_SERVICE_ROLE_KEY is required for writes"
          : "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required",
      );
    }
    this.db = createClient(config.store.supabaseUrl, key, { auth: { persistSession: false } });
  }

  async upsertStudies(rows: Study[]) {
    if (rows.length === 0) return { inserted: 0, updated: 0 };

    const known = await this.knownHashes();
    const inserted = rows.filter((r) => !known.has(r.id)).length;

    // first_seen_at is column-defaulted and omitted on update, so an update
    // never rewrites the date the record was first observed.
    const { error } = await this.db.from("studies").upsert(
      rows.map(({ first_seen_at, ...rest }) => ({
        ...rest,
        condition_key: normaliseCondition(rest.condition),
        ...(known.has(rest.id) ? {} : { first_seen_at }),
      })),
      { onConflict: "id", ignoreDuplicates: false },
    );
    if (error) throw new Error(`supabase upsert failed: ${error.message}`);

    return { inserted, updated: rows.length - inserted };
  }

  async listStudies(filter: StudyFilter = {}) {
    let q = this.db.from("studies").select("*");

    if (filter.source) q = q.eq("source", filter.source);
    if (filter.representation) q = q.eq("representation", filter.representation);
    if (filter.studyType) q = q.eq("study_type", filter.studyType);
    if (filter.minConfidence !== undefined) q = q.gte("confidence", filter.minConfidence);
    if (filter.condition) q = q.eq("condition_key", normaliseCondition(filter.condition));
    if (filter.q) {
      const term = `%${filter.q.replace(/[%_]/g, "")}%`;
      q = q.or(`title.ilike.${term},condition.ilike.${term},population_note.ilike.${term}`);
    }

    const { data, error } = await q
      .order("year", { ascending: false, nullsFirst: false })
      .range(filter.offset ?? 0, (filter.offset ?? 0) + (filter.limit ?? 100) - 1);

    if (error) throw new Error(`supabase select failed: ${error.message}`);
    // Ordered again by the shared comparator so both stores agree exactly.
    return ((data ?? []) as Study[]).sort(compareStudies);
  }

  async getStudy(id: string) {
    const { data, error } = await this.db.from("studies").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`supabase select failed: ${error.message}`);
    return (data as Study) ?? null;
  }

  async knownHashes() {
    const { data, error } = await this.db.from("studies").select("id,content_hash");
    if (error) throw new Error(`supabase select failed: ${error.message}`);
    return new Map((data ?? []).map((r) => [r.id as string, r.content_hash as string]));
  }

  async saveGaps(gaps: Gap[]) {
    // Derived data: replace the set rather than merge, so a condition that stops
    // appearing does not linger as a stale row.
    const { error: clearError } = await this.db.from("gaps").delete().neq("condition", "");
    if (clearError) throw new Error(`supabase delete failed: ${clearError.message}`);
    if (gaps.length === 0) return;

    const { error } = await this.db.from("gaps").insert(gaps);
    if (error) throw new Error(`supabase insert failed: ${error.message}`);
  }

  async listGaps(limit = 50) {
    const { data, error } = await this.db
      .from("gaps")
      .select("*")
      .order("gap_score", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`supabase select failed: ${error.message}`);
    return (data ?? []) as Gap[];
  }

  async startRun(run: IngestRun) {
    const { error } = await this.db.from("ingest_runs").insert(run);
    if (error) throw new Error(`supabase insert failed: ${error.message}`);
  }

  async finishRun(run: IngestRun) {
    const { error } = await this.db.from("ingest_runs").upsert(run, { onConflict: "id" });
    if (error) throw new Error(`supabase upsert failed: ${error.message}`);
  }

  async listRuns(limit = 20) {
    const { data, error } = await this.db
      .from("ingest_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`supabase select failed: ${error.message}`);
    return (data ?? []) as IngestRun[];
  }
}
