import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import {
  createVocabulary,
  createVocabularyDatabase,
} from "../src/features/vocabulary/dist/index.js";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { assembleApplication } from "../src/apps/extension/dist/platform.js";
import { createMemoryStore } from "../src/modules/infrastructure/dist/index.js";

const root = path.resolve(import.meta.dirname, "..");
const artifact = path.join(root, "artifacts/preview");
await fs.mkdir(artifact, { recursive: true });
await build({
  entryPoints: [path.join(root, "src/apps/extension/src/preview.ts")],
  outfile: path.join(artifact, "preview.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome116",
  logLevel: "silent",
});
const counts = {
  source: 0,
  summary: 0,
  translation: 0,
  explanation: 0,
  collection: 0,
};
const content = Array.from({ length: 24 }, (_, i) => ({
  text: [
    "A useful conclusion begins with a clear question. We must understand how the evidence supports the claim.",
    "Assumptions determine when a conclusion holds. A surprising statistic can illustrate a point, but it is not always causal evidence.",
    "We can transfer a method to a new problem only after checking its conditions. Repeating a claim does not make the evidence stronger.",
  ][i % 3],
  offset: i * 20000,
  duration: 20000,
}));
const model = {
  getSettings: async () => ({
    provider: "deepseek",
    aiApiKey: "fixture",
    supadataApiKey: "fixture",
    aiBaseUrl: "https://api.deepseek.com",
    aiModel: "deepseek-v4-flash",
  }),
  async prompt(file, heading, values = {}) {
    return JSON.stringify({ file, heading, ...values });
  },
  async request(options) {
    const system = JSON.parse(options.messages[0].content);
    if (system.file === "translation.md") {
      counts.translation++;
      const values = JSON.parse(options.messages[1].content);
      return {
        text: JSON.stringify({
          segments: values.segments.map((s) => ({
            id: s.id,
            text: "结论依赖证据与假设。理解适用条件后，才能将方法迁移到其他问题。",
          })),
        }),
      };
    }
    if (system.file === "explain.md") {
      counts.explanation++;
      return {
        text: "Evidence is information used to support or challenge a claim. Its strength depends on how it was obtained.",
      };
    }
    if (system.file === "note-cleanup.md") {
      counts.collection++;
      return {
        text: JSON.stringify({
          quote: "Assumptions determine when a conclusion holds.",
        }),
      };
    }
    counts.summary++;
    return {
      text: JSON.stringify({
        chapters: [
          {
            title: "Questions and evidence",
            summary:
              "How evidence supports a conclusion and why assumptions matter.",
            timestampSeconds: 0,
          },
          {
            title: "Conditions and transfer",
            summary: "Check when a method holds before applying it elsewhere.",
            timestampSeconds: 380,
          },
        ],
        keyQuotes: [
          {
            quote: "Assumptions determine when a conclusion holds.",
            timestampSeconds: 20,
          },
          {
            quote: "Repeating a claim does not make the evidence stronger.",
            timestampSeconds: 40,
          },
        ],
        keyMoments: [0, 380],
      }),
    };
  },
};
const store = createMemoryStore();
const assembled = assembleApplication(store, createMemoryStore(), {
  vocabulary: createVocabulary(
    createVocabularyDatabase("ys_preview_server", { indexedDB, IDBKeyRange })
      .repository,
  ),
  model,
  configurationFetch: async () => Response.json({ fixture: true }),
  fetch: async () => {
    counts.source++;
    return Response.json({ lang: "en", content });
  },
});
await assembled.config.save({ aiApiKey: "fixture", supadataApiKey: "fixture" });
let seconds = 0;
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "POST" && url.pathname === "/api") {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
        if (Buffer.concat(chunks).length > 1024 * 1024)
          throw new Error("Request too large");
      }
      const message = JSON.parse(Buffer.concat(chunks));
      let value;
      if (message.action === "relayToContent") {
        const action = message.payload?.action;
        if (action === "getVideoInfo")
          value = {
            success: true,
            response: {
              title: "Learning from evidence and assumptions",
              channelName: "Fixture learning channel",
              duration: 480,
              description: "Synthetic data used only for browser verification.",
            },
          };
        else if (action === "getCurrentTime")
          value = {
            success: true,
            response: { currentTime: seconds, paused: true },
          };
        else if (action === "seekTo") {
          seconds = message.payload.seconds;
          value = { success: true, response: { success: true } };
        } else value = { success: true, response: { success: true } };
      } else
        value = await assembled.application.dispatch(message, {
          trusted: true,
        });
      res.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(value));
      return;
    }
    if (url.pathname === "/status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(counts));
      return;
    }
    const relative =
      url.pathname === "/"
        ? "sidepanel.html"
        : decodeURIComponent(url.pathname.slice(1));
    if (relative.includes("..") || path.isAbsolute(relative)) {
      res.writeHead(400);
      res.end();
      return;
    }
    const file =
      relative === "preview.js"
        ? path.join(artifact, "preview.js")
        : path.join(root, "dist/extension", relative);
    let data = await fs.readFile(file);
    if (relative.endsWith(".html"))
      data = Buffer.from(
        data
          .toString()
          .replace("</body>", '<script src="preview.js"></script></body>'),
      );
    const mime = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".png": "image/png",
      ".md": "text/plain",
    };
    res.writeHead(200, {
      "content-type":
        mime[path.extname(relative)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(data);
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(error.message);
  }
});
server.listen(Number(process.env.YS_PREVIEW_PORT || 49849), "127.0.0.1", () =>
  console.log(
    `Fixture-only preview: http://127.0.0.1:${server.address().port}`,
  ),
);
