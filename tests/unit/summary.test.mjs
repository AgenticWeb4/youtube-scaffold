import test from "node:test";
import assert from "node:assert/strict";
import { createSummary } from "../../src/features/summary/dist/index.js";
import {
  model,
  createMemoryStore,
  analysis,
  id,
  deferred,
} from "../fixtures/helpers.mjs";
const make = (m = model()) =>
  createSummary({ model: m, store: createMemoryStore() });
const input = {
  videoId: id,
  transcriptText: "[0:00] Evidence\n[0:30] Conclusion",
  videoDuration: 60,
};
test("P21/P22 Summary tolerates fenced/trailing-comma JSON and normalizes supported schema", async () => {
  const s = make(
    model(async () => ({
      text: '```json\n{"chapters":[{"title":"A","timestampSeconds":30,}],"keyQuotes":[],"injected":"x",}\n```',
    })),
  );
  const out = await s.analyze(input);
  assert.equal(out.success, true);
  assert.equal(out.analysis.chapters[0].timestamp, "0:30");
  assert.equal(out.analysis.injected, undefined);
});
test("P22 invalid times/fields are discarded and output is ordered", () => {
  const out = make().validate(
    {
      chapters: [
        { title: "Later", timestampSeconds: 20 },
        { title: "Bad", timestampSeconds: 61 },
        { title: "First", timestampSeconds: 0 },
      ],
      keyQuotes: [{ quote: "Wrong", timestampSeconds: -1 }],
      keyMoments: [NaN, -1, 20, 90],
    },
    60,
  );
  assert.deepEqual(
    out.chapters.map((x) => x.title),
    ["First", "Later"],
  );
  assert.equal(out.keyQuotes.length, 0);
  assert.deepEqual(out.keyMoments, [20]);
});
test("P35 newer request supersedes older summary only within the same origin", async () => {
  const d = deferred();
  let count = 0;
  const s = make(
    model(async () =>
      ++count === 1 ? d.promise : { text: JSON.stringify(analysis) },
    ),
  );
  const old = s.analyze(input);
  await Promise.resolve();
  const current = await s.analyze(input);
  d.resolve({ text: JSON.stringify(analysis) });
  assert.equal(current.success, true);
  assert.equal((await old).success, false);
});
test("P26 summary cache does not clear a stored result when writing transcript-only snapshot", async () => {
  const s = make();
  await s.save(id, analysis);
  await s.save(id, null);
  assert.ok(await s.read(id));
  await s.clear();
  assert.equal(await s.read(id), null);
});
test("P21 missing model key is explicit and does not issue a completion", async () => {
  let calls = 0;
  const m = model(async () => {
    calls++;
    return { text: "{}" };
  });
  m.getSettings = async () => ({ aiApiKey: "" });
  const out = await make(m).analyze(input);
  assert.equal(out.success, false);
  assert.equal(out.error, "NO_AI_KEY");
  assert.equal(calls, 0);
});
test("P21 duration includes later transcript stamps when metadata is missing", async () => {
  const variables = [];
  const m = model();
  m.prompt = async (file, heading, v) => {
    variables.push(v);
    return "";
  };
  await make(m).analyze({
    ...input,
    videoDuration: 0,
    transcriptText: "[0:00] Start\n[120:30] End",
  });
  assert.equal(variables[0].maxTimestampSeconds, 7230);
  assert.equal(variables[0].lateThreshold, "90:22");
});
