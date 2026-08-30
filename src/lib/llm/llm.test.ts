import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { extractStructured } from "./extract";
import { parseLooseJson } from "./json";
import {
  MockLlmClient,
  guessCountries,
  guessRepresentation,
  guessSampleSize,
  guessStudyType,
  guessYear,
} from "./mock";
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

describe("guessCountries", () => {
  it("reads the recruitment countries line", () => {
    const text = "Enrollment: 120\nRecruitment countries: Pakistan; India\nStart date: 2024-01";
    assert.deepEqual(guessCountries(text), ["Pakistan", "India"]);
  });

  it("returns nothing when the field says it was not stated", () => {
    assert.deepEqual(guessCountries("Recruitment countries: not stated"), []);
  });

  it("returns nothing when the field is absent entirely", () => {
    assert.deepEqual(guessCountries("Abstract: a study of adults."), []);
  });
});

describe("guessRepresentation", () => {
  it("is primary when every recruiting country is in the region", () => {
    assert.equal(guessRepresentation(["Pakistan"], ""), "primary");
    assert.equal(guessRepresentation(["India", "Bangladesh"], ""), "primary");
  });

  it("is partial when the region is one site among several", () => {
    assert.equal(guessRepresentation(["United States", "India", "Japan"], ""), "partial");
  });

  it("is none when countries are listed and none are in the region", () => {
    assert.equal(guessRepresentation(["Denmark", "Germany"], ""), "none");
  });

  it("does not treat other parts of Asia as South Asia", () => {
    assert.equal(guessRepresentation(["Hong Kong"], ""), "none");
    assert.equal(guessRepresentation(["Japan", "Malaysia"], ""), "none");
  });

  it("is unclear, never none, when no country is stated", () => {
    // The central rule of the whole pipeline. A record that did not say is not
    // a record that said no, and collapsing the two manufactures a gap.
    assert.equal(guessRepresentation([], "A review of incretin therapies."), "unclear");
  });

  it("falls back to a prose mention when there is no country list", () => {
    assert.equal(guessRepresentation([], "Adults recruited in Karachi."), "partial");
  });
});

describe("guessSampleSize", () => {
  it("prefers the enrollment field", () => {
    assert.equal(guessSampleSize("Enrollment: 1145\nAbstract: we enrolled 30 pilot cases."), 1145);
  });

  it("falls back to n= in an abstract", () => {
    assert.equal(guessSampleSize("Abstract: participants (n = 2,340) were followed."), 2340);
  });

  it("falls back to a counted noun", () => {
    assert.equal(guessSampleSize("Abstract: 412 patients were randomised."), 412);
  });

  it("returns null when no count is given", () => {
    assert.equal(guessSampleSize("Abstract: a narrative review."), null);
  });
});

describe("guessStudyType", () => {
  it("reads the declared type", () => {
    assert.equal(guessStudyType("Study type: INTERVENTIONAL"), "interventional");
    assert.equal(guessStudyType("Study type: OBSERVATIONAL"), "observational");
  });

  it("recognises a review from the publication type", () => {
    assert.equal(guessStudyType("Publication type: Meta-Analysis; Systematic Review"), "review");
  });

  it("infers from the body when nothing is declared", () => {
    assert.equal(guessStudyType("Abstract: a double-blind placebo controlled trial."), "interventional");
    assert.equal(guessStudyType("Abstract: a cross-sectional survey."), "observational");
  });

  it("falls back to other", () => {
    assert.equal(guessStudyType("Abstract: an editorial."), "other");
  });
});

describe("guessYear", () => {
  it("reads a publication year", () => {
    assert.equal(guessYear("Publication year: 2026"), 2026);
  });

  it("reads the year out of a start date", () => {
    assert.equal(guessYear("Start date: 2017-08-16"), 2017);
  });

  it("returns null when absent", () => {
    assert.equal(guessYear("Start date: not stated"), null);
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
    const { ExtractedStudy } = await import("@/lib/db/types");
    const res = await client.complete({
      system: "",
      user:
        "TITLE:\nA trial of metformin\n\nCONTENT:\nCondition(s): Type 2 Diabetes\n" +
        "Study type: INTERVENTIONAL\nEnrollment: 120\nRecruitment countries: Pakistan\n" +
        "Start date: 2024-03-01\n\nAdults with type 2 diabetes recruited at two hospitals.",
    });
    const parsed = ExtractedStudy.safeParse(JSON.parse(res.text));
    assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  });

  it("satisfies the schema even for a record with almost nothing in it", async () => {
    // Every field has a minimum length or a nullable, and a thin abstract is
    // the case most likely to violate one.
    const client = new MockLlmClient();
    const { ExtractedStudy } = await import("@/lib/db/types");
    const res = await client.complete({
      system: "",
      user: "TITLE:\nShort\n\nCONTENT:\nAbstract: not available",
    });
    const parsed = ExtractedStudy.safeParse(JSON.parse(res.text));
    assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  });
});
