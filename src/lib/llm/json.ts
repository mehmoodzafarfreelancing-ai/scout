/**
 * Salvage a JSON object from model output.
 *
 * Even in JSON mode, models wrap responses in ``` fences, prepend "Here is the
 * JSON:", or emit a trailing comma. Failing the whole extraction on any of
 * those wastes a call, so we try progressively less strict recoveries before
 * giving up and escalating to a repair turn.
 */
export function parseLooseJson(raw: string): unknown {
  const text = raw.trim();

  const attempts: string[] = [text];

  // 1. Strip a markdown fence, with or without a language tag.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  if (fenced) attempts.push(fenced.trim());

  // 2. Take the outermost balanced object, ignoring braces inside strings.
  const sliced = outermostObject(text);
  if (sliced) attempts.push(sliced);

  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch {
      // 3. Last resort: drop trailing commas, a very common model slip.
      try {
        return JSON.parse(candidate.replace(/,(\s*[}\]])/g, "$1"));
      } catch {
        // fall through to the next candidate
      }
    }
  }

  throw new SyntaxError(`no parsable JSON in model output: ${text.slice(0, 160)}…`);
}

function outermostObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}
