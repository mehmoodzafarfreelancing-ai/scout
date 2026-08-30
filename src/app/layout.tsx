import type { Metadata } from "next";
import Link from "next/link";
import { activeStack } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scout — research funding intelligence",
  description:
    "Scrapes funder websites, extracts structured opportunities with an LLM, and scores them against a researcher profile.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const stack = activeStack();

  return (
    <html lang="en">
      <body className="min-h-dvh">
        <header className="border-b" style={{ borderColor: "var(--border)" }}>
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
            <Link href="/" className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="grid size-7 place-items-center rounded-md text-[13px] font-bold text-white"
                style={{ background: "var(--color-signal)" }}
              >
                S
              </span>
              <span className="text-[15px] font-semibold tracking-tight">Scout</span>
            </Link>

            <nav className="flex items-center gap-5 text-sm" style={{ color: "var(--text-dim)" }}>
              <Link href="/" className="hover:underline underline-offset-4">
                Opportunities
              </Link>
              <Link href="/runs" className="hover:underline underline-offset-4">
                Ingest runs
              </Link>
            </nav>

            {/* Which providers are actually wired right now — the first thing
                you want to know when a demo behaves unexpectedly. */}
            <div
              className="ml-auto flex flex-wrap items-center gap-1.5 font-mono text-[11px]"
              style={{ color: "var(--text-faint)" }}
            >
              <StackChip label="scrape" value={stack.scrape} />
              <StackChip label="llm" value={stack.llm} />
              <StackChip label="store" value={stack.store} />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>

        <footer
          className="mx-auto max-w-6xl px-5 pb-10 pt-4 text-xs"
          style={{ color: "var(--text-faint)" }}
        >
          Data is extracted automatically and may be wrong. Always confirm details on the funder's
          own page before applying.
        </footer>
      </body>
    </html>
  );
}

function StackChip({ label, value }: { label: string; value: string }) {
  return (
    <span
      className="rounded border px-1.5 py-0.5"
      style={{ borderColor: "var(--border)" }}
      title={`${label} provider`}
    >
      {label}:<span style={{ color: "var(--text-dim)" }}>{value}</span>
    </span>
  );
}
