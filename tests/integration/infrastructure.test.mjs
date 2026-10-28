import test from "node:test";
import assert from "node:assert/strict";
import {
  createProvider,
  configuration,
  createMemoryStore,
  createConfiguration,
  createModelPort,
} from "../../src/modules/infrastructure/dist/index.js";
import { settings, deferred } from "../fixtures/helpers.mjs";
const options = {
  messages: [{ role: "user", content: "Explain" }],
  maxTokens: 100,
  responseFormat: { type: "json_object" },
};
test("P30 fixed settings normalize credentials and safely clear legacy custom key", () => {
  const out = configuration.normalize({
    ...settings,
    provider: "custom",
    aiApiKey: "old-key",
    aiModel: "other",
    supadataApiKey: " keep ",
  });
  assert.equal(out.aiApiKey, "");
  assert.equal(out.supadataApiKey, "keep");
  assert.equal(out.aiModel, "deepseek-v4-flash");
  assert.deepEqual(configuration.migrateLegacyCustom(out).settings, out);
});
test("P30 configuration persists only the supported fixed service fields", async () => {
  const c = createConfiguration(createMemoryStore());
  await c.save({ ...settings, extra: "drop", aiApiKey: " key " });
  assert.equal((await c.read()).aiApiKey, "key");
  assert.equal((await c.read()).extra, undefined);
  await c.reset();
  assert.equal((await c.read()).aiApiKey, "");
});
test("P35 store updates are atomic within the single owning context", async () => {
  const s = createMemoryStore();
  await Promise.all(
    Array.from({ length: 50 }, () => s.update("count", (n) => (n || 0) + 1)),
  );
  assert.equal(await s.get("count"), 50);
});
test("P21 prompt substitution is single-pass and does not reinterpret source braces", async () => {
  const c = createConfiguration(createMemoryStore());
  let loads = 0;
  const p = createModelPort({
    config: c,
    loadText: async () => {
      loads++;
      return "## System prompt\n```\n{transcriptText} / {videoTitle}\n```";
    },
  });
  const first = await p.prompt("analysis.md", "System prompt", {
    transcriptText: "{videoTitle}",
    videoTitle: "Actual",
  });
  assert.equal(first, "{videoTitle} / Actual");
  await p.prompt("analysis.md", "System prompt", {});
  assert.equal(loads, 1);
  await assert.rejects(p.prompt("../secret", "System prompt"), /Invalid/);
});
test("P34 provider sends bounded JSON non-thinking requests to the fixed endpoint", async () => {
  let sent;
  const p = createProvider({
    getSettings: async () => settings,
    fetch: async (url, opts) => {
      sent = { url, opts, body: JSON.parse(opts.body) };
      return Response.json({ choices: [{ message: { content: "answer" } }] });
    },
  });
  assert.equal((await p.request(options)).text, "answer");
  assert.equal(sent.url, "https://api.deepseek.com/chat/completions");
  assert.equal(sent.body.thinking.type, "disabled");
  assert.equal(sent.body.model, "deepseek-v4-flash");
  assert.deepEqual(sent.body.response_format, { type: "json_object" });
});
test("P34 leading whitespace and blank keepalive chunks are accepted", async () => {
  const chunks = ["\n", "  ", '{"choices":[{"message":{"content":"done"}}]}'];
  let activities = 0;
  const p = createProvider({
    getSettings: async () => settings,
    setTimeout: () => {
      activities++;
      return 1;
    },
    clearTimeout: () => {},
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(c) {
            for (const text of chunks)
              c.enqueue(new TextEncoder().encode(text));
            c.close();
          },
        }),
      ),
  });
  assert.equal((await p.request(options)).text, "done");
  assert.ok(activities >= 5);
});
for (const [duration, code] of [
  [50000, "AI_IDLE_TIMEOUT"],
  [120000, "AI_HARD_TIMEOUT"],
])
  test(`P34 timer ${duration} aborts with ${code}`, async () => {
    const timers = [];
    const started = deferred();
    const p = createProvider({
      getSettings: async () => settings,
      setTimeout: (fn, ms) => {
        const timer = { fn, ms, active: true };
        timers.push(timer);
        return timer;
      },
      clearTimeout: (t) => {
        if (t) t.active = false;
      },
      fetch: async (url, { signal }) => {
        started.resolve();
        return new Promise((resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted"))),
        );
      },
    });
    const request = p.request(options);
    await started.promise;
    timers.find((t) => t.active && t.ms === duration).fn();
    await assert.rejects(request, { code });
  });
test("P34 oversized provider body is rejected before unbounded parse", async () => {
  const p = createProvider({
    getSettings: async () => settings,
    fetch: async () => new Response("x".repeat(2 * 1024 * 1024 + 1)),
  });
  await assert.rejects(p.request(options), { code: "AI_RESPONSE_TOO_LARGE" });
});
test("P34 empty provider completion has an explicit retryable error", async () => {
  const p = createProvider({
    getSettings: async () => settings,
    fetch: async () =>
      Response.json({ choices: [{ message: { content: "" } }] }),
  });
  await assert.rejects(p.request(options), { code: "EMPTY_AI_RESPONSE" });
});
