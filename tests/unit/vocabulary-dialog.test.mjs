import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { mountVocabularyDialogPosition } from "../../src/features/vocabulary/dist/presentation/dialog-position.js";

function setup(t) {
  const { document, window: domWindow } = parseHTML(
    '<dialog><div id="heading"><h2>单词本</h2><button>关闭</button></div></dialog>',
  );
  const previous = globalThis.window;
  const listeners = new Map();
  const viewport = {
    innerWidth: 600,
    innerHeight: 800,
    addEventListener: (type, fn) => listeners.set(type, fn),
  };
  globalThis.window = viewport;
  t.after(() => {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  });
  const dialog = document.querySelector("dialog");
  const heading = document.querySelector("#heading");
  dialog.open = true;
  let width = 300,
    height = 200;
  dialog.getBoundingClientRect = () => ({
    left: parseFloat(dialog.style.left) || 150,
    top: parseFloat(dialog.style.top) || 300,
    width,
    height,
  });
  const captured = new Set();
  heading.setPointerCapture = (id) => captured.add(id);
  heading.hasPointerCapture = (id) => captured.has(id);
  heading.releasePointerCapture = (id) => captured.delete(id);
  heading.focus = () => {};
  const constrain = mountVocabularyDialogPosition(dialog, heading);
  const dispatch = (type, props = {}, target = heading) => {
    const event = new domWindow.Event(type, {
      bubbles: true,
      cancelable: true,
    });
    Object.assign(
      event,
      { button: 0, isPrimary: true, pointerId: 1, clientX: 200, clientY: 320 },
      props,
    );
    target.dispatchEvent(event);
    return event;
  };
  return {
    document,
    dialog,
    heading,
    viewport,
    captured,
    constrain,
    dispatch,
    resize(w, h, dw = width, dh = height) {
      viewport.innerWidth = w;
      viewport.innerHeight = h;
      width = dw;
      height = dh;
      listeners.get("resize")();
    },
  };
}

test("Vocabulary title drag follows the pointer, captures it and keeps the whole window in the viewport", (t) => {
  const { dialog, heading, captured, dispatch } = setup(t);
  dispatch("pointerdown");
  assert.equal(captured.has(1), true);
  assert.equal(heading.dataset.dragging, "true");
  dispatch("pointermove", { clientX: 300, clientY: 400 });
  assert.equal(dialog.style.left, "250px");
  assert.equal(dialog.style.top, "380px");
  dispatch("pointermove", { clientX: 0, clientY: 0, pointerId: 2 });
  assert.equal(dialog.style.left, "250px");
  dispatch("pointermove", { clientX: -999, clientY: -999 });
  assert.equal(dialog.style.left, "8px");
  assert.equal(dialog.style.top, "8px");
  dispatch("pointermove", { clientX: 9999, clientY: 9999 });
  assert.equal(dialog.style.left, "292px");
  assert.equal(dialog.style.top, "592px");
  dispatch("pointercancel");
  assert.equal(captured.size, 0);
  assert.equal(heading.dataset.dragging, undefined);
  dispatch("pointermove", { clientX: 100, clientY: 100 });
  assert.equal(dialog.style.top, "592px");
});

test("Vocabulary title controls and secondary pointers retain normal behavior", (t) => {
  const { document, dialog, captured, dispatch } = setup(t);
  const control = document.querySelector("button");
  let clicks = 0;
  control.addEventListener("click", () => clicks++);
  dispatch("pointerdown", {}, control);
  control.click();
  assert.equal(clicks, 1);
  assert.equal(captured.size, 0);
  dispatch("pointerdown", { button: 2 });
  dispatch("pointerdown", { isPrimary: false });
  assert.equal(captured.size, 0);
  dispatch("keydown", { key: "ArrowDown" }, control);
  assert.equal(dialog.style.top || "", "");
});

test("Vocabulary keyboard positioning, viewport/content resizing and centering keep the title reachable", (t) => {
  const { dialog, heading, constrain, dispatch, resize } = setup(t);
  dispatch("keydown", { key: "ArrowDown" });
  assert.equal(dialog.style.top, "316px");
  resize(320, 240, 296, 200);
  assert.equal(dialog.style.left, "16px");
  assert.equal(dialog.style.top, "32px");
  resize(320, 240, 296, 224);
  constrain();
  assert.equal(dialog.style.top, "8px");
  dispatch("dblclick", {}, heading.querySelector("h2"));
  assert.ok(!dialog.style.left && !dialog.style.top);
  dispatch("keydown", { key: "ArrowLeft" });
  assert.equal(dialog.style.left, "16px");
  dispatch("keydown", { key: "Home" });
  assert.ok(!dialog.style.left && !dialog.style.top);
});
