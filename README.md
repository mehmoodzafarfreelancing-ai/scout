# Scout

Finds research funding calls across funder websites, turns each page into a
structured record with an LLM, and ranks them against a researcher's profile.
Every score comes with a reason.

**Live demo:** _add your Vercel URL here_

```
Funder sites ──▶ scrape ──▶ LLM extraction ──▶ dedupe ──▶ Supabase ──▶ dashboard
                    │            │                │
             Firecrawl /    schema-guided    content-hash
             Playwright /   + self-repair    (skip unchanged)
             plain fetch
```

Runs nightly on GitHub Actions. Re-crawls on demand through a signed webhook.

---

## Run it in 30 seconds, with no API keys

```bash
npm install && npm run ingest:fixtures && npm run seed && npm run dev
```

That is the real pipeline. Discovery, normalisation, extraction, validation,
dedupe, storage and scoring, all running against bundled HTML fixtures with a
deterministic extractor and a local JSON store. No network, no keys, no spend.

It exists for three reasons. You can evaluate this repo without signing up for
anything. CI can exercise the whole pipeline for free on every push. And the
rule-based extractor doubles as the baseline the real model has to beat.

## Going live

Every layer promotes independently. Add a key and that layer switches. Add none
and it stays on the fallback.

| Layer | Fallback | Add this to promote it |
| --- | --- | --- |
| Storage | JSON file at `.data/store.json` | `NEXT_PUBLIC_SUPABASE_URL` + keys, after running [`schema.sql`](src/lib/db/schema.sql) |
| Extraction | rule-based heuristics | `GEMINI_API_KEY`, or Groq, or OpenRouter |
| Scraping | bundled fixtures | `FIRECRAWL_API_KEY`, or `SCRAPE_PROVIDER=playwright` |
| Discovery | seed listing pages only | `EXA_API_KEY` |

```bash
cp .env.example .env.local   # every entry is optional
npm run ingest               # provider selection is automatic
```

The running app shows which providers are live in its header, so a demo that
behaves oddly tells you why without opening a terminal.

## How it works

**Sources are data, not code.** A funder is a seed URL plus URL patterns saying
which links are real detail pages ([`sources.ts`](src/lib/pipeline/sources.ts)).
Adding one is a config change. A page rejected by a pattern never costs a model
call.

**One Zod schema, three jobs.** [`ExtractedOpportunity`](src/lib/db/types.ts) is
injected into the prompt as the target shape, validates the response before
anything reaches the database, and types the UI. Change it and `tsc` finds every
gap.

**Bad output gets repaired, not discarded.** The failure that matters here is not
a refusal. It is confident JSON that breaks the contract: a deadline written as
`"Spring 2026"`, confidence as `"high"`, a missing field. Zod catches that at the
boundary, and [`extract.ts`](src/lib/llm/extract.ts) hands the model its own
output plus the specific validation errors and asks for a correction. One repair
turn recovers most failures, which matters when the budget is a free tier. Before
that, [`json.ts`](src/lib/llm/json.ts) salvages fenced, prose-wrapped and
trailing-comma output without spending a second call.

**Unchanged pages never reach the model.** Content is hashed with whitespace and
clock stamps normalised out ([`ids.ts`](src/lib/pipeline/ids.ts)), so a "last
updated 14:32" ticker does not re-bill the whole corpus every night. This is the
single largest cost saving in the pipeline.

**Scraping degrades instead of failing.** Firecrawl has a hard credit ceiling and
Playwright cannot run on Vercel, so providers are chained. A retryable failure
cascades to the next one, and only a total wipeout throws
([`scrape/index.ts`](src/lib/scrape/index.ts)).

**Scores are explainable, deliberately.** Matching is weighted keyword and
discipline overlap rather than embeddings. Someone deciding whether to spend
three weeks on an application needs to know *why* a call surfaced, and a cosine
distance cannot tell them. Every point traces to a sentence shown in the UI
([`match.ts`](src/lib/pipeline/match.ts)). Embeddings are the right upgrade for
recall once the corpus is large enough that keyword overlap starts missing
things. The interface would not change, only the body of that function.

**Both stores share one comparator.** Postgres cannot express "closed last, then
soonest deadline, then undated" in one index-friendly `ORDER BY`, and having the
two stores disagree about row order is exactly the bug that only appears in a
demo. Pages are capped at a few hundred rows, so both fetch and then sort through
[`ordering.ts`](src/lib/db/ordering.ts).

## Background jobs and webhooks

| Trigger | Path | Auth | Does |
| --- | --- | --- | --- |
| Nightly | [`ingest.yml`](.github/workflows/ingest.yml) | repo secrets | Full crawl, Chromium available, no time cap |
| Daily | `GET /api/cron/ingest` | `Bearer $CRON_SECRET` | Bounded slice within the 60s function limit |
| On demand | `POST /api/webhooks/refresh` | HMAC-SHA256 | Targeted re-crawl |

