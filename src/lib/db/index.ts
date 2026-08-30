import { config } from "@/lib/config";
import type { Repo } from "./repo";

export * from "./types";
export type { Repo, StudyFilter } from "./repo";

let readCache: Repo | null = null;

/** Read-only handle for pages and API routes. */
export async function getRepo(): Promise<Repo> {
  if (readCache) return readCache;
  readCache = await make(false);
  return readCache;
}

/** Write handle for the ingest pipeline. Never cached across runs. */
export async function getWriteRepo(): Promise<Repo> {
  return make(true);
}

// Both implementations load lazily: the bundler then only pulls in the one the
// running environment actually selects, and neither drags the other's
// dependencies (supabase-js, node:fs) into a bundle that has no use for them.
async function make(write: boolean): Promise<Repo> {
  if (config.store.provider === "supabase") {
    const { SupabaseRepo } = await import("./supabase-repo");
    return new SupabaseRepo(write);
  }
  const { JsonRepo } = await import("./json-repo");
  return new JsonRepo(config.store.jsonPath);
}
