/**
 * Central runtime configuration.
 *
 * Design rule for this project: every external dependency has a zero-config
 * fallback. A fresh clone with no `.env.local` runs the full pipeline against
 * bundled fixtures + a deterministic extractor + a local JSON store, so the
 * repo is testable in CI and demoable offline. Supplying a key promotes that
 * one layer to the real service; no other code changes.
 */

const env = (key: string): string | undefined => {
  const raw = process.env[key];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export type LlmProvider = "gemini" | "groq" | "openrouter" | "mock";
export type ScrapeProvider = "firecrawl" | "playwright" | "fetch" | "fixture";
export type StoreProvider = "supabase" | "json";

function resolveLlm(): LlmProvider {
  const forced = env("LLM_PROVIDER");
  if (forced && forced !== "auto") return forced as LlmProvider;
  if (env("GEMINI_API_KEY")) return "gemini";
  if (env("GROQ_API_KEY")) return "groq";
  if (env("OPENROUTER_API_KEY")) return "openrouter";
  return "mock";
}

/**
 * Which fetcher pulls full text when a registry record omits its population.
 *
 * Note what this does NOT control: where records come from. Both registries are
 * free public APIs needing no key, so a live run is the default and "fixture"
 * has to be asked for explicitly. Defaulting to fixtures here would mean
 * someone who added only an LLM key silently kept getting saved records while
 * believing they were live, which is the worst kind of wrong.
 */
function resolveScrape(): ScrapeProvider {
  const forced = env("SCRAPE_PROVIDER");
  if (forced && forced !== "auto") return forced as ScrapeProvider;
  if (env("FIRECRAWL_API_KEY")) return "firecrawl";
  return "fetch";
}

function resolveStore(): StoreProvider {
  return env("NEXT_PUBLIC_SUPABASE_URL") && env("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    ? "supabase"
    : "json";
}

export const config = {
  llm: {
    provider: resolveLlm(),
    geminiKey: env("GEMINI_API_KEY"),
    groqKey: env("GROQ_API_KEY"),
    openrouterKey: env("OPENROUTER_API_KEY"),
    /**
     * Free-tier friendly defaults. Override per provider if you have quota.
     *
     * Gemini is a comma-separated chain rather than one name, because both
     * failure modes showed up within a minute of each other on a fresh key.
     * A pinned `gemini-2.5-flash` returned "no longer available to new users":
     * still listed by the API, closed to new accounts. The `gemini-flash-latest`
     * alias that replaced it returned 503 for high demand. One name cannot
     * survive both. The chain leads with the alias so it does not rot, backs
     * onto a known-good version, then onto Lite. Set GEMINI_MODEL to a single
     * name to pin it when reproducibility matters more than availability.
     */
    model: {
      // A chain, tried in order. See GeminiClient for why.
      gemini: env("GEMINI_MODEL") ?? "gemini-flash-latest,gemini-3.5-flash,gemini-flash-lite-latest",
      groq: env("GROQ_MODEL") ?? "llama-3.3-70b-versatile",
      openrouter: env("OPENROUTER_MODEL") ?? "meta-llama/llama-3.3-70b-instruct:free",
    },
  },
  /** USD per million tokens, paid tier. Used for the run cost estimate only. */
  pricing: {
    gemini: { input: 0.3, output: 2.5 },
    groq: { input: 0, output: 0 },
    openrouter: { input: 0, output: 0 },
    mock: { input: 0, output: 0 },
  } as Record<string, { input: number; output: number }>,
  scrape: {
    provider: resolveScrape(),
    firecrawlKey: env("FIRECRAWL_API_KEY"),
    /** Politeness: never hammer a source we do not own. */
    delayMs: Number(env("SCRAPE_DELAY_MS") ?? 1200),
    timeoutMs: Number(env("SCRAPE_TIMEOUT_MS") ?? 30_000),
    userAgent:
      env("SCRAPE_USER_AGENT") ??
      "ScoutBot/0.1 (+https://github.com/; research funding aggregator; contact via repo)",
  },
  store: {
    provider: resolveStore(),
    supabaseUrl: env("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseAnonKey: env("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    supabaseServiceKey: env("SUPABASE_SERVICE_ROLE_KEY"),
    jsonPath: env("JSON_STORE_PATH") ?? ".data/store.json",
  },
  auth: {
    webhookSecret: env("WEBHOOK_SECRET") ?? "dev-secret-change-me",
    cronSecret: env("CRON_SECRET") ?? "dev-cron-change-me",
  },
} as const;

/** Rendered in the dashboard footer so a reviewer can see the live wiring. */
export function activeStack() {
  return {
    scrape: config.scrape.provider,
    llm: config.llm.provider,
    store: config.store.provider,
  };
}
