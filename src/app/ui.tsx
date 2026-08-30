import type { Opportunity } from "@/lib/db/types";
import { formatMoney } from "@/lib/pipeline/match";

/** Days until a deadline, or null when there is no dated deadline. */
export function daysUntil(deadline: string | null, now = new Date()): number | null {
  if (!deadline) return null;
  return Math.ceil((Date.parse(deadline) - now.getTime()) / 864e5);
}

export function Deadline({ opp }: { opp: Opportunity }) {
  const days = daysUntil(opp.deadline);

  if (opp.status === "closed" || (days !== null && days < 0)) {
    return (
      <span className="nums text-sm" style={{ color: "var(--text-faint)" }}>
        Closed
      </span>
    );
  }
  if (opp.status === "rolling" || !opp.deadline) {
    return (
      <span className="nums text-sm" style={{ color: "var(--text-dim)" }}>
        Rolling
      </span>
    );
  }

  // Under a fortnight is the point where a researcher has to drop other work,
  // so that is where the colour changes — not at some arbitrary round number.
  const urgent = days !== null && days <= 14;
  return (
    <span
      className="nums text-sm font-medium"
      style={{ color: urgent ? "var(--color-urgent)" : "var(--text)" }}
      title={opp.deadline}
    >
      {days === 0 ? "Today" : `${days}d`}
    </span>
  );
}

export function StatusDot({ status }: { status: Opportunity["status"] }) {
  const color =
    status === "open"
      ? "var(--color-calm)"
      : status === "rolling"
        ? "var(--color-signal)"
        : status === "closed"
          ? "var(--text-faint)"
          : "var(--color-urgent)";
  return (
    <span
      aria-label={status}
      title={status}
      className="inline-block size-1.5 shrink-0 rounded-full"
      style={{ background: color }}
    />
  );
}

export function Award({ award }: { award: Opportunity["award"] }) {
  if (!award) return <span style={{ color: "var(--text-faint)" }}>—</span>;
  const { min, max, currency } = award;
  if (max !== null && min !== null && max !== min) {
    return (
      <span className="nums">
        {formatMoney(min, currency)}–{formatMoney(max, currency)}
      </span>
    );
  }
  const single = max ?? min;
  return <span className="nums">{single === null ? "—" : formatMoney(single, currency)}</span>;
}

/**
 * Confidence is shown on every row rather than hidden behind a threshold.
 * The pipeline already discards anything under 0.4; surfacing the rest tells a
 * reader how much to trust a row before they act on it.
 */
export function Confidence({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone =
    value >= 0.75 ? "var(--color-calm)" : value >= 0.55 ? "var(--color-signal)" : "var(--color-urgent)";
  return (
    <span className="inline-flex items-center gap-1.5" title={`extraction confidence ${pct}%`}>
      <span
        className="h-1 w-8 overflow-hidden rounded-full"
        style={{ background: "var(--border)" }}
      >
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: tone }} />
      </span>
      <span className="nums text-[11px]" style={{ color: "var(--text-faint)" }}>
        {pct}
      </span>
    </span>
  );
}

export function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[11px] leading-tight"
      style={{ background: "var(--color-signal-soft)", color: "var(--text-dim)" }}
    >
      {children}
    </span>
  );
}

export function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div
      className="rounded-lg border border-dashed px-6 py-14 text-center"
      style={{ borderColor: "var(--border)" }}
    >
      <p className="text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm" style={{ color: "var(--text-dim)" }}>
        {hint}
      </p>
    </div>
  );
}
