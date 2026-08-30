import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { normaliseCondition } from "@/lib/pipeline/gaps";
import { compareStudies } from "./ordering";
import type { Repo, StudyFilter } from "./repo";
import type { Gap, IngestRun, Study } from "./types";

type Shape = {
  studies: Study[];
  gaps: Gap[];
  runs: IngestRun[];
};

const EMPTY: Shape = { studies: [], gaps: [], runs: [] };

/**
 * File-backed store used when no Supabase credentials are present.
 *
 * Writes go through a temp file plus a rename, so an interrupted run cannot
 * leave a half-written JSON file behind. Reads and writes are serialised
 * through a single promise chain so concurrent upserts from the pipeline do not
 * clobber each other.
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

  async upsertStudies(rows: Study[]) {
    return this.mutate((data) => {
      let inserted = 0;
      let updated = 0;
      for (const row of rows) {
        const i = data.studies.findIndex((s) => s.id === row.id);
        if (i === -1) {
          data.studies.push(row);
          inserted++;
        } else {
          // Preserve the original sighting date; everything else is fresher.
          data.studies[i] = { ...row, first_seen_at: data.studies[i]!.first_seen_at };
          updated++;
        }
      }
      return { inserted, updated };
    });
  }

  async listStudies(filter: StudyFilter = {}) {
    const { studies } = await this.read();
    return applyFilter(studies, filter);
  }

  async getStudy(id: string) {
    const { studies } = await this.read();
    return studies.find((s) => s.id === id) ?? null;
  }

  async knownHashes() {
    const { studies } = await this.read();
    return new Map(studies.map((s) => [s.id, s.content_hash]));
  }

  async saveGaps(gaps: Gap[]) {
    // Gaps are derived, so a fresh computation replaces the set outright rather
    // than merging. Merging would leave stale conditions behind after a source
    // stops returning them.
    await this.mutate((data) => {
      data.gaps = gaps;
    });
  }

  async listGaps(limit = 50) {
    const { gaps } = await this.read();
    return [...gaps].sort((a, b) => b.gap_score - a.gap_score).slice(0, limit);
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

export function applyFilter(rows: Study[], f: StudyFilter): Study[] {
  const q = f.q?.toLowerCase().trim();
  const condition = f.condition ? normaliseCondition(f.condition) : undefined;

  const out = rows.filter((s) => {
    if (f.source && s.source !== f.source) return false;
    if (f.representation && s.representation !== f.representation) return false;
    if (f.studyType && s.study_type !== f.studyType) return false;
    if (f.minConfidence !== undefined && s.confidence < f.minConfidence) return false;
    if (condition && normaliseCondition(s.condition) !== condition) return false;
    if (q) {
      const hay =
        `${s.title} ${s.condition} ${s.intervention ?? ""} ${s.population_note} ${s.countries.join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  out.sort(compareStudies);

  const start = f.offset ?? 0;
  return out.slice(start, start + (f.limit ?? 100));
}
