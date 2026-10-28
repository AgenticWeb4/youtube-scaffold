import test from "node:test";
import assert from "node:assert/strict";
import { createExplanation } from "../../src/features/explanation/dist/index.js";
import { model, deferred } from "../fixtures/helpers.mjs";
test("P19 explanation uses the exact selected text and provided context", async () => {
  let captured;
  const m = model(async () => ({ text: "Evidence supports a claim." }));
  m.prompt = async (file, heading, value) => {
    captured = value;
    return "prompt";
  };
  const out = await createExplanation(m).explain({
    selectedText: "evidence",
    transcriptContext: "second occurrence",
    videoTitle: "Video",
  });
  assert.equal(out.explanation, "Evidence supports a claim.");
  assert.equal(captured.transcriptContext, "second occurrence");
});
test("P19 an empty selection does not call the model", async () => {
  let calls = 0;
  const e = createExplanation(
    model(async () => {
      calls++;
      return { text: "x" };
    }),
  );
  assert.equal(
    (
      await e.explain({
        selectedText: " ",
        transcriptContext: "",
        videoTitle: "",
      })
    ).success,
    false,
  );
  assert.equal(calls, 0);
});
test("P19 provider failure is a reachable explicit explanation result", async () => {
  const e = createExplanation(
    model(async () => {
      throw new Error("Unavailable");
    }),
  );
  const result = await e.explain({
    selectedText: "term",
    transcriptContext: "context",
    videoTitle: "Video",
  });
  assert.equal(result.success, false);
  assert.match(result.error, /Unavailable/);
});
