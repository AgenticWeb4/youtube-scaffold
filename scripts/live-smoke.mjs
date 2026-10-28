// Opt-in integration test: credentials arrive over stdin and remain process-memory only.
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { once } from "node:events";
import { assembleApplication } from "../src/apps/extension/dist/platform.js";
import { createMemoryStore } from "../src/modules/infrastructure/dist/index.js";
import { createExport } from "../src/features/export/dist/index.js";

const root = path.resolve(import.meta.dirname, "..");
const sanitize = (value) =>
  String(value).replace(/\b(?:sk-|sd_)[A-Za-z0-9_-]+/g, "[REDACTED]");
const log = (value) =>
  process.stdout.write(sanitize(JSON.stringify(value)) + "\n");
console.error = (...args) =>
  process.stderr.write(
    sanitize(
      args.map((x) => (x instanceof Error ? x.message : String(x))).join(" "),
    ) + "\n",
  );
if (process.stdin.isTTY) process.stdin.setRawMode(true);
log({
  stage: "ready",
  credentialInput:
    "stdin only with terminal echo disabled; values never printed or written",
});
const rl = readline.createInterface({ input: process.stdin, terminal: false });
const [line] = await once(rl, "line");
rl.close();
if (process.stdin.isTTY) process.stdin.setRawMode(false);
process.stdin.pause();
const credentials = JSON.parse(line);
if (!credentials.aiApiKey || !credentials.supadataApiKey)
  throw new Error("Both service credentials are required");
const report = {
  date: "2026-10-28",
  video: {
    id: "_b2qsKz_Ifk",
    title: "Deep Dive: Advanced Ontology | DevCon 5",
    channel: "Palantir Developers",
    duration: 1478,
  },
  kind: "Real service integration using the new feature implementations; Chrome extension installation is separate",
  stages: [],
};
const app = assembleApplication(createMemoryStore(), createMemoryStore(), {
  loadText: (file) =>
    fs.readFile(path.join(root, "src/apps/extension/public/prompts", file), "utf8"),
});
await app.config.save(credentials);
const dispatch = (message) =>
  app.application.dispatch(message, { trusted: true });
