import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepo } from "@/lib/db";
import { scoreOpportunity } from "@/lib/pipeline/match";
import { sourceById } from "@/lib/pipeline/sources";
import { Award, Confidence, Deadline, StatusDot, Tag } from "../../ui";

export const dynamic = "force-dynamic";

export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repo = await getRepo();
  const opp = await repo.getOpportunity(id);
  if (!opp) notFound();

  const profiles = await repo.listProfiles();
  const scored = profiles
    .map((p) => ({ profile: p, ...scoreOpportunity(opp, p) }))
    .sort((a, b) => b.score - a.score);

  return (
    <article className="space-y-8">
      <div>
        <Link
          href="/"
          className="text-sm hover:underline underline-offset-4"
          style={{ color: "var(--text-dim)" }}
        >
          ← All opportunities
        </Link>

        <div className="mt-3 flex items-start gap-2.5">
          <span className="mt-2.5">
            <StatusDot status={opp.status} />
          </span>
          <h1 className="text-2xl font-semibold leading-tight tracking-tight">{opp.title}</h1>
        </div>

        <p className="mt-2 text-sm" style={{ color: "var(--text-dim)" }}>
          {opp.funder}
          {opp.programme ? ` · ${opp.programme}` : ""} ·{" "}
          {sourceById(opp.source)?.label ?? opp.source}
        </p>
      </div>

      <dl
        className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border sm:grid-cols-4"
        style={{ borderColor: "var(--border)", background: "var(--border)" }}
      >
        <Cell label="Closes">
          <Deadline opp={opp} />
          {opp.deadline && (
            <span className="nums ml-1.5 text-xs" style={{ color: "var(--text-faint)" }}>
              {opp.deadline}
            </span>
          )}
        </Cell>
        <Cell label="Award">
          <Award award={opp.award} />
        </Cell>
        <Cell label="Status">
          <span className="capitalize">{opp.status}</span>
        </Cell>
        <Cell label="Confidence">
          <Confidence value={opp.confidence} />
        </Cell>
      </dl>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Summary</h2>
        <p className="max-w-2xl text-[15px] leading-relaxed" style={{ color: "var(--text-dim)" }}>
          {opp.summary}
        </p>
      </section>

      {opp.disciplines.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Disciplines</h2>
          <div className="flex flex-wrap gap-1.5">
            {opp.disciplines.map((d) => (
              <Tag key={d}>{d}</Tag>
            ))}
          </div>
        </section>
      )}

      {opp.eligibility && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Eligibility</h2>
          <p className="max-w-2xl text-[15px] leading-relaxed" style={{ color: "var(--text-dim)" }}>
            {opp.eligibility}
          </p>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Fit by profile</h2>
        <ul className="space-y-2">
          {scored.map(({ profile, score, reasons }) => (
            <li
              key={profile.id}
              className="rounded-lg border p-3"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{profile.name}</span>
                <span className="nums text-sm">{Math.round(score * 100)}%</span>
              </div>
              <ul className="mt-1.5 space-y-0.5 text-xs" style={{ color: "var(--text-dim)" }}>
                {reasons.length === 0 ? (
                  <li>No overlap with this profile.</li>
                ) : (
                  reasons.map((r) => <li key={r}>· {r}</li>)
                )}
              </ul>
            </li>
          ))}
        </ul>
      </section>

      {/* Provenance. Anything extracted by a model needs a path back to the
          page it came from, or a researcher cannot act on it. */}
      <section
        className="space-y-1.5 border-t pt-5 text-xs"
        style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}
      >
        <h2 className="font-semibold" style={{ color: "var(--text-dim)" }}>
          Provenance
        </h2>
        <p>
          Source:{" "}
          {opp.source_url.startsWith("http") ? (
            <a
              href={opp.source_url}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2"
            >
              {opp.source_url}
            </a>
          ) : (
            <span className="font-mono">{opp.source_url}</span>
          )}
        </p>
        <p className="font-mono">
          extracted by {opp.extracted_by} · first seen {opp.first_seen_at.slice(0, 10)} · last seen{" "}
          {opp.last_seen_at.slice(0, 10)}
        </p>
      </section>
    </article>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3" style={{ background: "var(--surface)" }}>
      <dt className="text-[11px] uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>
        {label}
      </dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  );
}
