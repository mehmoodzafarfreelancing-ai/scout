import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { extractStructured } from "./extract";
import { parseLooseJson } from "./json";
import { MockLlmClient, guessAward, guessDeadline } from "./mock";
import type { CompletionResult, LlmClient } from "./types";

describe("parseLooseJson", () => {
  it("parses clean JSON", () => {
    assert.deepEqual(parseLooseJson('{"a":1}'), { a: 1 });
  });

  it("strips markdown fences", () => {
    assert.deepEqual(parseLooseJson('```json\n{"a":1}\n```'), { a: 1 });
    assert.deepEqual(parseLooseJson('```\n{"a":1}\n```'), { a: 1 });
  });

  it("recovers an object buried in prose", () => {
    assert.deepEqual(parseLooseJson('Sure! Here you go:\n{"a":1}\nHope that helps.'), { a: 1 });
  });

  it("tolerates trailing commas", () => {
    assert.deepEqual(parseLooseJson('{"a":1,"b":[2,3,],}'), { a: 1, b: [2, 3] });
  });

  it("does not mistake a brace inside a string for structure", () => {
    assert.deepEqual(parseLooseJson('{"a":"} not the end {","b":2}'), {
      a: "} not the end {",
      b: 2,
    });
  });

  it("throws when there is no JSON at all", () => {
    assert.throws(() => parseLooseJson("I cannot help with that."), SyntaxError);
  });
});

describe("guessDeadline", () => {
  it("reads ISO dates", () => {
    assert.equal(guessDeadline("Full proposal deadline: 2026-11-18."), "2026-11-18");
  });

  it("reads day-month-year", () => {
    assert.equal(guessDeadline("The closing date is 22 Oct 2026 at 16:00."), "2026-10-22");
  });

  it("reads month-day-year", () => {
    assert.equal(guessDeadline("Applications due March 3, 2027."), "2027-03-03");
  });

  it("skips a cue with no date and keeps looking", () => {
    // Regression: anchoring on the first cue word returned null here, because
    // "closed" appears in the banner long before the real date.
    const text =
      "This scheme is closed and no longer accepting applications. " +
      "The information below is retained for reference. " +
      "The award supported research on the health consequences of climate change, " +
      "with grants up to 2,500,000. The closing date was 2024-05-30.";
    assert.equal(guessDeadline(text), "2024-05-30");
  });

  it("returns null when there is no date", () => {
    assert.equal(guessDeadline("This is a rolling call with no fixed deadline."), null);
  });
});

describe("guessAward", () => {
  it("expands million and k suffixes", () => {
    const award = guessAward("Awards of up to £3 million, with seed grants of £150k.");
    assert.equal(award?.currency, "GBP");
    assert.equal(award?.max, 3_000_000);
    assert.equal(award?.min, 150_000);
  });

  it("ignores small incidental numbers", () => {
    assert.equal(guessAward("Contact us on $5 for details."), null);
  });

  it("returns null when no money is mentioned", () => {
    assert.equal(guessAward("A fellowship for early-career researchers."), null);
  });
});

const Target = z.object({
  title: z.string().min(3),
  count: z.number().int(),
});

/** Replays a fixed script of responses so the repair loop can be tested. */
class ScriptedClient implements LlmClient {
  readonly name = "scripted";
  readonly model = "test";
  calls: string[] = [];
  constructor(private readonly replies: string[]) {}
  async complete(req: { user: string }): Promise<CompletionResult> {
    this.calls.push(req.user);
    return { text: this.replies[this.calls.length - 1] ?? "{}", model: this.model, usage: null };
  }
}

const page = { title: "T", text: "some page text", url: "https://example.org/x" };

describe("extractStructured", () => {
  it("returns validated data on a clean first response", async () => {
    const client = new ScriptedClient(['{"title":"Hello","count":2}']);
    const res = await extractStructured(client as unknown as LlmClient, Target, page);
    assert.equal(res.ok, true);
    assert.equal(client.calls.length, 1);
    if (res.ok) assert.deepEqual(res.data, { title: "Hello", count: 2 });
  });

  it("repairs a schema violation and reports it", async () => {
    const client = new ScriptedClient([
      '{"title":"Hello","count":"two"}', // wrong type
      '{"title":"Hello","count":2}',
    ]);
    const res = await extractStructured(client as unknown as LlmClient, Target, page);
    assert.equal(res.ok, true);
    assert.equal(client.calls.length, 2);
    if (res.ok) {
      assert.equal(res.meta.repaired, true);
      assert.equal(res.meta.attempts, 2);
    }
    // The repair turn must tell the model which field was wrong.
    assert.match(client.calls[1]!, /count/);
  });

  it("repairs unparsable output", async () => {
    const client = new ScriptedClient(["I'm sorry, I can't do that.", '{"title":"Okay","count":1}']);
    const res = await extractStructured(client as unknown as LlmClient, Target, page);
    assert.equal(res.ok, true);
    assert.equal(client.calls.length, 2);
  });

  it("gives up after the repair budget and surfaces the reason", async () => {
    const client = new ScriptedClient(['{"count":1}', '{"count":1}']);
    const res = await extractStructured(client as unknown as LlmClient, Target, page);
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /title/);
  });

  it("truncates oversized pages rather than sending them whole", async () => {
    const client = new ScriptedClient(['{"title":"Hello","count":1}']);
    const huge = { ...page, text: "x".repeat(50_000) };
    await extractStructured(client as unknown as LlmClient, Target, huge, { maxChars: 1_000 });
    assert.ok(client.calls[0]!.length < 5_000);
    assert.match(client.calls[0]!, /truncated/);
  });
});

describe("MockLlmClient", () => {
  it("always emits output that satisfies the target schema", async () => {
    const client = new MockLlmClient();
    const { ExtractedOpportunity } = await import("@/lib/db/types");
    const res = await client.complete({
      system: "",
      user: "TITLE:\nWellcome Discovery Award\n\nCONTENT:\nThe Wellcome Trust funds neuroscience and psychology research. Awards of up to £3 million over five years. The closing date is 9 Dec 2026.",
    });
    const parsed = ExtractedOpportunity.safeParse(JSON.parse(res.text));
    assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  });
});
