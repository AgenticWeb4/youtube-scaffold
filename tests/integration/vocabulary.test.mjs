import test from "node:test";
import assert from "node:assert/strict";
import { application, material, model, deferred } from "../fixtures/helpers.mjs";
import { wordMatches } from "../../src/features/reading/dist/domain/word-matches.js";
const input = {
  term: "evidence",
  videoId: "videoA00001",
  videoTitle: "A",
  sentenceEn: "The evidence supports a conclusion.",
  startMs: 5000,
};
test("Word highlights match complete case-insensitive tokens, not substrings or inflections", () => {
  const text = "Art starts with art. RUN running ran. Don't don’t.";
  const matches = wordMatches(
    text,
    new Map([
      ["art", "a"],
      ["run", "r"],
      ["don't", "d"],
    ]),
  );
  assert.deepEqual(
    matches.map((m) => text.slice(m.start, m.end)),
    ["Art", "art", "RUN", "Don't", "don’t"],
  );
});
test("Vocabulary capture needs no model; clear-cache preserves snapshots and credentials", async () => {
  const app = await application({
    model: model(() => assert.fail("No model during capture")),
  });
  await app.reading.save(input.videoId, material());
  const result = await app.dispatch({ action: "vocabularyCapture", input });
  assert.equal(result.success, true);
  assert.equal(result.example.translationStatus, "pending");
  await app.dispatch({ action: "cacheClear" });
  assert.equal(
    (await app.vocabulary.list())[0].examples[0].sentenceEn,
    input.sentenceEn,
  );
  assert.ok((await app.config.read()).aiApiKey);
});
test("Failed enrichment retains exact source and can be retried; concurrent retries share one request", async () => {
  let calls = 0;
  let fail = true;
  const app = await application({
    model: model(async () => {
      calls++;
      if (fail) throw new Error("offline");
      return {
        text: JSON.stringify({
          segments: [{ id: "vocabulary", text: "证据支持结论。" }],
        }),
      };
    }),
  });
  const saved = await app.dispatch({ action: "vocabularyCapture", input });
  await app.dispatch({ action: "vocabularyTranslate", id: saved.example.id });
  assert.equal(
    (await app.vocabulary.example(saved.example.id)).translationStatus,
    "failed",
  );
  fail = false;
  await Promise.all(
    [1, 2].map(() =>
      app.dispatch({ action: "vocabularyTranslate", id: saved.example.id }),
    ),
  );
  assert.equal(calls, 2);
  const example = await app.vocabulary.example(saved.example.id);
  assert.equal(example.sentenceEn, input.sentenceEn);
  assert.equal(example.sentenceZh, "证据支持结论。");
});
test("Deleting during model request cannot recreate a vocabulary entry", async () => {
  const wait = deferred();
  const entered = deferred();
  const app = await application({
    model: model(async () => {
      entered.resolve();
      return wait.promise;
    }),
  });
  const saved = await app.dispatch({ action: "vocabularyCapture", input });
  const translating = app.dispatch({
    action: "vocabularyTranslate",
    id: saved.example.id,
  });
  await entered.promise;
  await app.dispatch({ action: "vocabularyRemoveEntry", id: saved.entryId });
  wait.resolve({
    text: JSON.stringify({
      segments: [{ id: "vocabulary", text: "证据支持结论。" }],
    }),
  });
  await translating;
  assert.deepEqual(await app.vocabulary.list(), []);
});
test("Vocabulary actions require trusted extension origin; reset clears the owner's data", async () => {
  const app = await application();
  for (const action of [
    "vocabularyList",
    "vocabularyCapture",
    "vocabularyTranslate",
    "vocabularyRemoveEntry",
    "vocabularyRemoveExample",
  ])
    assert.equal(
      (await app.dispatch({ action, input, id: "x" }, { trusted: false }))
        .success,
      false,
    );
  await app.dispatch({ action: "vocabularyCapture", input });
  await app.dispatch({ action: "resetData" });
  assert.deepEqual(await app.vocabulary.list(), []);
});
