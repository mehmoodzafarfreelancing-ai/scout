import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeEntities, extractLinks, extractTitle, htmlToText } from "./html";

describe("htmlToText", () => {
  it("drops the whole head so the title does not duplicate into the body", () => {
    const html = "<html><head><title>Grant X | Funder</title></head><body><p>Grant X body.</p></body></html>";
    assert.equal(htmlToText(html), "Grant X body.");
  });

  it("drops scripts, styles and comments entirely", () => {
    const html = `<p>keep</p><script>var x = "drop";</script><style>.a{color:red}</style><!-- drop -->`;
    assert.equal(htmlToText(html), "keep");
  });

  it("turns block tags into line breaks so reading order survives", () => {
    assert.equal(
      htmlToText("<h1>Title</h1><p>Body one</p><p>Body two</p>"),
      "Title\nBody one\nBody two",
    );
  });

  it("collapses runs of whitespace", () => {
    assert.equal(htmlToText("<p>a    b\n\n\nc</p>"), "a b\nc");
  });

  it("decodes entities", () => {
    assert.equal(htmlToText("<p>R&amp;D &mdash; 50&nbsp;%</p>"), "R&D — 50 %");
    assert.equal(decodeEntities("&#8212;"), "—");
  });
});

describe("extractTitle", () => {
  it("prefers h1 over the document title", () => {
    assert.equal(extractTitle("<title>Site</title><h1>Real Heading</h1>"), "Real Heading");
  });

  it("falls back to the document title", () => {
    assert.equal(extractTitle("<title>Only This</title>"), "Only This");
  });

  it("returns an empty string when there is no heading", () => {
    assert.equal(extractTitle("<p>nothing</p>"), "");
  });
});

describe("extractLinks", () => {
  const base = "https://example.org/funding/list";

  it("resolves relative hrefs against the base", () => {
    const links = extractLinks('<a href="/funding/opp/a">A</a>', base);
    assert.deepEqual(links, ["https://example.org/funding/opp/a"]);
  });

  it("de-duplicates and strips fragments", () => {
    const links = extractLinks('<a href="/x#one">1</a><a href="/x#two">2</a>', base);
    assert.equal(links.length, 1);
  });

  it("skips mailto, javascript and malformed hrefs", () => {
    const links = extractLinks(
      '<a href="mailto:a@b.c">m</a><a href="javascript:void(0)">j</a><a href="http://[bad">x</a>',
      base,
    );
    assert.deepEqual(links, []);
  });
});
