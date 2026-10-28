import test from "node:test";
import assert from "node:assert/strict";
import { createTranslation } from "../../src/features/translation/dist/index.js";
import { model, createMemoryStore } from "../fixtures/helpers.mjs";
const make = (m = model()) =>
  createTranslation({ model: m, store: createMemoryStore() });
test("P18 translation aligns by ID and marks missing output instead of positional guessing", () => {
  const source = [
    { id: "a", text: "A" },
    { id: "b", text: "B" },
  ];
  const out = make().align(source, [
    { id: "b", text: "乙" },
    { id: "unknown", text: "丢弃" },
  ]);
  assert.equal(out[0].text, "");
  assert.ok(out[0].error);
  assert.equal(out[1].text, "乙");
});
test("P18 validator rejects duplicated IDs, empty segments and excessive batches", () => {
  const t = make();
  for (const value of [
    { segments: [] },
    {
      segments: [
        { id: "a", text: "A" },
        { id: "a", text: "B" },
      ],
    },
    {
      segments: Array.from({ length: 5 }, (_, i) => ({
        id: String(i),
        text: "x",
      })),
    },
  ])
    assert.throws(() => t.validate(value));
});
test("P15 unsupported languages and content types never call the model", async () => {
  let calls = 0;
  const t = make(
    model(async () => {
      calls++;
      return { text: "{}" };
    }),
  );
  for (const input of [
    { targetLanguage: "fr", contentType: "transcriptBatch" },
    { targetLanguage: "zh", contentType: "unknown" },
  ])
    assert.equal(
      (
        await t.translate({
          ...input,
          content: { segments: [{ id: "a", text: "x" }] },
          videoTitle: "",
        })
      ).success,
      false,
    );
  assert.equal(calls, 0);
});
test("P17 interface and transcript use their own prompt section", async () => {
  const sections = [];
  const m = model(async () => ({
    text: '{"segments":[{"id":"a","text":"证据"}]}',
  }));
  m.prompt = async (file, heading) => {
    sections.push(heading);
    return heading;
  };
  const t = make(m);
  for (const contentType of ["transcriptBatch", "interfaceBatch"])
    assert.equal(
      (
        await t.translate({
          content: { segments: [{ id: "a", text: "Evidence" }] },
          contentType,
          targetLanguage: "zh",
          videoTitle: "Example",
        })
      ).success,
      true,
    );
  assert.ok(sections.includes("Transcript batch translation"));
  assert.ok(sections.includes("Interface content translation"));
});
test("P18 invalid English response stays a row failure while valid Chinese is retained", () => {
  const t = make();
  const out = t.normalize(
    {
      segments: [
        { id: "a", text: "Only English still here" },
        { id: "b", text: "有效中文" },
      ],
    },
    [
      { id: "a", text: "A sufficiently long English original sentence" },
      { id: "b", text: "Another sufficiently long English sentence" },
    ],
  );
  assert.ok(out.segments[0].error);
  assert.equal(out.segments[1].text, "有效中文");
});
test("P34 empty JSON response retries once without response_format", async () => {
  const calls = [];
  const t = make(
    model(async (opts) => {
      calls.push(opts);
      if (calls.length === 1)
        throw Object.assign(new Error("Empty"), { code: "EMPTY_AI_RESPONSE" });
      return { text: '{"segments":[{"id":"a","text":"证据"}]}' };
    }),
  );
  const result = await t.translate({
    content: { segments: [{ id: "a", text: "Evidence" }] },
    contentType: "transcriptBatch",
    targetLanguage: "zh",
    videoTitle: "",
  });
  assert.equal(result.success, true);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].responseFormat);
  assert.equal(calls[1].responseFormat, undefined);
});
test("P26 translation cache merges only text and stays separate from other origins", async () => {
  const t = make();
  await t.save("a", { paragraphCache: { one: "一", bad: { secret: "no" } } });
  await t.save("a", { paragraphCache: { two: "二" } });
  assert.deepEqual((await t.read("a")).paragraphCache, {
    one: "一",
    two: "二",
  });
  assert.deepEqual((await t.read("b")).paragraphCache, {});
  await t.clear();
  assert.deepEqual((await t.read("a")).paragraphCache, {});
});
