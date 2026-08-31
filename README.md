# Scout

Reads study records from ClinicalTrials.gov and Europe PMC, uses an LLM to work
out which population was actually recruited, and ranks health conditions by how
much evidence exists against how little of it reached South Asia.

**Live demo:** https://scout-dusky-seven.vercel.app

```
ClinicalTrials.gov ─┐
                    ├─▶ extract ──▶ dedupe ──▶ Supabase ──▶ gap analysis ──▶ dashboard
Europe PMC ─────────┘      │           │
                    schema-guided  content-hash
                    + self-repair  (skip unchanged)
                           │
                    full text via Firecrawl / Playwright
                    when a record omits its population
```

Runs nightly on GitHub Actions. Re-runs on demand through a signed webhook.

---

## Run it in 30 seconds, with no API keys

```bash
npm install && npm run ingest:fixtures && npm run dev
```

That is the real pipeline. Extraction, validation, dedupe, storage and gap
analysis, running against 149 **real** records captured from both APIs, with a
rule-based extractor and a local JSON store. No network, no keys, no spend.

The fixtures are captured rather than invented, which matters more than it
looks. Registry data is messy in specific ways: trials that never say where they
recruited, abstracts that name a country only in an author's address, missing
enrollment counts. Those are the cases the extractor has to get right and you
cannot imagine them accurately. Re-capture with `npm run capture`.

## Going live

Every layer promotes independently. Add a key and that layer switches. Add none
and it stays on the fallback.

| Layer | Fallback | Add this to promote it |
| --- | --- | --- |
| Storage | JSON file at `.data/store.json` | `NEXT_PUBLIC_SUPABASE_URL` + keys, after running [`schema.sql`](src/lib/db/schema.sql) |
| Extraction | rule-based heuristics | `GEMINI_API_KEY`, or Groq, or OpenRouter |
| Records | captured fixtures | nothing. Both APIs are public and free |
| Full text | skipped | `FIRECRAWL_API_KEY`, or `SCRAPE_PROVIDER=playwright` |

```bash
cp .env.example .env.local   # every entry is optional
npm run seed:store           # load the captured records into whatever store is configured
npm run ingest               # live registries + real model. Provider selection is automatic
```

`seed:store` exists because populating a database should not require spending
tokens. It runs the full pipeline against the captured records with the
rule-based extractor, so a fresh Supabase project gets 141 rows for nothing.

The running app shows which providers are live in its header, so a demo that
behaves oddly tells you why without opening a terminal.

## What it is measuring

Roughly 240 million people in Pakistan are close to absent from the datasets
that medicines and public-health policy are built on. Scout tries to say where
that absence is worst, per condition, from evidence rather than assertion.

**Every condition is queried twice.** Once broadly, and once restricted to South
Asian recruiting sites. The second pass is what surfaces regional work at all,
because a trial run in Karachi never out-ranks ten thousand trials run
elsewhere. It also means the corpus deliberately over-represents the region, so
the dashboard states plainly that its percentages describe the sample and are
not an estimate of the literature. Reporting them as prevalence would be wrong,
and the people this is built for would spot it immediately.

**"Did not report" is never counted as "not represented".** A record that never
said who was enrolled and a record that recruited entirely in Denmark are
opposite findings. Collapsing them manufactures a gap the evidence never showed.
Unreported records are excluded from the coverage ratio and surfaced as their
own number. When nothing in a condition reported, the gap score is zero rather
than maximum, because an absence that was never measured is not a finding.

**Author affiliation is not participant recruitment.** A trial run entirely in
Denmark by an author based in Karachi recruited in Denmark. The prompt says so
explicitly, since a model that reads affiliations as populations inverts the
entire analysis.

## How it works

**One Zod schema, three jobs.** [`ExtractedStudy`](src/lib/db/types.ts) is
injected into the prompt as the target shape, validates the response before
anything reaches the database, and types the UI. Change it and `tsc` finds every
gap.

