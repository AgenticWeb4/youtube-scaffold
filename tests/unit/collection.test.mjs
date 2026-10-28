import test from "node:test";
import assert from "node:assert/strict";
import { createCollection } from "../../src/features/collection/dist/index.js";
import {
  model,
  createMemoryStore,
  canonicalUrl,
  id,
  captions,
  deferred,
} from "../fixtures/helpers.mjs";
const make = (extra = {}) =>
  createCollection({
    store: createMemoryStore(),
    model: model(async () => ({ text: '{"quote":"A complete thought."}' })),
    canonicalUrl,
    ...extra,
  });
const input = {
  videoId: id,
  timestamp: 5,
  videoTitle: "Evidence",
  channelName: "Example",
};
test("P20 exact capture saves selected text without any model call", async () => {
  let calls = 0;
  const c = make({
    model: model(async () => {
      calls++;
      throw new Error("No AI expected");
    }),
  });
  const result = await c.saveExact({
    ...input,
    selectedText: "  Exact\n words  ",
  });
  assert.equal(result.note.text, "Exact words");
  assert.equal(result.note.rawText, "Exact words");
  assert.equal(calls, 0);
});
test("P23 moment capture polishes complete thought and retains original target text", async () => {
  const c = make();
  const result = await c.saveMoment(input, captions);
  assert.equal(result.note.text, "A complete thought.");
  assert.equal(result.note.rawText, captions[1].text);
  assert.equal(result.note.timestampedUrl, canonicalUrl(id) + "&t=5s");
});
test("P23 failed polishing falls back to context rather than losing the note", async () => {
  const c = make({
    model: model(async () => {
      throw new Error("provider unavailable");
    }),
  });
  const result = await c.saveMoment(input, captions);
  assert.equal(result.success, true);
  assert.match(result.note.text, /hypothesis/);
  assert.match(result.note.text, /Assumptions/);
});
test("P35 concurrent saves keep both notes with unique IDs", async () => {
  const c = make();
  await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      c.saveExact({ ...input, selectedText: "note " + i }),
    ),
  );
  const notes = (await c.list()).notes;
  assert.equal(notes.length, 25);
  assert.equal(new Set(notes.map((n) => n.id)).size, 25);
});
test("P25 explicit retention remains at the newest 100 notes", async () => {
  const c = make();
  for (let i = 0; i < 101; i++)
    await c.saveExact({ ...input, selectedText: String(i) });
  const notes = (await c.list()).notes;
  assert.equal(notes.length, 100);
  assert.equal(notes[0].text, "100");
  assert.ok(!notes.some((n) => n.text === "0"));
});
test("P25 replayed capture operation is idempotent within the retention window", async () => {
  const c = make();
  const a = await c.saveExact({
    ...input,
    selectedText: "one",
    operationId: "operation-1",
  });
  const b = await c.saveExact({
    ...input,
    selectedText: "one",
    operationId: "operation-1",
  });
  assert.equal(a.note.id, b.note.id);
  assert.equal((await c.list()).notes.length, 1);
});
test("P25 per-origin filtering, deletion and empty results follow the contract", async () => {
  const c = make();
  const a = await c.saveExact({ ...input, selectedText: "one" });
  await c.saveExact({ ...input, videoId: "videoB00001", selectedText: "two" });
  assert.equal((await c.list(id)).notes.length, 1);
  await c.delete(a.note.id);
  await c.delete("missing");
  assert.deepEqual((await c.list(id)).notes, []);
});
test("P35 clearing during model work prevents a late capture from returning to storage", async () => {
  const d = deferred();
  const c = make({ model: model(async () => d.promise) });
  const pending = c.saveMoment(input, captions);
  await Promise.resolve();
  await c.clear();
  d.resolve({ text: '{"quote":"Old text."}' });
  await assert.rejects(pending, /reset/);
  assert.deepEqual((await c.list()).notes, []);
});
test("P23 empty material and invalid origin never create notes", async () => {
  const c = make();
  assert.equal((await c.saveMoment(input, [])).success, false);
  await assert.rejects(
    c.saveExact({ ...input, videoId: "../../bad", selectedText: "x" }),
    /Invalid/,
  );
  assert.deepEqual((await c.list()).notes, []);
});
