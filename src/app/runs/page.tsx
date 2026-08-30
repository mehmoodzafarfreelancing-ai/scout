import { getRepo } from "@/lib/db";
import { Empty } from "../ui";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const repo = await getRepo();
  const runs = await repo.listRuns(30);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ingest runs</h1>
        <p className="mt-1 max-w-2xl text-sm" style={{ color: "var(--text-dim)" }}>
          Every crawl is recorded with the providers it used and what it did with each page. When a
          funder redesigns their site the rejection count moves first, which is the signal that a
          source adapter needs attention.
        </p>
      </div>

      {runs.length === 0 ? (
        <Empty
          title="No runs recorded"
          hint="Trigger one with `npm run ingest:fixtures`, or POST to /api/webhooks/refresh with a valid signature."
        />
      ) : (
        <div
          className="overflow-x-auto rounded-lg border"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <table className="w-full min-w-[46rem] text-left text-sm">
            <thead>
              <tr
                className="border-b text-[11px] uppercase tracking-wide"
                style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}
              >
                <th className="px-4 py-2.5 font-medium">Started</th>
                <th className="px-4 py-2.5 font-medium">Trigger</th>
                <th className="px-4 py-2.5 font-medium">Providers</th>
                <th className="px-4 py-2.5 text-right font-medium">Fetched</th>
                <th className="px-4 py-2.5 text-right font-medium">Skipped</th>
                <th className="px-4 py-2.5 text-right font-medium">Extracted</th>
                <th className="px-4 py-2.5 text-right font-medium">Rejected</th>
                <th className="px-4 py-2.5 text-right font-medium">Took</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const seconds = r.finished_at
                  ? (Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000
                  : null;
                return (
                  <tr
                    key={r.id}
                    className="border-b last:border-0 align-top"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <td className="nums px-4 py-3 whitespace-nowrap">
                      {r.started_at.slice(0, 16).replace("T", " ")}
                    </td>
                    <td className="px-4 py-3">{r.trigger}</td>
                    <td className="px-4 py-3 font-mono text-xs" style={{ color: "var(--text-dim)" }}>
                      {r.scrape_provider}
                      <br />
                      {r.llm_provider}
                    </td>
                    <td className="nums px-4 py-3 text-right">{r.pages_fetched}</td>
                    <td className="nums px-4 py-3 text-right" style={{ color: "var(--text-dim)" }}>
                      {r.pages_skipped}
                    </td>
                    <td className="nums px-4 py-3 text-right font-medium">{r.extracted}</td>
                    <td
                      className="nums px-4 py-3 text-right"
                      style={{ color: r.rejected > 0 ? "var(--color-urgent)" : "var(--text-dim)" }}
                      title={r.errors.slice(0, 5).join("\n") || undefined}
                    >
                      {r.rejected}
                    </td>
                    <td className="nums px-4 py-3 text-right" style={{ color: "var(--text-dim)" }}>
                      {seconds === null ? "running…" : `${seconds.toFixed(1)}s`}
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
