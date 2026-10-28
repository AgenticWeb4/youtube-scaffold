import test from "node:test";
import assert from "node:assert/strict";
import {
  createConnectionTester,
  createConfiguration,
  createMemoryStore,
} from "../../src/modules/infrastructure/dist/index.js";
import { mountWorker } from "../../src/modules/gateway/dist/index.js";
import { application } from "../fixtures/helpers.mjs";

test("Connection probes use fixed authenticated endpoints without reading account data", async () => {
  const calls = [];
  const tester = createConnectionTester({
    fetch: async (url, options) => {
      calls.push({ url, options });
      return new Response("metadata that must be discarded");
    },
  });
  assert.equal((await tester("deepseek", "draft-key")).code, "CONNECTED");
  assert.equal((await tester("supadata", "draft-key")).code, "CONNECTED");
  assert.equal(calls[0].url, "https://api.deepseek.com/models");
  assert.equal(calls[0].options.headers.Authorization, "Bearer draft-key");
  assert.equal(calls[1].url, "https://api.supadata.ai/v1/me");
  assert.equal(calls[1].options.headers["x-api-key"], "draft-key");
  assert.equal(calls[1].options.redirect, "error");
});
test("Unsaved key testing never persists the tested credential", async () => {
  const c = createConfiguration(createMemoryStore(), {
    fetch: async () => new Response("ok"),
  });
  await c.save({ aiApiKey: "saved-key" });
  const out = await c.testConnection("deepseek", "unsaved-key");
  assert.equal(out.success, true);
  assert.equal((await c.read()).aiApiKey, "saved-key");
  assert.doesNotMatch(JSON.stringify(out), /saved-key|unsaved-key/);
});
test("Connection diagnostics distinguish authentication, rate limit and other HTTP failures", async () => {
  for (const [status, code] of [
    [401, "AUTH_FAILED"],
    [403, "AUTH_FAILED"],
    [429, "RATE_LIMITED"],
    [500, "HTTP_ERROR"],
  ]) {
    const out = await createConnectionTester({
      fetch: async () => new Response("secret error body", { status }),
    })("deepseek", "key");
    assert.equal(out.code, code);
    assert.equal(out.status, status);
    assert.doesNotMatch(JSON.stringify(out), /secret error/);
  }
});
test("Unknown providers and empty keys do not issue requests", async () => {
  let calls = 0;
  const t = createConnectionTester({
    fetch: async () => {
      calls++;
      return new Response("ok");
    },
  });
  assert.equal((await t("unknown", "key")).code, "UNKNOWN_PROVIDER");
  assert.equal((await t("supadata", " ")).code, "NO_KEY");
  assert.equal(calls, 0);
});
test("Network errors and timeouts have safe, credential-free feedback", async () => {
  const network = await createConnectionTester({
    fetch: async () => {
      throw new Error("do not echo key");
    },
  })("supadata", "key");
  assert.equal(network.code, "NETWORK_ERROR");
  const timed = await createConnectionTester({
    timeoutMs: 1,
    fetch: async (_, opts) =>
      new Promise((resolve, reject) =>
        opts.signal.addEventListener("abort", () => reject(new Error("abort"))),
      ),
  })("deepseek", "key");
  assert.equal(timed.code, "TIMEOUT");
});
test("Chrome options in a normal extension tab are trusted and can save settings", async () => {
  const app = await application();
  let handler;
  const listener = { addListener() {} };
  globalThis.chrome = {
    runtime: {
      id: "owned-id",
      getURL: (p) => "chrome-extension://owned-id/" + p,
      onInstalled: listener,
      onMessage: {
        addListener: (fn) => {
          handler = fn;
        },
      },
      sendMessage: async () => {},
      openOptionsPage() {},
    },
    action: { onClicked: listener },
    storage: { local: { setAccessLevel: async () => {} } },
    sidePanel: {
      setPanelBehavior() {},
      setOptions: async () => {},
      open: async () => {},
    },
    tabs: { onUpdated: listener, onActivated: listener },
  };
  mountWorker(app.application);
  const sender = {
    id: "owned-id",
    url: "chrome-extension://owned-id/options.html",
    tab: { id: 1, url: "chrome-extension://owned-id/options.html" },
  };
  const out = await new Promise((resolve) =>
    handler(
      {
        action: "configurationSet",
        value: {
          ytd_settings: {
            aiApiKey: "saved-by-options",
            supadataApiKey: "caption-key",
          },
        },
      },
      sender,
      resolve,
    ),
  );
  assert.equal(out.success, true);
  assert.equal((await app.config.read()).aiApiKey, "saved-by-options");
  const denied = await new Promise((resolve) =>
    handler(
      { action: "configurationGet", keys: ["ytd_settings"] },
      {
        ...sender,
        url: "https://www.youtube.com/watch?v=videoA00001",
        tab: { id: 1, url: "https://www.youtube.com/watch?v=videoA00001" },
      },
      resolve,
    ),
  );
  assert.equal(denied.success, false);
  delete globalThis.chrome;
});
test("Extension-origin prefix lookalikes do not gain trusted access", async () => {
  let handler, seen;
  const listener = { addListener() {} };
  globalThis.chrome = {
    runtime: {
      id: "owned-id",
      getURL: (p) => "chrome-extension://owned-id/" + p,
      onInstalled: listener,
      onMessage: {
        addListener: (fn) => {
          handler = fn;
        },
      },
    },
    action: { onClicked: listener },
    storage: { local: { setAccessLevel: async () => {} } },
    sidePanel: { setPanelBehavior() {} },
    tabs: { onUpdated: listener, onActivated: listener },
  };
  mountWorker({
    dispatch: async (_, context) => {
      seen = context;
      return { success: false };
    },
  });
  await new Promise((resolve) =>
    handler(
      { action: "configurationGet" },
      { id: "owned-id", url: "chrome-extension://owned-id.evil/options.html" },
      resolve,
    ),
  );
  assert.equal(seen.trusted, false);
  delete globalThis.chrome;
});
