/** Position belongs to this side-panel session, never to the vocabulary database.
 * Pointer capture keeps dragging reliable when the pointer leaves the title bar.
 */
export function mountVocabularyDialogPosition(
  dialog: HTMLDialogElement,
  heading: HTMLElement,
) {
  const gutter = 8;
  let position: { x: number; y: number } | null = null;
  let drag: {
    id: number;
    x: number;
    y: number;
    left: number;
    top: number;
  } | null = null;

  function constrain() {
    if (!position || !dialog.open) return;
    const rect = dialog.getBoundingClientRect();
    position.x = Math.max(
      gutter,
      Math.min(position.x, window.innerWidth - rect.width - gutter),
    );
    position.y = Math.max(
      gutter,
      Math.min(position.y, window.innerHeight - rect.height - gutter),
    );
    dialog.style.inset = "auto";
    dialog.style.margin = "0";
    dialog.style.left = `${position.x}px`;
    dialog.style.top = `${position.y}px`;
  }
  function reset() {
    position = null;
    for (const property of ["inset", "margin", "left", "top"])
      dialog.style.removeProperty(property);
  }
  function endDrag() {
    const previous = drag;
    drag = null;
    delete heading.dataset.dragging;
    if (previous && heading.hasPointerCapture(previous.id))
      heading.releasePointerCapture(previous.id);
  }
  heading.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.isPrimary === false || drag) return;
    // Buttons retain their normal click/focus behavior; only the title area drags.
    if ((event.target as Element).closest("button, input, a")) return;
    const rect = dialog.getBoundingClientRect();
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: rect.left,
      top: rect.top,
    };
    heading.setPointerCapture(event.pointerId);
    heading.dataset.dragging = "true";
    heading.focus({ preventScroll: true });
    event.preventDefault();
  });
  heading.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    position = {
      x: drag.left + event.clientX - drag.x,
      y: drag.top + event.clientY - drag.y,
    };
    constrain();
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    heading.addEventListener(type, endDrag);
  heading.addEventListener("dblclick", (event) => {
    if (!(event.target as Element).closest("button, input, a")) reset();
  });
  // Keyboard users can reposition the same window without needing a mouse.
  heading.addEventListener("keydown", (event) => {
    if (event.target !== heading) return;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-16, 0],
      ArrowRight: [16, 0],
      ArrowUp: [0, -16],
      ArrowDown: [0, 16],
    };
    if (event.key === "Home") {
      reset();
      event.preventDefault();
      return;
    }
    if (!delta[event.key]) return;
    const rect = dialog.getBoundingClientRect();
    const [x, y] = delta[event.key];
    position = { x: rect.left + x, y: rect.top + y };
    constrain();
    event.preventDefault();
  });
  dialog.addEventListener("close", endDrag);
  window.addEventListener("resize", constrain);
  return constrain;
}
