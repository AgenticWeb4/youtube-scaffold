import test from "node:test";
import assert from "node:assert/strict";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import {
  createVocabulary,
  createVocabularyDatabase,
} from "../../src/features/vocabulary/dist/index.js";
const input = (n = 0) => ({
  term: "Evidence",
  videoId: "videoA00001",
  videoTitle: "A",
  sentenceEn: "The evidence supports a conclusion.",
  sentenceZh: "证据支持结论。",
  startMs: n * 1000,
});
function setup(t, name = crypto.randomUUID()) {
  const db = createVocabularyDatabase(name, { indexedDB, IDBKeyRange });
  t.after(() => db.destroy());
  return { db, api: createVocabulary(db.repository), name };
}
test("Vocabulary persists across connections and folds case; exact duplicate retains original snapshot", async (t) => {
  const { api, db, name } = setup(t);
  const a = await api.capture(input());
  const b = await api.capture({
    ...input(),
    term: "EVIDENCE",
    sentenceEn: "The evidence is revised.",
  });
  assert.equal(b.duplicate, true);
  assert.equal(a.example.id, b.example.id);
  assert.equal(b.example.sentenceEn, input().sentenceEn);
  db.close();
  const second = createVocabularyDatabase(name, { indexedDB, IDBKeyRange });
  t.after(() => second.close());
  const cards = await createVocabulary(second.repository).list();
  assert.equal(cards.length, 1);
  assert.equal(cards[0].examples.length, 1);
  assert.equal(cards[0].term, "evidence");
});
test("Vocabulary serializes two connections: more than ten sources persist without eviction", async (t) => {
  const { api, name } = setup(t);
  const other = createVocabularyDatabase(name, { indexedDB, IDBKeyRange });
  t.after(() => other.close());
  const second = createVocabulary(other.repository);
  const results = await Promise.allSettled(
    Array.from({ length: 14 }, (_, i) =>
      (i % 2 ? second : api).capture(input(i)),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 14);
  assert.equal(results.filter((r) => r.status === "rejected").length, 0);
  const [card] = await api.list();
  assert.equal(card.examples.length, 14);
  assert.deepEqual(
    card.examples.map((e) => e.startMs).sort((a, b) => a - b),
    Array.from({ length: 14 }, (_, i) => i * 1000),
  );
  const saved = card.examples[0];
  assert.equal(
    (await api.capture({ ...input(), startMs: saved.startMs })).duplicate,
    true,
  );
  await api.removeExample(saved.id);
  await api.capture(input(100));
  assert.equal((await api.list())[0].examples.length, 14);
});
test("Vocabulary concurrent same-source saves create one entry and example", async (t) => {
  const { api } = setup(t);
  await Promise.all(Array.from({ length: 8 }, () => api.capture(input())));
  assert.equal((await api.list())[0].examples.length, 1);
});
test("Vocabulary snapshots accumulate across videos; delete cascades and late translation never resurrects", async (t) => {
  const { api } = setup(t);
  const a = await api.capture({ ...input(), sentenceZh: "" });
  await api.capture({ ...input(), videoId: "videoB00001", videoTitle: "B" });
  assert.equal((await api.list())[0].examples.length, 2);
  await api.removeExample(a.example.id);
  assert.equal(
    await api.completeTranslation(a.example.id, "迟到的译文"),
    false,
  );
  await api.removeEntry(a.entryId);
  assert.deepEqual(await api.list(), []);
});
test("Vocabulary removing the last source removes its word; ready translation is not overwritten", async (t) => {
  const { api } = setup(t);
  const { example } = await api.capture(input());
  await api.completeTranslation(example.id, "另一种译文");
  assert.equal((await api.example(example.id)).sentenceZh, input().sentenceZh);
  await api.removeExample(example.id);
  assert.deepEqual(await api.list(), []);
});
test("Vocabulary rejects invalid input before writing anything", async (t) => {
  const { api } = setup(t);
  for (const value of [
    { term: "two words" },
    { term: "art" },
    { startMs: -1 },
    { startMs: NaN },
    { videoId: "javascript:bad" },
    { sentenceEn: "" },
  ])
    assert.throws(() => api.capture({ ...input(), ...value }));
  assert.deepEqual(await api.list(), []);
});

test("An existing ten-source database reopens and accepts an eleventh source without migration or loss", async (t) => {
  const { api, db, name } = setup(t);
  for (let i = 0; i < 10; i++) await api.capture(input(i));
  const originalIds = (await api.list())[0].examples.map((e) => e.id);
  db.close();
  const reopened = createVocabularyDatabase(name, { indexedDB, IDBKeyRange });
  t.after(() => reopened.close());
  const next = createVocabulary(reopened.repository);
  assert.equal((await next.capture(input(10))).duplicate, false);
  assert.equal((await next.capture(input(10))).duplicate, true);
  const [card] = await next.list();
  assert.equal(card.examples.length, 11);
  assert.ok(originalIds.every((id) => card.examples.some((e) => e.id === id)));
});
