import { config } from "@/lib/config";
import type { IngestRun } from "@/lib/db/types";

/**
 * What a run cost, in dollars.
 *
 * Exists so nobody has to trust an estimate. Free tiers report usage even when
 * they bill nothing, so this shows what the same work would have cost on the
 * paid tier, which is the number you need before scaling a nightly job up.
 */
export function estimateCost(run: Pick<IngestRun, "llm_provider" | "input_tokens" | "output_tokens">): number {
  const provider = run.llm_provider.split(":")[0] ?? "mock";
  const rate = config.pricing[provider] ?? { input: 0, output: 0 };
  return (run.input_tokens / 1e6) * rate.input + (run.output_tokens / 1e6) * rate.output;
}

/** Sub-cent runs are the common case, so never round them to "$0.00". */
export function formatCost(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return `<$0.01`;
  return `$${usd.toFixed(2)}`;
}
