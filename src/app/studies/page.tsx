import Link from "next/link";
import { getRepo } from "@/lib/db";
import { SOURCES } from "@/lib/pipeline/sources";
import { Confidence, Empty, RepresentationBadge, RepresentationDot, SampleSize } from "../ui";

export const dynamic = "force-dynamic";

type Search = {
  q?: string;
  source?: string;
  condition?: string;
  representation?: string;
  studyType?: string;
};

export default async function StudiesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const repo = await getRepo();

  const studies = await repo.listStudies({
    q: params.q,
    source: params.source,
    condition: params.condition,
    representation: params.representation,
    studyType: params.studyType,
    limit: 300,
  });

  const conditions = [...new Set(studies.map((s) => s.condition))].sort();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href="/"
            className="text-sm hover:underline underline-offset-4"
            style={{ color: "var(--text-dim)" }}
          >
            ← Evidence gaps
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Studies</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-dim)" }}>
            {studies.length} record{studies.length === 1 ? "" : "s"}
            {params.condition ? ` for ${params.condition}` : ""}
          </p>
        </div>
      </div>

      <Filters params={params} conditions={conditions} />

      {studies.length === 0 ? (
        <Empty
          title="No studies match"
          hint="Clear the filters, or run `npm run ingest:fixtures` if the store is empty."
        />
      ) : (
        <div
          className="overflow-x-auto rounded-lg border"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead>
              <tr
                className="border-b text-[11px] uppercase tracking-wide"
                style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}
              >
                <th className="px-4 py-2.5 font-medium">Study</th>
                <th className="px-4 py-2.5 font-medium">Population</th>
                <th className="px-4 py-2.5 text-right font-medium">n</th>
                <th className="px-4 py-2.5 font-medium">Year</th>
                <th className="hidden px-4 py-2.5 font-medium md:table-cell">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {studies.map((s) => (
                <tr
                  key={s.id}
                  className="border-b last:border-0 align-top transition-colors hover:bg-black/[0.025] dark:hover:bg-white/[0.03]"
                  style={{ borderColor: "var(--border)" }}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-start gap-2">
                      <span className="mt-1.5">
                        <RepresentationDot value={s.representation} />
                      </span>
                      <div className="min-w-0 max-w-xl">
                        <Link
                          href={`/studies/${s.id}`}
                          className="font-medium hover:underline underline-offset-2"
                        >
                          {s.title}
                        </Link>
                        <div
                          className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
                          style={{ color: "var(--text-dim)" }}
                        >
                          <span className="capitalize">{s.condition}</span>
                          <span>·</span>
                          <span>{s.study_type}</span>
                          <span>·</span>
                          <span className="font-mono text-[11px]">{s.source_ref}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <RepresentationBadge value={s.representation} />
                    {s.countries.length > 0 && (
                      <p className="mt-1 max-w-48 text-xs" style={{ color: "var(--text-faint)" }}>
                        {s.countries.slice(0, 4).join(", ")}
                        {s.countries.length > 4 ? ` +${s.countries.length - 4}` : ""}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <SampleSize n={s.sample_size} />
                  </td>
                  <td className="nums px-4 py-3">{s.year ?? "—"}</td>
                  <td className="hidden px-4 py-3 md:table-cell">
                    <Confidence value={s.confidence} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * A plain GET form. No client JS, no state library: filters live in the URL, so
 * every view is linkable, back and forward work, and the page still renders
 * with scripting disabled.
 */
function Filters({ params, conditions }: { params: Search; conditions: string[] }) {
  const field = "rounded-md border px-2.5 py-1.5 text-sm";
  const style = { borderColor: "var(--border)", background: "var(--surface)", color: "var(--text)" };

  return (
    <form className="flex flex-wrap items-center gap-2">
      <input
        name="q"
        defaultValue={params.q ?? ""}
        placeholder="Search title, condition, population…"
        className={`${field} min-w-52 flex-1`}
        style={style}
        aria-label="Search studies"
      />
      <select name="source" defaultValue={params.source ?? ""} className={field} style={style} aria-label="Source">
        <option value="">All sources</option>
        {SOURCES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <select
        name="condition"
        defaultValue={params.condition ?? ""}
        className={field}
        style={style}
        aria-label="Condition"
      >
        <option value="">Any condition</option>
        {conditions.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <select
        name="representation"
        defaultValue={params.representation ?? ""}
        className={field}
        style={style}
        aria-label="Representation"
      >
        <option value="">Any population</option>
        <option value="primary">Primary</option>
        <option value="partial">Partial</option>
        <option value="none">Not represented</option>
        <option value="unclear">Not reported</option>
      </select>
      <select
        name="studyType"
        defaultValue={params.studyType ?? ""}
        className={field}
        style={style}
        aria-label="Study type"
      >
        <option value="">Any type</option>
        <option value="interventional">Interventional</option>
        <option value="observational">Observational</option>
        <option value="review">Review</option>
        <option value="case-report">Case report</option>
        <option value="other">Other</option>
      </select>
      <button
        type="submit"
        className="rounded-md px-3 py-1.5 text-sm font-medium text-white"
        style={{ background: "var(--color-signal)" }}
      >
        Apply
      </button>
    </form>
  );
}
