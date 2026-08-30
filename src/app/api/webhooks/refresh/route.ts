import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { runIngest } from "@/lib/pipeline/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reject anything older than this, so a captured request can't be replayed. */
const MAX_SKEW_MS = 5 * 60 * 1000;

/**
 * POST /api/webhooks/refresh
 *
 * Signed trigger for an out-of-band re-crawl — the endpoint a funder-side
 * integration or an internal admin tool would call when it knows something has
 * changed, instead of waiting for the next scheduled run.
 *
 * Signature scheme (the Stripe/GitHub shape):
 *   x-scout-timestamp: <unix ms>
 *   x-scout-signature: sha256=<hex hmac of "<timestamp>.<raw body>">
 *
 * The timestamp is inside the signed payload, so an attacker cannot replay an
 * old request with a fresh timestamp — changing it invalidates the signature.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const raw = await req.text();
  const signature = req.headers.get("x-scout-signature");
  const timestamp = req.headers.get("x-scout-timestamp");

  if (!signature || !timestamp) {
    return NextResponse.json({ error: "missing signature headers" }, { status: 401 });
  }

  const age = Date.now() - Number(timestamp);
  if (!Number.isFinite(age) || Math.abs(age) > MAX_SKEW_MS) {
    return NextResponse.json({ error: "timestamp outside tolerance" }, { status: 401 });
  }

  const expected = `sha256=${createHmac("sha256", config.auth.webhookSecret)
    .update(`${timestamp}.${raw}`)
    .digest("hex")}`;

  if (!safeEqual(signature, expected)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let body: { sources?: string[]; force?: boolean; budget?: number } = {};
  if (raw.trim()) {
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      return NextResponse.json({ error: "body is not valid JSON" }, { status: 400 });
    }
  }

  // A serverless function is the wrong place for a full crawl, so the budget is
  // deliberately small here. The nightly GitHub Actions job does the heavy run
  // with no such cap; this path exists for targeted, immediate refreshes.
  const run = await runIngest({
    trigger: "webhook",
    sources: body.sources,
    force: body.force ?? false,
    budget: Math.min(body.budget ?? 8, 15),
  });

  return NextResponse.json({
    run_id: run.id,
    fetched: run.pages_fetched,
    skipped: run.pages_skipped,
    extracted: run.extracted,
    rejected: run.rejected,
    errors: run.errors.slice(0, 5),
  });
}

/** Constant-time compare that also tolerates a length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
