import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { runIngest } from "@/lib/pipeline/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/ingest
 *
 * Scheduled entry point. Vercel Cron calls this with the project's CRON_SECRET
 * as a bearer token; the same URL works from any scheduler.
 *
 * Note on where the real work happens: Hobby functions cap out at 60s, which is
 * nowhere near enough for a full multi-source crawl. This route therefore runs
 * a small, bounded slice and the nightly GitHub Actions workflow does the
 * complete pass. Keeping both on the same `runIngest` call means there is only
 * one code path to reason about.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${config.auth.cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const run = await runIngest({ trigger: "cron", budget: 10 });

  return NextResponse.json({
    run_id: run.id,
    duration_ms: Date.now() - started,
    scrape_provider: run.scrape_provider,
    llm_provider: run.llm_provider,
    fetched: run.pages_fetched,
    skipped: run.pages_skipped,
    extracted: run.extracted,
    rejected: run.rejected,
  });
}
