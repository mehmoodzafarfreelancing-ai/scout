import { z } from "zod";
import type { LlmClient } from "./types";
import { withRetry } from "./types";
import { parseLooseJson } from "./json";

/**
 * Schema-guided extraction with a self-repair loop.
 *
 * The failure that matters in this pipeline is not the model refusing — it is
 * the model returning plausible JSON that violates the contract (a date as
 * "Spring 2026", confidence as "high", a missing required field). Zod catches
 * that at the boundary, and rather than discarding the call we hand the model
 * its own output plus the specific validation errors and ask for a correction.
 * In practice one repair turn recovers the large majority of failures, which
 * matters a great deal when the budget is a free tier.
 */

export type ExtractionMeta = {
  attempts: number;
  repaired: boolean;
  model: string;
  provider: string;
  usage: { input: number; output: number } | null;
};

export type ExtractionResult<T> =
  | { ok: true; data: T; meta: ExtractionMeta }
  | { ok: false; error: string; meta: ExtractionMeta };

const SYSTEM = `You extract structured records about research funding opportunities from web pages.

Rules:
- Return ONE JSON object and nothing else. No prose, no markdown fences.
- Use only facts present in the page. Never infer or invent a value.
- If a field is genuinely absent, use null (or [] for arrays). Do not guess.
- Dates must be YYYY-MM-DD. If the page gives only "Spring 2026" or similar, use null.
- Amounts are plain numbers with no currency symbols, commas, or units.
- "confidence" is your own probability (0-1) that this page is a real funding
  call and that you read it correctly. Be strict: a listing index, a news post,
  or a closed archive page should score below 0.4.`;

function formatIssues(issues: z.core.$ZodIssue[]): string {
  return issues
    .slice(0, 12)
    .map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
}

export async function extractStructured<S extends z.ZodType>(
  client: LlmClient,
  schema: S,
  page: { title: string; text: string; url: string },
  { maxChars = 14_000, maxRepairs = 1 } = {},
): Promise<ExtractionResult<z.infer<S>>> {
  const jsonSchema = JSON.stringify(z.toJSONSchema(schema, { io: "input" }), null, 2);

  // Long pages are mostly navigation chrome at the tail; the call details sit
  // near the top. Truncating beats paying for tokens that dilute the signal.
  const body = page.text.length > maxChars ? `${page.text.slice(0, maxChars)}\n…[truncated]` : page.text;

  const basePrompt = `Target JSON Schema:\n${jsonSchema}\n\nSOURCE URL: ${page.url}\nTITLE:\n${page.title}\n\nCONTENT:\n${body}`;

  let attempts = 0;
  let repaired = false;
  let lastUsage: ExtractionMeta["usage"] = null;
  let lastError = "unknown extraction failure";
  let prompt = basePrompt;

  for (let round = 0; round <= maxRepairs; round++) {
    attempts++;
    const res = await withRetry(() =>
      client.complete({ system: SYSTEM, user: prompt, json: true, temperature: 0 }),
    );
    lastUsage = res.usage;

    let parsed: unknown;
    try {
      parsed = parseLooseJson(res.text);
    } catch (err) {
      lastError = String(err);
      prompt = `${basePrompt}\n\nYour previous reply was not valid JSON:\n${res.text.slice(0, 800)}\n\nReturn only the corrected JSON object.`;
      repaired = true;
      continue;
    }

    const check = schema.safeParse(parsed);
    if (check.success) {
      return {
        ok: true,
        data: check.data,
        meta: { attempts, repaired, model: client.model, provider: client.name, usage: lastUsage },
      };
    }

    lastError = formatIssues(check.error.issues);
    prompt = `${basePrompt}\n\nYour previous reply failed schema validation:\n${JSON.stringify(parsed).slice(0, 800)}\n\nErrors:\n${lastError}\n\nReturn the corrected JSON object only. Fix exactly these fields; leave everything else as you had it.`;
    repaired = true;
  }

  return {
    ok: false,
    error: lastError,
    meta: { attempts, repaired, model: client.model, provider: client.name, usage: lastUsage },
  };
}