The heavy work runs in GitHub Actions because a serverless function is the wrong
place for a multi-source crawl. Both paths call the same `runIngest`, so there is
one code path to reason about.

The webhook signs `"<timestamp>.<raw body>"`, compares in constant time, and
rejects anything more than five minutes old. The timestamp sits *inside* the
signed payload, so a captured request cannot be replayed with a fresh one.

```bash
BODY='{"sources":["ukri"],"force":true}'
TS=$(date +%s000)
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -hex | sed 's/^.* //')
curl -X POST localhost:3000/api/webhooks/refresh \
  -H "x-scout-timestamp: $TS" -H "x-scout-signature: sha256=$SIG" \
  -H 'content-type: application/json' -d "$BODY"
```

## Evaluation

`npm run eval` scores an extractor against
[hand-labelled fixtures](evals/labels.json), field by field, so "the model beats
the baseline" becomes a number rather than a claim. Both extractors see the same
pages and the same grader. The eval imports the pipeline's own accept thresholds
instead of restating them, because an eval that grades a different accept path
measures a system nobody is running.

The checked-in baseline (`npm run eval:baseline`, rule-based, no API key):

```
  field         score
  ─────────────────────────────────────────────
  award         █████████████████···  83%
  deadline      ████████████████████ 100%
  disciplines   ██████████████████··  92%
  funder        █████████████████···  83%
  status        ████████████████████ 100%
  summary       ████████████████████ 100%
  ─────────────────────────────────────────────
  overall       ███████████████████·  93%

  pages: 6 graded · 1 hallucinated
```

Grading choices worth knowing. Funders are graded on identity rather than string
equality, so "NSF" scores against "National Science Foundation". Disciplines use
set F1, which rewards recall without letting a scattergun win. Award min and max
score separately, because reading the ceiling but missing the floor is a partial
success. Amounts pass within 1%. Summary prose is only checked for presence,
since grading its quality needs a judge model and pretending otherwise would be
dishonest arithmetic.

**What the eval found.** 93% flatters the baseline, because the interesting
failures are the ones a single number hides.

- **It cannot tell a directory from a call.** Given NSF's "Find Funding" index
  page at 1,500 characters, with no length gate to save it, the baseline
  confidently emits a record titled *Find Funding*. Nothing in a regex can
  separate "this page lists opportunities" from "this page is one".
- **It reads the programme budget as the award ceiling.** On the CISE fixture it
  returns `$250k to $95M`. That $95M is what NSF awards in total across roughly
  180 grants. Telling those apart means reading the sentence, not the number.
- **It gives up on funders it has not been told about.** `Unknown funder` on the
  Wellcome archive page, because the name appears in a form the pattern list does
  not carry.

Those three are the argument for the model's cost, stated as measurements. Run
`npm run eval` with a `GEMINI_API_KEY` set and the reports in `evals/reports/`
are directly diffable.

## Tests

```bash
npm test        # 52 tests
npm run typecheck
```

Covering JSON salvage (fences, prose, trailing commas, braces inside strings),
the repair loop against a scripted client, HTML normalisation, id and hash
stability, scoring behaviour at the deadline and confidence edges, and result
ordering. CI additionally runs the full pipeline on fixtures and asserts it stored
something coherent, so a refactor that quietly breaks extraction fails the build
rather than the next crawl.

## Known limits

- **Seven labelled pages is a smoke test, not a benchmark.** The harness is real.
  The sample is small enough that one page moves a field score by 17 points.
  Scaling to roughly 50 labelled live pages is next, and that is a labelling
  problem rather than an engineering one.
- **Summary quality is unmeasured.** The grader checks that a summary exists.
  Scoring whether it is accurate needs a judge model, which is the natural second
  use of the LLM budget.
- **Scoring has no learning signal.** Match weights are hand-set. Click-through or
  saved-opportunity data would let them be fitted rather than guessed.
- **Three sources.** The registry is built to grow. The crawl budget and the
  free-tier ceilings are what actually cap it.
- **Fixtures are synthetic.** They are written to exercise the edges: a closed
  archive, a rolling call, a two-date solicitation, an index page. They are not
  scraped from the funders. Real pages are messier, and the eval numbers will drop
  when they meet them.

## Stack

Next.js 16 · React · TypeScript (strict, `noUncheckedIndexedAccess`) ·
Tailwind v4 · Supabase (Postgres + RLS) · Zod · Playwright · Firecrawl · Exa ·
Gemini / Groq / OpenRouter · GitHub Actions · Vercel

---

Extracted data can be wrong. The UI shows extraction confidence and a link back
to the source page on every record, because a tool like this is only useful if it
tells you when to double-check it.
