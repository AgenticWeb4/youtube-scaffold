import test from "node:test";
import assert from "node:assert/strict";
import { createExport, buildMarkdown } from "../../src/features/export/dist/index.js";
import { createExportView } from "../../src/features/export/dist/presentation/index.js";
import { id, analysis } from "../fixtures/helpers.mjs";
const study = () => ({
  videoId: id,
  title: "Evidence",
  channel: "Example",
  analysis,
  transcript: "Original transcript",
  notes: [{ videoId: id, text: "Saved", timestampSeconds: 5 }],
});
function store() {
  const values = new Map();
  return {
    get: async (key) => values.get(key),
    set: async (key, value) => {
      values.set(key, value);
    },
    clear: async () => values.clear(),
  };
}
function directory({
  granted = true,
  writeError = false,
  closeError = false,
} = {}) {
  const calls = [];
  const folder = {
    name: "study",
    queryPermission: async () => (granted ? "granted" : "prompt"),
    requestPermission: async () => {
      calls.push("permission");
      return granted ? "granted" : "denied";
    },
    getFileHandle: async (name) => {
      calls.push({ name });
      return {
        createWritable: async () => ({
          write: async (content) => {
            if (writeError) throw new Error("Disk full");
            calls.push({ content });
          },
          close: async () => {
            if (closeError) throw new Error("Close failed");
            calls.push("closed");
          },
          abort: async () => calls.push("aborted"),
        }),
      };
    },
  };
  return { folder, calls };
}
test("P29 Markdown includes selected content, actual positions and only this origin notes", () => {
  const value = study();
  value.aiApiKey = "must-not-export";
  value.notes.push({ videoId: "another0001", text: "Other private note" });
  const text = buildMarkdown(value);
  assert.match(text, /## 分析/);
  assert.match(text, /&t=5s/);
  assert.doesNotMatch(text, /must-not-export|Other private/);
  assert.doesNotMatch(
    buildMarkdown(value, { analysis: false, transcript: true, notes: false }),
    /## 分析|## 笔记/,
  );
  assert.throws(
    () => buildMarkdown({ ...value, videoId: "../../bad" }),
    /Invalid/,
  );
});
test("P28 chosen directory and sections survive a new Export instance", async () => {
  const s = store();
  const { folder } = directory();
  const first = createExport({ store: s, picker: async () => folder });
  await first.chooseDirectory();
  await first.setSections({ analysis: false, transcript: true, notes: false });
  const reopened = createExport({ store: s });
  assert.deepEqual(await reopened.readConfig(), {
    directoryName: "study",
    sections: { analysis: false, transcript: true, notes: false },
  });
  await assert.rejects(
    first.setSections({ analysis: false, transcript: false, notes: false }),
    { code: "NO_SECTIONS" },
  );
});
test("P28 directory picker is invoked before awaiting storage; cancel preserves old target", async () => {
  const s = store();
  const { folder } = directory();
  await s.set("directory", folder);
  let called = false;
  const e = createExport({
    store: s,
    picker() {
      called = true;
      throw Object.assign(new Error("Cancelled"), { name: "AbortError" });
    },
  });
  const pending = e.chooseDirectory();
  assert.equal(called, true);
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal((await e.readConfig()).directoryName, "study");
});
test("P28 no directory or denied permissions never writes or loads notes", async () => {
  const s = store();
  const e = createExport({ store: s });
  let loaded = false;
  const loader = () => {
    loaded = true;
    return [];
  };
  await assert.rejects(e.saveStudy(study(), loader), { code: "NO_DIRECTORY" });
  const { folder, calls } = directory({ granted: false });
  await s.set("directory", folder);
  await assert.rejects(e.saveStudy(study(), loader), {
    code: "PERMISSION_DENIED",
  });
  assert.equal(loaded, false);
  assert.deepEqual(calls, ["permission"]);
});
test("P29 fresh notes are scoped, unselected notes skip loading, and success follows close", async () => {
  const s = store();
  const { folder, calls } = directory();
  await s.set("directory", folder);
  const e = createExport({ store: s, suffix: () => "unique-one" });
  const out = await e.saveStudy(study(), async (origin) => {
    assert.equal(origin, id);
    return [{ videoId: id, text: "Fresh note", timestampSeconds: 10 }];
  });
  assert.equal(out.filename, id + "-unique-one.md");
  assert.equal(calls.at(-1), "closed");
  assert.match(calls.find((c) => c.content)?.content, /Fresh note/);
  await e.setSections({ analysis: true, transcript: true, notes: false });
  await e.saveStudy(study(), () => assert.fail("Notes not selected"));
});
test("P29 failed write or close aborts and never returns success", async () => {
  for (const flags of [{ writeError: true }, { closeError: true }]) {
    const s = store();
    const { folder, calls } = directory(flags);
    await s.set("directory", folder);
    await assert.rejects(
      createExport({ store: s }).saveStudy(study()),
      /Disk full|Close failed/,
    );
    assert.equal(calls.at(-1), "aborted");
  }
});
test("P29 Export view freezes source before asynchronous permission and notes work", async () => {
  const button = { disabled: false },
    status = { textContent: "" };
  globalThis.document = {
    getElementById: (name) => (name === "exportStudyBtn" ? button : status),
  };
  let saved;
  const ctx = {
    currentVideoId: id,
    currentVideoTitle: "Original",
    currentChannelName: "Channel",
    currentAnalysis: analysis,
    getDisplayedTranscriptText: () => "Original text",
    api: {
      sendMessage: async (m) => {
        assert.equal(m.videoId, id);
        return { success: true, notes: [] };
      },
    },
    YTD_EXPORT: {
      saveStudy: async (snapshot, load) => {
        ctx.currentVideoId = "videoB00001";
        ctx.currentVideoTitle = "Changed";
        await load(snapshot.videoId);
        saved = snapshot;
        return { directoryName: "study", filename: "original.md" };
      },
    },
  };
  await createExportView(ctx).exportStudy();
  assert.equal(saved.title, "Original");
  assert.equal(saved.transcript, "Original text");
  assert.equal(button.disabled, false);
  assert.match(status.textContent, /original.md/);
  delete globalThis.document;
});
test("P33 resetting Export removes preferences but never requests disk deletion", async () => {
  const s = store();
  const { folder, calls } = directory();
  const e = createExport({ store: s, picker: async () => folder });
  await e.chooseDirectory();
  await e.reset();
  assert.equal((await e.readConfig()).directoryName, "");
  assert.deepEqual(calls, []);
});
