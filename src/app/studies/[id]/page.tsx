import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepo } from "@/lib/db";
import { sourceById } from "@/lib/pipeline/sources";
import { Confidence, RepresentationBadge, SampleSize, Tag } from "../../ui";

export const dynamic = "force-dynamic";

export default async function StudyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repo = await getRepo();
  const study = await repo.getStudy(id);
  if (!study) notFound();

  return (
    <article className="space-y-8">
      <div>
        <Link
          href="/studies"
          className="text-sm hover:underline underline-offset-4"
          style={{ color: "var(--text-dim)" }}
        >
          ← All studies
        </Link>

        <h1 className="mt-3 max-w-3xl text-2xl font-semibold leading-tight tracking-tight">
          {study.title}
        </h1>

        <p className="mt-2 text-sm capitalize" style={{ color: "var(--text-dim)" }}>
          {study.condition} · <span className="lowercase">{study.study_type}</span>
        </p>

        {study.intervention && (
          // Registries list every measurement here, so this runs to hundreds of
          // characters. Clamped rather than truncated, so nothing is lost.
          <p
            className="mt-1 line-clamp-2 max-w-3xl text-sm"
            style={{ color: "var(--text-faint)" }}
            title={study.intervention}
          >
            {study.intervention}
          </p>
        )}
      </div>

      <dl
        className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border sm:grid-cols-4"
        style={{ borderColor: "var(--border)", background: "var(--border)" }}
      >
        <Cell label="Representation">
          <RepresentationBadge value={study.representation} />
        </Cell>
        <Cell label="Participants">
          <SampleSize n={study.sample_size} />
        </Cell>
        <Cell label="Year">
          <span className="nums">{study.year ?? "—"}</span>
        </Cell>
        <Cell label="Confidence">
          <Confidence value={study.confidence} />
        </Cell>
      </dl>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Population</h2>
        <p className="max-w-2xl text-[15px] leading-relaxed" style={{ color: "var(--text-dim)" }}>
          {study.population_note}
        </p>
        {study.countries.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {study.countries.map((c) => (
              <Tag key={c}>{c}</Tag>
            ))}
          </div>
        ) : (
          <p className="text-xs" style={{ color: "var(--text-faint)" }}>
            No recruitment countries stated in the source. This record counts as &ldquo;not
            reported&rdquo;, which is kept separate from a study that recruited elsewhere.
          </p>
        )}
      </section>

      {/* Provenance. Anything a model extracted needs a path back to the record
          it came from, or nobody can act on it. */}
      <section
        className="space-y-1.5 border-t pt-5 text-xs"
        style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}
      >
        <h2 className="font-semibold" style={{ color: "var(--text-dim)" }}>
          Provenance
        </h2>
        <p>
          {sourceById(study.source)?.label ?? study.source} ·{" "}
          <a
            href={study.source_url}
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2"
          >
            {study.source_ref}
          </a>
        </p>
        <p className="font-mono">
          extracted by {study.extracted_by}
          {study.enriched ? " · full text fetched" : ""} · first seen{" "}
          {study.first_seen_at.slice(0, 10)} · last seen {study.last_seen_at.slice(0, 10)}
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