const run = async (name, operation) => {
  log({ stage: name, status: "started" });
  const began = Date.now();
  try {
    const value = await operation();
    report.stages.push({
      name,
      ok: true,
      elapsedMs: Date.now() - began,
      ...value,
    });
    log({ stage: name, status: "passed", ...value });
    return value;
  } catch (error) {
    const item = {
      name,
      ok: false,
      elapsedMs: Date.now() - began,
      error: sanitize(error.message),
    };
    report.stages.push(item);
    log(item);
    throw error;
  }
};
let transcript, summary;
try {
  await run("Supadata native transcript", async () => {
    const result = await dispatch({
      action: "fetchTranscript",
      videoId: report.video.id,
    });
    if (!result.success) throw new Error(result.message || result.error);
    transcript = result;
    return {
      entries: result.transcript.length,
      characters: result.transcriptText.length,
      language: result.language,
    };
  });
  await run("DeepSeek structured summary", async () => {
    const result = await dispatch({
      action: "analyzeTranscript",
      videoId: report.video.id,
      transcriptText: transcript.transcriptTextTimestamped,
      videoTitle: report.video.title,
      channelName: report.video.channel,
      videoDuration: report.video.duration,
    });
    if (!result.success) throw new Error(result.message || result.error);
    summary = result.analysis;
    if (!summary.chapters.length || !summary.keyQuotes.length)
      throw new Error("Missing chapters or quotes");
    return {
      chapters: summary.chapters.length,
      quotes: summary.keyQuotes.length,
      lastChapterSeconds: summary.chapters.at(-1).timestampSeconds,
      lateCoverageHintSatisfied:
        summary.chapters.at(-1).timestampSeconds >=
        report.video.duration * 0.75,
    };
  });
  await run("DeepSeek aligned translation", async () => {
    const segments = app.reading
      .groupTranscriptEntries(transcript.transcript)
      .slice(0, 3)
      .map(({ id, text }) => ({ id, text }));
    const result = await dispatch({
      action: "translateContent",
      content: { segments },
      contentType: "transcriptBatch",
      targetLanguage: "zh",
      videoTitle: report.video.title,
    });
    if (!result.success) throw new Error(result.error);
    const output = result.translatedContent.segments;
    if (output.some((s) => !s.text)) throw new Error("Missing translated unit");
    return {
      units: output.length,
      idsPreserved: segments.every((s, i) => s.id === output[i].id),
      allHaveChinese: output.every((s) => /[\u3400-\u9fff]/.test(s.text)),
    };
  });
  await run("DeepSeek contextual explanation", async () => {
    const result = await dispatch({
      action: "explainSelection",
      selectedText: "ontology",
      transcriptContext: app.reading.context(transcript.transcript, 60),
      videoTitle: report.video.title,
    });
    if (!result.success) throw new Error(result.error);
    return { characters: result.explanation.length };
  });
  await run("Exact and polished collection", async () => {
    const exact = await dispatch({
      action: "saveNote",
      videoId: report.video.id,
      timestamp: 0,
      selectedText: transcript.transcript[0].text,
      videoTitle: report.video.title,
      channelName: report.video.channel,
    });
    const moment = await dispatch({
      action: "saveNote",
      videoId: report.video.id,
      timestamp: 60,
      videoTitle: report.video.title,
      channelName: report.video.channel,
    });
    if (!exact.success || !moment.success)
      throw new Error(exact.error || moment.error);
    return {
      savedNotes: (await app.collection.list(report.video.id)).notes.length,
      exactTextPreserved:
        exact.note.text ===
        transcript.transcript[0].text.replace(/\s+/g, " ").trim(),
    };
  });
  await run("Markdown disk export (Node file adapter)", async () => {
    const directory = path.join(root, "artifacts/live-export");
    await fs.mkdir(directory, { recursive: true });
    const memory = new Map();
    const folder = {
      name: "live-export",
      queryPermission: async () => "granted",
      requestPermission: async () => "granted",
      getFileHandle: async (filename) => ({
        createWritable: async () => {
          let pending = "";
          return {
            write: async (text) => {
              pending = text;
            },
            close: async () =>
              fs.writeFile(path.join(directory, filename), pending),
            abort: async () => {
              pending = "";
            },
          };
        },
      }),
    };
    const exporter = createExport({
      store: {
        get: async (key) => memory.get(key),
        set: async (key, value) => {
          memory.set(key, value);
        },
        clear: async () => memory.clear(),
      },
      picker: async () => folder,
    });
    await exporter.chooseDirectory();
    const result = await exporter.saveStudy(
      {
        videoId: report.video.id,
        title: report.video.title,
        channel: report.video.channel,
        analysis: summary,
        transcript: transcript.transcriptText,
      },
      async (id) => (await app.collection.list(id)).notes,
    );
    const text = await fs.readFile(
      path.join(directory, result.filename),
      "utf8",
    );
    if (
      text.includes(credentials.aiApiKey) ||
      text.includes(credentials.supadataApiKey)
    )
      throw new Error("Credential leakage");
    return {
      filename: result.filename,
      bytes: Buffer.byteLength(text),
      credentialFree: true,
      permissionPickerTested: false,
    };
  });
} catch (error) {
  report.failed = true;
  process.exitCode = 1;
} finally {
  await app.config.reset();
  credentials.aiApiKey = "";
  credentials.supadataApiKey = "";
  await fs.mkdir(path.join(root, "artifacts"), { recursive: true });
  await fs.writeFile(
    path.join(root, "artifacts/live-smoke.json"),
    sanitize(JSON.stringify(report, null, 2)) + "\n",
  );
  log({
    stage: "finished",
    passed: report.stages.filter((s) => s.ok).length,
    total: report.stages.length,
    report: "artifacts/live-smoke.json",
    newExtensionInChrome: "pending user loading",
  });
}
