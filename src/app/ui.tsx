import type { Representation, Study } from "@/lib/db/types";

/**
 * Representation is the field the whole product turns on, so it gets a
 * consistent colour everywhere it appears. "unclear" is deliberately given its
 * own neutral treatment rather than being shaded like "none": they are opposite
 * findings and the UI must never let a reader conflate them.
 */
const REPRESENTATION: Record<Representation, { label: string; color: string; bg: string }> = {
  primary: { label: "Primary", color: "var(--color-calm)", bg: "var(--color-calm-soft)" },
  partial: { label: "Partial", color: "var(--color-signal)", bg: "var(--color-signal-soft)" },
  none: { label: "Not represented", color: "var(--color-urgent)", bg: "var(--color-urgent-soft)" },
  unclear: { label: "Not reported", color: "var(--text-faint)", bg: "transparent" },
};

export function RepresentationBadge({ value }: { value: Representation }) {
  const tone = REPRESENTATION[value];
  return (
    <span
      className="inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium leading-tight"
      style={{
        color: tone.color,
        background: tone.bg,
        border: value === "unclear" ? "1px solid var(--border)" : "none",
      }}
      title={
        value === "unclear"
          ? "The source does not say where participants were recruited. Not the same as a study that excluded the region."
          : undefined
      }
    >
      {tone.label}
    </span>
  );
}

export function RepresentationDot({ value }: { value: Representation }) {
  return (
    <span
      aria-label={REPRESENTATION[value].label}
      title={REPRESENTATION[value].label}
      className="inline-block size-1.5 shrink-0 rounded-full"
      style={{
        background: value === "unclear" ? "var(--border)" : REPRESENTATION[value].color,
      }}
    />
  );
}

/**
 * A stacked bar of the four representation states for one condition.
 *
 * A single percentage would hide the distinction the product exists to make, so
 * every segment is shown, including the "not reported" one.
 */
export function GapBar({
  primary,
  partial,
  none,
  unclear,
}: {
  primary: number;
  partial: number;
  none: number;
  unclear: number;
}) {
  const total = primary + partial + none + unclear;
  if (total === 0) return null;

  const segments = [
    { n: primary, color: "var(--color-calm)", label: "primary" },
    { n: partial, color: "var(--color-signal)", label: "partial" },
    { n: none, color: "var(--color-urgent)", label: "not represented" },
    { n: unclear, color: "var(--border)", label: "not reported" },
  ].filter((s) => s.n > 0);

  return (
    <span
      className="flex h-1.5 w-full overflow-hidden rounded-full"
      style={{ background: "var(--border)" }}
      title={segments.map((s) => `${s.n} ${s.label}`).join(" · ")}
    >
      {segments.map((s) => (
        <span key={s.label} style={{ width: `${(s.n / total) * 100}%`, background: s.color }} />
      ))}
    </span>
  );
}

export function Confidence({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone =
    value >= 0.75 ? "var(--color-calm)" : value >= 0.55 ? "var(--color-signal)" : "var(--color-urgent)";
  return (
    <span className="inline-flex items-center gap-1.5" title={`extraction confidence ${pct}%`}>
      <span className="h-1 w-8 overflow-hidden rounded-full" style={{ background: "var(--border)" }}>
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

export function SampleSize({ n }: { n: Study["sample_size"] }) {
  if (n === null) return <span style={{ color: "var(--text-faint)" }}>not stated</span>;
  return <span className="nums">{n.toLocaleString()}</span>;
}

export function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div
      className="rounded-lg border border-dashed px-6 py-14 text-center"
      style={{ borderColor: "var(--border)" }}
    >
      <p className="text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm" style={{ color: "var(--text-dim)" }}>
        {hint}
      </p>
    </div>
  );
}
