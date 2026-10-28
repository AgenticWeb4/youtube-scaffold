import test from "node:test";
import assert from "node:assert/strict";
import { createReading } from "../../src/features/reading/dist/index.js";
import {
  createMemoryStore,
  canonicalUrl,
  id,
  captions,
  material,
  settings,
  deferred,
} from "../fixtures/helpers.mjs";
const make = (extra = {}) => {
  const store = createMemoryStore();
  return createReading({ store, session: store, ...extra });
};

test("P08 Reading reconstructs a complete thought across caption boundaries", () => {
  const result = make().groupTranscriptEntries([
    { text: "The evidence supports", start: 0, duration: 2 },
    { text: "this conclusion. The assumptions", start: 2, duration: 3 },
    { text: "still matter.", start: 5, duration: 2 },
  ]);
  assert.ok(result.length);
  assert.match(result.map((x) => x.text).join(" "), /supports this conclusion/);
  assert.equal(result[0].start, 0);
});
test("P08 oversized thoughts remain bounded and seekable", () => {
  const result = make().groupTranscriptEntries([
    { text: "long word ".repeat(400), start: 10, duration: 300 },
  ]);
  assert.ok(result.length > 5);
  assert.ok(
    result.every((s) => s.text.length <= 384 && Number.isFinite(s.start)),
  );
  assert.ok(new Set(result.map((s) => s.id)).size === result.length);
});
test("P08 Chinese punctuation preserves complete readable content", () => {
  const input = "这是一个结论。它依赖证据与假设，而不是只看结果。";
  assert.equal(
    make()
      .groupTranscriptEntries([{ text: input, start: 0, duration: 10 }])
      .map((s) => s.text)
      .join("")
      .replaceAll(" ", ""),
    input,
  );
});
test("P14 literal search ignores case, treats punctuation literally and empty queries as empty", () => {
  const r = make();
  assert.deepEqual(r.findLiteralTranscriptMatches("A.B ACB a.b", "A.B"), [
    { start: 0, end: 3 },
    { start: 8, end: 11 },
  ]);
  assert.deepEqual(
    r.findLiteralTranscriptMatches("证据支持结论，证据也有限", "证据"),
    [
      { start: 0, end: 2 },
      { start: 7, end: 9 },
    ],
  );
  assert.deepEqual(r.findLiteralTranscriptMatches("text", "  "), []);
});
test("P19 context is tied to the selected occurrence rather than first matching word", () => {
  const entries = Array.from({ length: 20 }, (_, i) => ({
    text: `context-${i} repeated`,
    start: i * 10,
    duration: 10,
  }));
  const text = make().context(entries, 150);
  assert.ok(text.includes("context-15"));
  assert.ok(!text.includes("context-0 "));
  assert.equal(make().context([], 0), "");
});
test("P26 material expiry is independent of collection data", async () => {
  const store = createMemoryStore();
  let now = 0;
  const r = make({ store, clock: () => now });
  await r.save(id, material());
  await store.set("ytd_notes", [{ id: "keep" }]);
  assert.ok(await r.read(id));
  now = 31 * 86400000;
  assert.equal(await r.read(id), null);
  assert.equal((await store.get("ytd_notes")).length, 1);
});
test("P26 eviction returns expired and over-capacity origins", async () => {
  const r = make();
  for (let i = 0; i < 22; i++) await r.save(`video-${i}`, material());
  const removed = await r.evict(20);
  assert.equal(removed.length, 2);
});
test("P13/P15 reading preferences merge concurrent origins and validate supported keys", async () => {
  const r = make();
  await Promise.all([
    r.viewStorage.set({
      ytd_transcript_view_state: { a: { scrollTop: 10, updatedAt: 1 } },
    }),
    r.viewStorage.set({
      ytd_transcript_view_state: { b: { scrollTop: 20, updatedAt: 2 } },
    }),
  ]);
  assert.equal(
    Object.keys(
      (await r.viewStorage.get("ytd_transcript_view_state"))
        .ytd_transcript_view_state,
    ).length,
    2,
  );
  await assert.rejects(r.viewStorage.get("ytd_settings"), /Unknown/);
});
test("P05/P07 source sends only canonical watch URL, native mode and parses offsets", async () => {
  let url, headers;
  const r = make({
    source: {
      getSettings: async () => settings,
      canonicalUrl,
      fetch: async (u, o) => {
        url = new URL(u);
        headers = o.headers;
        return Response.json({
          lang: "en",
          content: [{ text: ">> Evidence.", offset: 1500, duration: 2000 }],
        });
      },
    },
  });
  const result = await r.load(id);
  assert.equal(result.success, true);
  assert.equal(url.searchParams.get("url"), canonicalUrl(id));
  assert.equal(url.searchParams.get("mode"), "native");
  assert.equal(url.searchParams.get("lang"), "en");
  assert.equal(headers["x-api-key"], "fixture-key");
  assert.equal(result.transcript[0].start, 1);
  assert.equal(result.transcript[0].text, "Evidence.");
});
test("P06 source gives explicit missing/native/rate-limit/empty failures", async () => {
  for (const [status, body, expected] of [
    [206, {}, "NO_TRANSCRIPT"],
    [401, {}, "INVALID_SUPADATA_KEY"],
    [404, {}, "NO_TRANSCRIPT"],
    [429, {}, "RATE_LIMITED"],
    [200, { content: [] }, "EMPTY_TRANSCRIPT"],
  ]) {
    const result = await make({
      source: {
        getSettings: async () => settings,
        canonicalUrl,
        fetch: async () => Response.json(body, { status }),
      },
    }).load(id);
    assert.equal(result.success, false);
    assert.equal(result.error, expected);
  }
});
test("P09 duplicate acquisition shares one provider call and later reads use cache", async () => {
  const d = deferred();
  let calls = 0;
  const r = make({
    source: {
      getSettings: async () => settings,
      canonicalUrl,
      fetch: async () => {
        calls++;
        return d.promise;
      },
    },
  });
  const a = r.load(id),
    b = r.load(id);
  await Promise.resolve();
  d.resolve(
    Response.json({
      content: [{ text: "Evidence.", offset: 0, duration: 1000 }],
    }),
  );
  await Promise.all([a, b]);
  await r.load(id);
  assert.equal(calls, 1);
});
test("P35 reset prevents a pending acquisition from repopulating material", async () => {
  const d = deferred();
  const r = make({
    source: {
      getSettings: async () => settings,
      canonicalUrl,
      fetch: async () => d.promise,
    },
  });
  const pending = r.load(id);
  await Promise.resolve();
  await r.clear();
  d.resolve(Response.json({ content: [{ text: "Old", offset: 0 }] }));
  assert.equal((await pending).success, false);
  assert.equal(await r.read(id), null);
});