**Bad output gets repaired, not discarded.** The failure that matters is not a
refusal. It is confident JSON that breaks the contract: a year as `"recent"`, a
representation value that is not one of the four, a missing field. Zod catches
that at the boundary, and [`extract.ts`](src/lib/llm/extract.ts) hands the model
its own output plus the specific validation errors and asks for a correction.
One repair turn recovers most failures, which matters on a free tier. Before
that, [`json.ts`](src/lib/llm/json.ts) salvages fenced, prose-wrapped and
trailing-comma output without spending a second call.

**Unchanged records never reach the model.** Content is hashed with whitespace
and clock stamps normalised out ([`ids.ts`](src/lib/pipeline/ids.ts)). A nightly
re-run over a stable corpus spends nothing. This is the single largest cost
saving in the pipeline.

**Discovery by API, enrichment by scraper.** Both registries offer public APIs,
so that is how they are read: structured, and nothing to break when a site is
redesigned. Scraping still has a job, a different one. Registry records are
often thin about who was enrolled and the detail sits in the linked full text,
so those records are marked and fetched with Firecrawl or Playwright before
extraction.

**Gap scoring is arithmetic, not a model.** A number that decides where a
research organisation spends a year of fieldwork has to be defensible line by
line, so every input in [`gaps.ts`](src/lib/pipeline/gaps.ts) is a count someone
can recheck against the rows. A partial cohort counts for half, stated in the
code rather than buried, because being 4% of a European trial is not the same as
being the population it was powered for.

**Both stores share one comparator.** Having the JSON store and Supabase
disagree about row order is the kind of bug that only shows up in a demo, so
both fetch and then sort through [`ordering.ts`](src/lib/db/ordering.ts).

## Background jobs and webhooks

| Trigger | Path | Auth | Does |
| --- | --- | --- | --- |
| Nightly | [`ingest.yml`](.github/workflows/ingest.yml) | repo secrets | Full run, Chromium available, no time cap |
| Daily | `GET /api/cron/ingest` | `Bearer $CRON_SECRET` | Bounded slice within the 60s function limit |
| On demand | `POST /api/webhooks/refresh` | HMAC-SHA256 | Targeted re-run |

The heavy work runs in GitHub Actions because a serverless function is the wrong
place for a multi-source crawl. Both paths call the same `runIngest`, so there is
one code path to reason about.

The webhook signs `"<timestamp>.<raw body>"`, compares in constant time, and
rejects anything more than five minutes old. The timestamp sits *inside* the
signed payload, so a captured request cannot be replayed with a fresh one.

```bash
BODY='{"conditions":["tuberculosis"],"force":true}'
TS=$(date +%s000)
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -hex | sed 's/^.* //')
curl -X POST localhost:3000/api/webhooks/refresh \
  -H "x-scout-timestamp: $TS" -H "x-scout-signature: sha256=$SIG" \
  -H 'content-type: application/json' -d "$BODY"
```

## Evaluation

`npm run eval` scores an extractor against
[hand-labelled records](evals/labels.json), field by field, so "the model beats
the baseline" becomes a number rather than a claim. Both extractors see the same
records and the same grader, and the eval imports the pipeline's own accept
thresholds instead of restating them, because an eval that grades a different
accept path measures a system nobody is running.

Three runs, in the order they happened. The story between them is more useful
than any single number.

**1. The rule-based baseline** (`npm run eval:baseline`, no API key):

```
  field           score
  ───────────────────────────────────────────────
  condition       ██████████████████··  92%
  countries       ████████████████····  78%
  representation  ███████████████·····  77%
  sample_size     ████████████████████ 100%
  study_type      ██████████████████··  92%
  year            ████████████████████ 100%
  ───────────────────────────────────────────────
  overall         ██████████████████··  90%

  clinicaltrials  overall  98% · representation 100%
  europepmc       overall  70% · representation  25%
```

**That per-source split is the first finding, and 90% hides it.** Where
recruitment countries arrive in a labelled field, pattern matching is close to
perfect. Where the population exists only in prose, it gets the field that
matters right one time in four.

**2. Gemini 3.5 Flash, first attempt:** 96% overall. Europe PMC went from 70% to
95%, exactly as expected. But representation did not move at all, still 77%, and
all three misses had the same shape:

