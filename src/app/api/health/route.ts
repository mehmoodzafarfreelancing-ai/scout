import { NextResponse } from "next/server";
import { activeStack } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health
 *
 * Which providers resolved, and which configuration the running instance can
 * actually see.
 *
 * This exists because of a specific and very common deployment failure: the
 * dashboard renders perfectly, reports no error, and quietly serves an empty
 * local store because one environment variable name is misspelled. Nothing in
 * the UI can tell you that, and reading the variable list by eye is exactly the
 * task humans are worst at.
 *
 * It reports presence as booleans and never values. A health endpoint that
 * leaks a service-role key is worse than no health endpoint.
 */

const EXPECTED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "FIRECRAWL_API_KEY",
  "LLM_PROVIDER",
  "SCRAPE_PROVIDER",
  "WEBHOOK_SECRET",
  "CRON_SECRET",
] as const;

/** Words that should only ever appear inside a name on the list above. */
const FAMILIAR = ["SUPABASE", "SUPA", "GEMINI", "GROQ", "OPENROUTER", "FIRECRAWL", "WEBHOOK", "CRON"];

export async function GET(): Promise<NextResponse> {
  const present: Record<string, boolean> = {};
  for (const key of EXPECTED) {
    present[key] = (process.env[key] ?? "").trim().length > 0;
  }

  // Anything that looks like it was meant to be one of ours but is not spelled
  // like one of ours. This is what catches SUPBASE_URL or GEMINI_KEY, which are
  // invisible in a list of eleven similar-looking names.
  const misspelled = Object.keys(process.env).filter(
    (key) =>
      !EXPECTED.includes(key as (typeof EXPECTED)[number]) &&
      FAMILIAR.some((word) => key.toUpperCase().includes(word)),
  );

  const stack = activeStack();

  // A deployment on fallbacks is running, but it is not doing the job. Say so
  // in the status code, so an uptime check notices what a human eye would not.
  const configured = stack.store === "supabase" && stack.llm !== "mock";

  return NextResponse.json(
    {
      ok: true,
      configured,
      providers: stack,
      env_present: present,
      possibly_misspelled: misspelled,
      hint: configured
        ? undefined
        : "Running on fallbacks. Check env_present for a false where you expected true, and possibly_misspelled for a near-miss name. On Vercel, environment variables only apply to builds made after they were added, so redeploy after changing them.",
    },
    { status: configured ? 200 : 503 },
  );
}
