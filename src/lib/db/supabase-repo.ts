import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "@/lib/config";
import { compareOpportunities } from "./ordering";
import type { OpportunityFilter, Repo } from "./repo";
import type { IngestRun, Match, Opportunity, Profile } from "./types";

/**
 * Supabase-backed store.
 *
 * Reads use the anon key (RLS allows public select) so the dashboard can render
 * on the edge; writes require the service-role key, which only ever exists in
 * the ingest job's environment. Constructing a writer without it fails loudly
 * at startup rather than silently returning empty results from RLS.
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
    this.db = createClient(config.store.supabaseUrl, key, {
      auth: { persistSession: false },
    });
  }

  async upsertOpportunities(rows: Opportunity[]) {
    if (rows.length === 0) return { inserted: 0, updated: 0 };

    const known = await this.knownHashes();
    const inserted = rows.filter((r) => !known.has(r.id)).length;

    // ignoreDuplicates:false = real upsert. first_seen_at is column-defaulted
    // and deliberately omitted so an update never rewrites the original date.
    const { error } = await this.db.from("opportunities").upsert(
      rows.map(({ first_seen_at, ...rest }) => ({
        ...rest,
        ...(known.has(rest.id) ? {} : { first_seen_at }),
      })),
      { onConflict: "id", ignoreDuplicates: false },
    );
    if (error) throw new Error(`supabase upsert failed: ${error.message}`);

    return { inserted, updated: rows.length - inserted };
  }

  async listOpportunities(filter: OpportunityFilter = {}) {
    let q = this.db.from("opportunities").select("*");

    if (filter.source) q = q.eq("source", filter.source);
    if (filter.status) q = q.eq("status", filter.status);
    if (filter.minConfidence !== undefined) q = q.gte("confidence", filter.minConfidence);
    if (filter.discipline) q = q.contains("disciplines", [filter.discipline]);
    if (filter.q) {
      const term = `%${filter.q.replace(/[%_]/g, "")}%`;
      q = q.or(`title.ilike.${term},funder.ilike.${term},summary.ilike.${term}`);
    }

    const { data, error } = await q
      // Ordered again below by the shared comparator; this clause exists so the
      // partial deadline index does the paging work rather than a full sort.
      .order("deadline", { ascending: true, nullsFirst: false })
      .range(filter.offset ?? 0, (filter.offset ?? 0) + (filter.limit ?? 100) - 1);

    if (error) throw new Error(`supabase select failed: ${error.message}`);
    return ((data ?? []) as Opportunity[]).sort((a, b) => compareOpportunities(a, b));
  }

  async getOpportunity(id: string) {
    const { data, error } = await this.db
      .from("opportunities")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`supabase select failed: ${error.message}`);
    return (data as Opportunity) ?? null;
  }

  async knownHashes() {
    const { data, error } = await this.db.from("opportunities").select("id,content_hash");
    if (error) throw new Error(`supabase select failed: ${error.message}`);
    return new Map((data ?? []).map((r) => [r.id as string, r.content_hash as string]));
  }

  async listProfiles() {
    const { data, error } = await this.db.from("profiles").select("*");
    if (error) throw new Error(`supabase select failed: ${error.message}`);
    return (data ?? []) as Profile[];
  }

  async upsertProfile(profile: Profile) {
    const { error } = await this.db.from("profiles").upsert(profile, { onConflict: "id" });
    if (error) throw new Error(`supabase upsert failed: ${error.message}`);
  }

  async saveMatches(matches: Match[]) {
    if (matches.length === 0) return;
    const { error } = await this.db
      .from("matches")
      .upsert(matches, { onConflict: "opportunity_id,profile_id" });
    if (error) throw new Error(`supabase upsert failed: ${error.message}`);
  }

  async listMatches(profileId: string, limit = 50) {
    const { data, error } = await this.db
      .from("matches")
      .select("*")
      .eq("profile_id", profileId)
      .order("score", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`supabase select failed: ${error.message}`);
    return (data ?? []) as Match[];
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
