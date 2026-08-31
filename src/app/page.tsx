import Link from "next/link";
import { getRepo } from "@/lib/db";
import { explainGap } from "@/lib/pipeline/gaps";
import { Empty, GapBar } from "./ui";

// Always reflect the latest ingest rather than a build-time snapshot.
export const dynamic = "force-dynamic";

export default async function Home() {
  const repo = await getRepo();
  const [allGaps, studies] = await Promise.all([
    repo.listGaps(500),
    repo.listStudies({ limit: 2000 }),
  ]);

  // A condition seen once is a naming artefact more often than a finding: the
  // extractor read a paper title as a condition, or spelled one two ways. They
  // are kept in the data and counted here, but ranking them next to a condition
  // with real evidence behind it would be misleading.
  const gaps = allGaps.filter((g) => g.total_studies > 1);
  const singletons = allGaps.length - gaps.length;

  const totals = studies.reduce(
    (acc, s) => {
      acc[s.representation]++;
      return acc;
    },
    { primary: 0, partial: 0, none: 0, unclear: 0 },
  );

  const reached = totals.primary + totals.partial;
  const known = studies.length - totals.unclear;

  return (
    <div className="space-y-8">
      <header className="max-w-2xl space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Where the evidence does not reach</h1>
        <p className="text-sm leading-relaxed" style={{ color: "var(--text-dim)" }}>
          Studies from ClinicalTrials.gov and Europe PMC, read by a language model to work out
          which population was actually recruited. Conditions are ranked by how much evidence
          exists against how little of it reached South Asian populations.
        </p>
        {/* Stated up front rather than in a footnote. Every number below is a
            proportion of a deliberately biased sample, and a research
            organisation reading this will ask within ten seconds. */}
        <p
          className="rounded-md border-l-2 py-1 pl-3 text-xs leading-relaxed"
          style={{ borderColor: "var(--color-urgent)", color: "var(--text-faint)" }}
        >
          <strong style={{ color: "var(--text-dim)" }}>Read these as sample proportions, not
          prevalence.</strong>{" "}
          Each condition is queried twice, once broadly and once restricted to South Asian
          recruiting sites. That second pass is what surfaces regional work at all, since a trial
          in Karachi never out-ranks ten thousand trials run elsewhere. It also means the corpus
          deliberately over-represents the region, so the percentages here describe what was
          sampled and are not an estimate of the literature.
        </p>
      </header>

      {studies.length === 0 ? (
        <Empty
          title="Nothing ingested yet"
          hint="No studies in this store yet. Run `npm run seed:store` to load the captured records for free, or `npm run ingest` with a GEMINI_API_KEY to pull live ones."
        />
      ) : (
        <>
          <dl
            className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border sm:grid-cols-4"
            style={{ borderColor: "var(--border)", background: "var(--border)" }}
          >
            <Stat label="Studies read" value={studies.length.toLocaleString()} />
            <Stat
              label="Conditions"
              value={String(gaps.length)}
              note={singletons > 0 ? `${singletons} seen once, not ranked` : undefined}
            />
            <Stat
              label="Reached the region"
              value={known > 0 ? `${Math.round((reached / known) * 100)}%` : "n/a"}
              note={known > 0 ? `${reached} of ${known} in this sample` : undefined}
            />
            <Stat
              label="Did not report"
              value={String(totals.unclear)}
              note="excluded from the ratio"
            />
          </dl>

          <section className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">Conditions by evidence gap</h2>
              <Link
                href="/studies"
                className="text-sm hover:underline underline-offset-4"
                style={{ color: "var(--text-dim)" }}
              >
                All studies →
              </Link>
            </div>

            <ul className="space-y-2">
              {gaps.map((gap) => (
                <li
                  key={gap.condition}
                  className="rounded-lg border p-4"
                  style={{ borderColor: "var(--border)", background: "var(--surface)" }}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <Link
                      href={`/studies?condition=${encodeURIComponent(gap.condition)}`}
                      className="font-medium capitalize hover:underline underline-offset-2"
                    >
                      {gap.condition}
                    </Link>
                    <span className="nums text-sm font-medium" title="gap score, 0 to 1">
                      {gap.gap_score.toFixed(2)}
                    </span>
                  </div>

                  <div className="mt-2">
                    <GapBar
                      primary={gap.primary_count}
                      partial={gap.partial_count}
                      none={gap.none_count}
                      unclear={gap.unclear_count}
                    />
                  </div>

                  <ul className="mt-2 space-y-0.5 text-xs" style={{ color: "var(--text-dim)" }}>
                    {explainGap(gap).map((reason) => (
                      <li key={reason}>· {reason}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </section>

          <div
            className="max-w-2xl space-y-2 text-xs leading-relaxed"
            style={{ color: "var(--text-faint)" }}
          >
            <p>
              The gap score weights how much evidence exists against how little of it reached the
              region. Records that never said who was enrolled are excluded from that ratio rather
              than counted as absent, because a reporting failure and a measured absence are
              different findings and only one of them is a gap.
            </p>
            {singletons > 0 && (
              <p>
                {singletons} condition{singletons === 1 ? " was" : "s were"} seen only once and
                {singletons === 1 ? " is" : " are"} not ranked above. Most are the extractor
                spelling one condition two ways, which is the clearest thing that improves when
                the rule-based baseline is swapped for a language model.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="px-4 py-3" style={{ background: "var(--surface)" }}>
      <dt className="text-[11px] uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>
        {label}
      </dt>
      <dd className="nums mt-1 text-xl font-semibold">{value}</dd>
      {note && (
        <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-faint)" }}>
          {note}
        </p>
      )}
    </div>
  );
}
