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

const SYSTEM = `You extract structured records about health research studies from registry entries and publication metadata.

The purpose of this extraction is to measure which populations a body of evidence actually covers, so the population fields matter more than anything else. Be strict about them.

Rules:
- Return ONE JSON object and nothing else. No prose, no markdown fences.
- Use only facts present in the record. Never infer or invent a value.
- If a field is genuinely absent, use null (or [] for arrays). Do not guess.
- "countries" means where PARTICIPANTS WERE RECRUITED. Author affiliations are
  not evidence of this. A trial run entirely in Denmark by an author based in
  Karachi recruited in Denmark.
- "representation" describes South Asian populations, meaning Pakistan, India,
  Bangladesh, Sri Lanka, Nepal, Bhutan, the Maldives, or a diaspora cohort
  explicitly identified as South Asian:
    "primary"  the study population is mainly South Asian
    "partial"  South Asian participants are included within a larger cohort
    "none"     the record states a population and it is not South Asian
    "unclear"  the record does not say who was enrolled
  Use "unclear" rather than "none" whenever the record is silent. Those are
  opposite findings and treating silence as absence corrupts the whole analysis.
- "sample_size" is enrolled participants. Null if not stated.
- "condition" should be the common clinical name, lower case, no abbreviation.
- "confidence" is your own probability (0-1) that this is a real study record
  and that you read it correctly. Score below 0.4 for an index page, a
  correction notice, an editorial, or a record too fragmentary to interpret.`;

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

  // Registry records front-load the structured fields and trail off into
  // boilerplate. Truncating beats paying for tokens that dilute the signal.
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
