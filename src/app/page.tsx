import Link from "next/link";
import { getRepo } from "@/lib/db";
import type { Match } from "@/lib/db/types";
import { SOURCES } from "@/lib/pipeline/sources";
import { Award, Confidence, Deadline, Empty, StatusDot, Tag } from "./ui";

// Always reflect the latest ingest rather than a build-time snapshot.
export const dynamic = "force-dynamic";

type Search = {
  q?: string;
  source?: string;
  status?: string;
  discipline?: string;
  profile?: string;
};

export default async function Home({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const repo = await getRepo();

  const [opportunities, profiles] = await Promise.all([
    repo.listOpportunities({
      q: params.q,
      source: params.source,
      status: params.status,
      discipline: params.discipline,
      limit: 200,
    }),
    repo.listProfiles(),
  ]);

  // When a profile is selected the list is re-ordered by relevance rather than
  // by deadline, because "what should I apply for" beats "what closes soonest".
  const activeProfile = params.profile ? profiles.find((p) => p.id === params.profile) : undefined;
  const matches: Map<string, Match> = new Map();
  if (activeProfile) {
    for (const m of await repo.listMatches(activeProfile.id, 500)) {
      matches.set(m.opportunity_id, m);
    }
  }

  const rows = activeProfile
    ? [...opportunities].sort(
        (a, b) => (matches.get(b.id)?.score ?? 0) - (matches.get(a.id)?.score ?? 0),
      )
    : opportunities;

  const disciplines = [...new Set(opportunities.flatMap((o) => o.disciplines))].sort();
  const openCount = rows.filter((o) => o.status === "open" || o.status === "rolling").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Funding opportunities</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-dim)" }}>
            {rows.length} extracted · {openCount} accepting applications
            {activeProfile ? ` · ranked for ${activeProfile.name}` : ""}
          </p>
        </div>
      </div>

      <Filters
        params={params}
        disciplines={disciplines}
        profiles={profiles.map((p) => ({ id: p.id, name: p.name }))}
      />

      {rows.length === 0 ? (
        <Empty
          title="Nothing here yet"
          hint="Run `npm run ingest:fixtures` to populate the store from bundled sample pages, or add API keys to .env.local and run `npm run ingest`."
        />
      ) : (
        <div
          className="overflow-hidden rounded-lg border"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <table className="w-full text-left text-sm">
            <thead>
              <tr
                className="border-b text-[11px] uppercase tracking-wide"
                style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}
              >
                <th className="px-4 py-2.5 font-medium">Opportunity</th>
                <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Award</th>
                <th className="px-4 py-2.5 font-medium">Closes</th>
                <th className="hidden px-4 py-2.5 font-medium md:table-cell">
                  {activeProfile ? "Match" : "Confidence"}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const match = matches.get(o.id);
                return (
                  <tr
                    key={o.id}
                    className="border-b last:border-0 transition-colors hover:bg-black/[0.025] dark:hover:bg-white/[0.03]"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <td className="px-4 py-3 align-top">
                      <div className="flex items-start gap-2">
                        <span className="mt-1.5">
                          <StatusDot status={o.status} />
                        </span>
                        <div className="min-w-0">
                          <Link
                            href={`/opportunities/${o.id}`}
                            className="font-medium hover:underline underline-offset-2"
                          >
                            {o.title}
                          </Link>
                          <div
                            className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
                            style={{ color: "var(--text-dim)" }}
                          >
                            <span>{o.funder}</span>
                            {o.disciplines.slice(0, 3).map((d) => (
                              <Tag key={d}>{d}</Tag>
                            ))}
                          </div>
                          {match && match.reasons.length > 0 && (
                            <p className="mt-1 text-xs" style={{ color: "var(--text-faint)" }}>
                              {match.reasons.slice(0, 2).join(" · ")}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 align-top sm:table-cell">
                      <Award award={o.award} />
                    </td>
                    <td className="px-4 py-3 align-top">
                      <Deadline opp={o} />
                    </td>
                    <td className="hidden px-4 py-3 align-top md:table-cell">
                      {match ? (
                        <span className="nums font-medium">{Math.round(match.score * 100)}%</span>
                      ) : (
                        <Confidence value={o.confidence} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * A plain GET form. No client JS, no state library: filters live in the URL,
 * so every view is linkable, back/forward works, and the page still renders
 * with scripting disabled.
 */
function Filters({
  params,
  disciplines,
  profiles,
}: {
  params: Search;
  disciplines: string[];
  profiles: { id: string; name: string }[];
}) {
  const field = "rounded-md border px-2.5 py-1.5 text-sm";
  const style = { borderColor: "var(--border)", background: "var(--surface)", color: "var(--text)" };

  return (
    <form className="flex flex-wrap items-center gap-2">
      <input
        name="q"
        defaultValue={params.q ?? ""}
        placeholder="Search title, funder, summary…"
        className={`${field} min-w-52 flex-1`}
        style={style}
        aria-label="Search opportunities"
      />
      <select name="source" defaultValue={params.source ?? ""} className={field} style={style} aria-label="Source">
        <option value="">All sources</option>
        {SOURCES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <select name="status" defaultValue={params.status ?? ""} className={field} style={style} aria-label="Status">
        <option value="">Any status</option>
        <option value="open">Open</option>
        <option value="rolling">Rolling</option>
        <option value="closed">Closed</option>
      </select>
      <select
        name="discipline"
        defaultValue={params.discipline ?? ""}
        className={field}
        style={style}
        aria-label="Discipline"
      >
        <option value="">Any discipline</option>
        {disciplines.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      <select name="profile" defaultValue={params.profile ?? ""} className={field} style={style} aria-label="Rank for profile">
        <option value="">No ranking</option>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            Rank for {p.name}
          </option>
        ))}
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
