import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { compareOpportunities } from "./ordering";
import type { OpportunityFilter, Repo } from "./repo";
import type { IngestRun, Match, Opportunity, Profile } from "./types";

type Shape = {
  opportunities: Opportunity[];
  profiles: Profile[];
  matches: Match[];
  runs: IngestRun[];
};

const EMPTY: Shape = { opportunities: [], profiles: [], matches: [], runs: [] };

/**
 * File-backed store used when no Supabase credentials are present.
 *
 * Writes go through a temp file + rename so an interrupted run (Ctrl-C during a
 * crawl, which happens constantly in development) can't leave a half-written
 * JSON file behind. Reads are serialised through a single promise chain so
 * concurrent upserts from the pipeline don't clobber each other.
 */
export class JsonRepo implements Repo {
  readonly name = "json";
  private queue: Promise<unknown> = Promise.resolve();

  // Relative paths are fine as-is: node:fs resolves them against cwd, and
  // resolving here instead would make the build trace the entire project.
  constructor(private readonly file: string) {}

  private async read(): Promise<Shape> {
    try {
      return { ...EMPTY, ...(JSON.parse(await readFile(this.file, "utf8")) as Partial<Shape>) };
    } catch {
      return structuredClone(EMPTY);
    }
  }

  private async write(data: Shape): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
    await rename(tmp, this.file);
  }

  /** Serialises read-modify-write cycles; the JSON file has no transactions. */
  private mutate<T>(fn: (data: Shape) => Promise<T> | T): Promise<T> {
    const next = this.queue.then(async () => {
      const data = await this.read();
      const result = await fn(data);
      await this.write(data);
      return result;
    });
    this.queue = next.catch(() => {});
    return next;
  }

  async upsertOpportunities(rows: Opportunity[]) {
    return this.mutate((data) => {
      let inserted = 0;
      let updated = 0;
      for (const row of rows) {
        const i = data.opportunities.findIndex((o) => o.id === row.id);
        if (i === -1) {
          data.opportunities.push(row);
          inserted++;
        } else {
          // Preserve the original sighting date; everything else is fresher.
          data.opportunities[i] = { ...row, first_seen_at: data.opportunities[i]!.first_seen_at };
          updated++;
        }
      }
      return { inserted, updated };
    });
  }

  async listOpportunities(filter: OpportunityFilter = {}) {
    const { opportunities } = await this.read();
    return applyFilter(opportunities, filter);
  }

  async getOpportunity(id: string) {
    const { opportunities } = await this.read();
    return opportunities.find((o) => o.id === id) ?? null;
  }

  async knownHashes() {
    const { opportunities } = await this.read();
    return new Map(opportunities.map((o) => [o.id, o.content_hash]));
  }

  async listProfiles() {
    return (await this.read()).profiles;
  }

  async upsertProfile(profile: Profile) {
    await this.mutate((data) => {
      const i = data.profiles.findIndex((p) => p.id === profile.id);
      if (i === -1) data.profiles.push(profile);
      else data.profiles[i] = profile;
    });
  }

  async saveMatches(matches: Match[]) {
    await this.mutate((data) => {
      for (const m of matches) {
        const i = data.matches.findIndex(
          (x) => x.opportunity_id === m.opportunity_id && x.profile_id === m.profile_id,
        );
        if (i === -1) data.matches.push(m);
        else data.matches[i] = m;
      }
    });
  }

  async listMatches(profileId: string, limit = 50) {
    const { matches } = await this.read();
    return matches
      .filter((m) => m.profile_id === profileId)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async startRun(run: IngestRun) {
    await this.mutate((data) => {
      data.runs.unshift(run);
      data.runs = data.runs.slice(0, 200);
    });
  }

  async finishRun(run: IngestRun) {
    await this.mutate((data) => {
      const i = data.runs.findIndex((r) => r.id === run.id);
      if (i === -1) data.runs.unshift(run);
      else data.runs[i] = run;
    });
  }

  async listRuns(limit = 20) {
    return (await this.read()).runs.slice(0, limit);
  }
}

export function applyFilter(rows: Opportunity[], f: OpportunityFilter): Opportunity[] {
  const q = f.q?.toLowerCase().trim();
  const out = rows.filter((o) => {
    if (f.source && o.source !== f.source) return false;
    if (f.status && o.status !== f.status) return false;
    if (f.minConfidence !== undefined && o.confidence < f.minConfidence) return false;
    if (f.discipline && !o.disciplines.some((d) => d.toLowerCase() === f.discipline!.toLowerCase()))
      return false;
    if (q) {
      const hay = `${o.title} ${o.funder} ${o.summary} ${o.disciplines.join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  out.sort((a, b) => compareOpportunities(a, b));

  const start = f.offset ?? 0;
  return out.slice(start, start + (f.limit ?? 100));
}
