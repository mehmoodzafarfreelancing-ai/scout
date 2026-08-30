# Scout

Finds research funding calls across funder websites, turns each page into a
structured record with an LLM, and ranks them against a researcher's profile —
with a reason attached to every score.

**Live demo:** _add your Vercel URL here_

```
Funder sites ──▶ scrape ──▶ LLM extraction ──▶ dedupe ──▶ Supabase ──▶ dashboard
                    │            │                │
             Firecrawl /    schema-guided    content-hash
             Playwright /   + self-repair    (skip unchanged)
             plain fetch
```

Run daily by GitHub Actions; re-crawled on demand through a signed webhook.

---

## Run it in 30 seconds, with no API keys

```bash
npm install && npm run ingest:fixtures && npm run seed && npm run dev
```

That is the real pipeline — discovery, normalisation, extraction, validation,
dedupe, storage, scoring — running against bundled HTML fixtures with a
deterministic extractor and a local JSON store. No network, no keys, no spend.

It exists for three reasons: you can evaluate this repo without signing up for
anything, CI can exercise the whole pipeline for free on every push, and the
rule-based extractor doubles as the baseline the real model has to beat.

## Going live

Every layer promotes independently. Add a key, that layer switches; add none
and it stays on the fallback.

| Layer | Fallback | Add this to promote it |
| --- | --- | --- |
| Storage | JSON file at `.data/store.json` | `NEXT_PUBLIC_SUPABASE_URL` + keys — run [`schema.sql`](src/lib/db/schema.sql) first |
| Extraction | rule-based heuristics | `GEMINI_API_KEY` (or Groq / OpenRouter) |
| Scraping | bundled fixtures | `FIRECRAWL_API_KEY`, or `SCRAPE_PROVIDER=playwright` |
| Discovery | seed listing pages only | `EXA_API_KEY` |

```bash
cp .env.example .env.local   # every entry is optional
npm run ingest               # provider selection is automatic
```

The header of the running app shows which providers are live, so a demo that
behaves oddly tells you why without opening a terminal.

## How it works

**Sources are data, not code.** A funder is a seed URL plus URL patterns that
say which links are real detail pages ([`sources.ts`](src/lib/pipeline/sources.ts)).
Adding one is a config change, and a page rejected by a regex never costs a
model call.

**One Zod schema, three jobs.** [`ExtractedOpportunity`](src/lib/db/types.ts)
is injected into the prompt as the target shape, validates the response before
anything reaches the database, and types the UI. Change it and `tsc` finds
every gap.

**Bad output gets repaired, not discarded.** The failure that matters is not a
refusal — it is confident JSON that breaks the contract: a deadline as
`"Spring 2026"`, confidence as `"high"`, a missing field. Zod catches it at the
boundary and [`extract.ts`](src/lib/llm/extract.ts) hands the model its own
output plus the specific validation errors and asks for a correction. One
repair turn recovers most failures, which matters when the budget is a free
tier. Before that, [`json.ts`](src/lib/llm/json.ts) salvages fenced,
prose-wrapped and trailing-comma output without spending a second call.

**Unchanged pages never reach the model.** Content is hashed with whitespace
and clock stamps normalised out ([`ids.ts`](src/lib/pipeline/ids.ts)), so a
"last updated 14:32" ticker doesn't re-bill the whole corpus every night. This
is the single largest cost saving in the pipeline.

**Scraping degrades instead of failing.** Firecrawl has a hard credit ceiling
and Playwright can't run on Vercel, so providers are chained: a retryable
failure cascades to the next one, and only a total wipeout throws
([`scrape/index.ts`](src/lib/scrape/index.ts)).

**Scores are explainable, deliberately.** Matching is weighted keyword and
discipline overlap, not embeddings. Someone deciding whether to spend three
weeks on an application needs to know *why* a call surfaced, and a cosine
distance can't tell them — so every point traces to a sentence shown in the UI
([`match.ts`](src/lib/pipeline/match.ts)). Embeddings are the right upgrade for
recall once the corpus is large enough that keyword overlap starts missing
things; the interface wouldn't change, only the body of that function.

**Both stores share one comparator.** Postgres can't express "closed last, then
soonest deadline, then undated" in one index-friendly `ORDER BY`, and having
the two stores disagree about row order is exactly the bug that only appears in
a demo. Pages are capped at a few hundred rows, so both fetch and then sort
through [`ordering.ts`](src/lib/db/ordering.ts).

## Background jobs and webhooks

| Trigger | Path | Auth | Does |
| --- | --- | --- | --- |
| Nightly | [`ingest.yml`](.github/workflows/ingest.yml) | repo secrets | Full crawl, Chromium available, no time cap |
| Daily | `GET /api/cron/ingest` | `Bearer $CRON_SECRET` | Bounded slice within the 60s function limit |
| On demand | `POST /api/webhooks/refresh` | HMAC-SHA256 | Targeted re-crawl |

The heavy work runs in GitHub Actions because a serverless function is the
wrong place for a multi-source crawl — but both paths call the same
`runIngest`, so there is one code path to reason about.

The webhook signs `"<timestamp>.<raw body>"`, compares in constant time, and
rejects anything more than five minutes old. The timestamp is *inside* the
signed payload, so a captured request can't be replayed with a fresh one.

```bash
BODY='{"sources":["ukri"],"force":true}'
TS=$(date +%s000)
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -hex | sed 's/^.* //')
curl -X POST localhost:3000/api/webhooks/refresh \
  -H "x-scout-timestamp: $TS" -H "x-scout-signature: sha256=$SIG" \
  -H 'content-type: application/json' -d "$BODY"
```

## Tests

```bash
npm test        # 52 tests
npm run typecheck
```

Covering JSON salvage (fences, prose, trailing commas, braces inside strings),
the repair loop against a scripted client, HTML normalisation, id and hash
stability, scoring behaviour at the deadline and confidence edges, and result
ordering. CI additionally runs the full pipeline on fixtures and asserts it
stored something coherent, so a refactor that quietly breaks extraction fails
the build rather than the next crawl.

## Known limits

- **The heuristic extractor is a floor, not a product.** On the NSF fixture it
  reads the programme's total budget as the individual award ceiling —
  `$250k–$95M`. Distinguishing "we will award $95M in total" from "your award
  may reach $1.2M" needs the language model; that gap is the clearest argument
  for the cost, and it's why the baseline is checked in rather than hidden.
- **No eval harness yet.** The next thing I'd build: label ~50 real pages, then
  score both extractors against them per field. Without that, "the LLM is
  better" is an assertion.
- **Scoring has no learning signal.** Weights are hand-set. Click-through or
  saved-opportunity data would let them be fitted rather than guessed.
- **Three sources.** The registry is built to grow; the crawl budget and the
  free-tier ceilings are what actually cap it.

## Stack

Next.js 16 · React · TypeScript (strict, `noUncheckedIndexedAccess`) ·
Tailwind v4 · Supabase (Postgres + RLS) · Zod · Playwright · Firecrawl · Exa ·
Gemini / Groq / OpenRouter · GitHub Actions · Vercel

---

Extracted data can be wrong. The UI shows extraction confidence and a link back
to the source page on every record, because a tool like this is only useful if
it tells you when to double-check it.
