import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
  mountActionIcons,
  renderActionIcon,
} from "../../src/modules/gateway/dist/icons.js";

const { document, MutationObserver } = parseHTML("<html><body></body></html>");
globalThis.document = document;
globalThis.MutationObserver = MutationObserver;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("Lucide controls preserve click behavior, text-based restoration and accessible state", async () => {
  document.body.innerHTML = '<button id="copyTranscriptBtn">Copy</button>';
  const button = document.querySelector("button");
  let clicks = 0;
  button.addEventListener("click", () => {
    clicks++;
  });
  const stop = mountActionIcons(document);
  assert.equal(button.textContent, "Copy");
  assert.equal(button.getAttribute("aria-label"), "Copy");
  assert.equal(button.querySelector("svg").getAttribute("aria-hidden"), "true");
  button.click();
  assert.equal(clicks, 1);
  const original = button.textContent;
  button.textContent = "Copied";
  await settle();
  assert.equal(button.title, "Copied");
  assert.match(button.dataset.iconRendered, /^success:/);
  button.textContent = original;
  await settle();
  assert.match(button.dataset.iconRendered, /^copy:/);
  assert.equal(button.querySelectorAll("svg").length, 1);
  stop();
});

test("Lazy feature controls and translated options acquire library icons", async () => {
  document.body.innerHTML = "";
  const stop = mountActionIcons(document);
  document.body.innerHTML =
    '<button class="selection-note-btn">Note</button><button data-i18n="testConnection">测试连接</button>';
  await settle();
  assert.equal(document.querySelectorAll("svg").length, 2);
  const note = document.querySelector(".selection-note-btn");
  note.textContent = "Saving...";
  await settle();
  assert.equal(note.getAttribute("aria-busy"), "true");
  assert.ok(note.classList.contains("ys-icon-busy"));
  note.textContent = "Error";
  await settle();
  assert.equal(note.getAttribute("aria-busy"), "false");
  assert.match(note.dataset.iconRendered, /^error:/);
  const connection = document.querySelector('[data-i18n="testConnection"]');
  connection.textContent = "Test connection";
  await settle();
  assert.equal(connection.getAttribute("aria-label"), "Test connection");
  stop();
});

test("Video overlay action uses the same Lucide icon and keeps the N shortcut discoverable", () => {
  const button = document.createElement("button");
  renderActionIcon(button, "bookmark", "Save note (N)");
  assert.equal(button.title, "Save note (N)");
  assert.ok(button.querySelector("svg"));
  renderActionIcon(button, "bookmark", "Saved");
  assert.match(button.dataset.iconRendered, /^success:/);
  renderActionIcon(button, "bookmark", "Save note (N)");
  assert.equal(button.textContent, "Save note (N)");
});
