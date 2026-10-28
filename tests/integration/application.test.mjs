import test from "node:test";
import assert from "node:assert/strict";
import {
  application,
  id,
  material,
  analysis,
  model,
  deferred,
} from "../fixtures/helpers.mjs";
test("P09/P21 cache composition retains all feature-owned fields without reissuing AI", async () => {
  let calls = 0;
  const app = await application({
    model: model(async () => {
      calls++;
      return { text: JSON.stringify(analysis) };
    }),
  });
  await app.dispatch({
    action: "cacheWrite",
    videoId: id,
    value: {
      ...material(),
      analysis,
      paragraphCache: { a: "译文" },
      interfaceCache: {},
    },
  });
  const out = await app.dispatch({ action: "cacheRead", videoId: id });
  assert.equal(out.value.analysis.chapters[0].title, "Evidence");
  assert.equal(out.value.paragraphCache.a, "译文");
  assert.equal(calls, 0);
});
test("P20 exact selection dispatch skips source acquisition and model", async () => {
  const app = await application({
    fetch: async () => assert.fail("No source expected"),
    model: model(async () => assert.fail("No model expected")),
  });
  const out = await app.dispatch({
    action: "saveNote",
    videoId: id,
    timestamp: 5,
    selectedText: "Exact",
  });
  assert.equal(out.success, true);
  assert.equal(out.note.text, "Exact");
});
test("P24 quote capture keeps baseline time-based collection semantics", async () => {
  const app = await application({
    model: model(async () => ({ text: '{"quote":"Polished moment."}' })),
  });
  await app.reading.save(id, material());
  const out = await app.dispatch({
    action: "saveNote",
    videoId: id,
    timestamp: 5,
    videoTitle: "Evidence",
  });
  assert.equal(out.note.text, "Polished moment.");
  assert.equal(out.note.rawText, "The evidence supports the conclusion.");
});
test("P35 completed request replay is suppressed without a second side effect", async () => {
  const app = await application();
  const request = {
    action: "saveNote",
    videoId: id,
    timestamp: 0,
    selectedText: "One",
    __ys_requestId: "same-operation",
  };
  assert.equal((await app.dispatch(request)).success, true);
  const replay = await app.dispatch(request);
  assert.equal(replay.code, "REPLAY_SUPPRESSED");
  assert.equal((await app.collection.list()).notes.length, 1);
});
test("P35 simultaneous request replay shares one completion", async () => {
  const app = await application();
  const request = {
    action: "saveNote",
    videoId: id,
    timestamp: 0,
    selectedText: "One",
    __ys_requestId: "concurrent",
  };
  const [a, b] = await Promise.all([
    app.dispatch(request),
    app.dispatch(request),
  ]);
  assert.equal(a.note.id, b.note.id);
  assert.equal((await app.collection.list()).notes.length, 1);
});
test("P36 untrusted content cannot access settings or other video data", async () => {
  const app = await application();
  assert.equal(
    (
      await app.dispatch(
        { action: "configurationGet", keys: ["ytd_settings"] },
        { trusted: false },
      )
    ).success,
    false,
  );
  assert.equal(
    (await app.dispatch({ action: "getNotes" }, { trusted: false })).success,
    false,
  );
  assert.equal(
    (
      await app.dispatch(
        { action: "saveNote", videoId: id, timestamp: 0, selectedText: "x" },
        {
          trusted: false,
          sourceUrl: "https://www.youtube.com/watch?v=videoB00001",
        },
      )
    ).success,
    false,
  );
  assert.deepEqual((await app.collection.list()).notes, []);
});
test("P33 named cache cleanup preserves collected notes and keys", async () => {
  const app = await application();
  await app.reading.save(id, material());
  await app.summary.save(id, analysis);
  await app.collection.saveExact({
    videoId: id,
    timestamp: 0,
    selectedText: "Keep",
  });
  await app.dispatch({ action: "cacheClear" });
  assert.equal(await app.reading.read(id), null);
  assert.equal(await app.summary.read(id), null);
  assert.equal((await app.collection.list()).notes.length, 1);
  assert.ok((await app.config.read()).aiApiKey);
});
test("P33 reset clears feature-owned data and settings", async () => {
  const app = await application();
  await app.reading.save(id, material());
  await app.collection.saveExact({
    videoId: id,
    timestamp: 0,
    selectedText: "Clear",
  });
  assert.equal((await app.dispatch({ action: "resetData" })).success, true);
  assert.equal(await app.reading.read(id), null);
  assert.deepEqual((await app.collection.list()).notes, []);
  assert.equal((await app.config.read()).aiApiKey, "");
});
test("P35 clear during pending moment capture prevents resurrection through the full application", async () => {
  const started = deferred(),
    reply = deferred();
  const app = await application({
    model: model(async () => {
      started.resolve();
      return reply.promise;
    }),
  });
  await app.reading.save(id, material());
  const old = app.dispatch({ action: "saveNote", videoId: id, timestamp: 5 });
  await started.promise;
  await app.dispatch({ action: "resetData" });
  reply.resolve({ text: '{"quote":"Old"}' });
  assert.equal((await old).success, false);
  assert.deepEqual((await app.collection.list()).notes, []);
});
test("P35 execution records contain correlation and outcomes without keys or text", async () => {
  const app = await application();
  await app.dispatch({
    action: "saveNote",
    videoId: id,
    timestamp: 0,
    selectedText: "Private selection",
    __ys_requestId: "trace-me",
  });
  const records = await app.store.get("ys_execution");
  assert.equal(records[0].requestId, "trace-me");
  assert.equal(records[0].phase, "completed");
  assert.doesNotMatch(JSON.stringify(records), /fixture-key|Private selection/);
});
test("P30 configuration protocol permits only the supported owner keys", async () => {
  const app = await application();
  assert.equal(
    (
      await app.dispatch({
        action: "configurationSet",
        value: { arbitrary: "x" },
      })
    ).success,
    false,
  );
  assert.equal(
    (await app.dispatch({ action: "configurationGet", keys: ["arbitrary"] }))
      .success,
    false,
  );
  assert.equal((await app.dispatch({ action: "unknown" })).success, false);
});