```
  clinicaltrials/NCT06186102   countries: Denmark        ✓
                               representation: unclear   ✗  (should be none)
  clinicaltrials/NCT01947595   countries: Germany        ✓
                               representation: unclear   ✗  (should be none)
  europepmc/42573997           countries: United States  ✓
                               representation: unclear   ✗  (should be none)
```

The model read every country correctly, including inferring the United States
from *Medicare* and *44 states*, then refused to conclude anything from it.
That is not a reading failure. The prompt defined `unclear` as "the record does
not say who was enrolled" and never said that naming a recruiting country
answers that question. **The eval found a bug in the prompt, not in the model.**

**3. After making representation mechanical** (decide it from the countries
already extracted, with the two ambiguous cases spelled out):

```
  field           score
  ───────────────────────────────────────────────
  condition       ████████████████████ 100%
  countries       ████████████████████ 100%
  representation  ████████████████████ 100%
  sample_size     ████████████████████ 100%
  study_type      ████████████████████ 100%
  year            ████████████████████ 100%
  ───────────────────────────────────────────────
  overall         ████████████████████ 100%

  12 of 13 records graded · 1 request timed out
  model: gemini-flash-lite-latest
```

**Read that last line before reading the score.** Both stronger models in the
chain were returning 503 at the time, so this was the *cheapest* model
available, and once the definition was unambiguous it got every field right.
The prompt was worth more than the model.

### What these numbers do not mean

100% on twelve records does not mean extraction is solved. It means **the eval
has stopped being informative and needs harder cases.** Thirteen labelled
records was always a smoke test. The honest reading is that the obvious failure
modes are fixed and the next one has not been found yet, which is a reason to
grow the label set rather than to celebrate.

The timeout matters too: one record never got an answer, and a run that scores
100% on what it managed to grade is not the same as a run that graded
everything.

Error direction is tracked separately, because the two are not equally bad.
Calling a silent record a measured absence invents a gap; the reverse merely
declines to assert one. Both extractors err in the conservative direction.

Reports land in `evals/reports/<provider>.json` and are directly diffable.

## Tests

```bash
npm test        # 73 tests
npm run typecheck
```

Covering JSON salvage (fences, prose, trailing commas, braces inside strings),
the repair loop against a scripted client, the gap arithmetic at its edges, the
unclear/none split, id and hash stability, condition normalisation, and result
ordering. Two of these exist because they caught real bugs: the gap score used
to return maximum when nothing had reported, and the dashboard used to label
conditions with their alphabetised sort key ("2 diabetes type").

## Known limits

- **Thirteen labelled records is a smoke test, not a benchmark.** One record
  moves a field score by 8 points, and the current extractor scores 100% on
  them, which means the set has stopped finding failures. Growing it is the next
  thing worth doing and it is a labelling problem, not an engineering one.
- **The condition taxonomy is string normalisation, not ontology.** It folds
  "Diabetes Mellitus, Type 2" into "type 2 diabetes", and it does not know that
  "pulmonary tuberculosis" is a kind of tuberculosis. Mapping to MeSH or SNOMED
  is the real answer.
- **The rule-based baseline fragments conditions badly.** With no labelled field
  to read, it takes a paper's title as its condition, producing a long tail of
  conditions seen once. The dashboard excludes those from the ranking and says
  how many it excluded.
- **Sample sizes are as reported.** No attempt is made to reconcile a registry's
  planned enrollment with what a paper says was analysed.
- **Two sources.** WHO ICTRP and the national registries would widen it
  considerably; the source interface is built for it. The more interesting
  addition is neural search over work published in regional journals that
  neither API indexes, which is exactly the material most likely to be missing
  from a coverage estimate built only from PubMed.

## Stack

Next.js 16 · React · TypeScript (strict, `noUncheckedIndexedAccess`) ·
Tailwind v4 · Supabase (Postgres + RLS) · Zod · Playwright · Firecrawl ·
Gemini / Groq / OpenRouter · GitHub Actions · Vercel

---

Every field on the dashboard was extracted from a source record by a language
model and may be wrong. Each study links back to the record it came from, and
extraction confidence is shown on every row, because a tool like this is only
useful if it tells you when to check it.
