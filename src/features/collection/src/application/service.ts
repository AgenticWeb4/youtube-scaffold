import type { Caption, KVStore, ModelPort, Note, NoteInput } from "@ys/shared";

export function createCollectionService(ports: {
  polish(...args: string[]): Promise<string>;
  store: KVStore;
  canonicalUrl(id: string): string;
  clock?: () => number;
  uuid?: () => string;
}) {
  const polish = ports.polish;
  const now = ports.clock || Date.now;
  const uuid = ports.uuid || (() => crypto.randomUUID());
  let generation = 0;
  async function save(
    input: NoteInput,
    text: string,
    rawText: string,
    expected = generation,
  ) {
    const url = ports.canonicalUrl(input.videoId);
    const seconds = Math.max(0, Math.floor(Number(input.timestamp) || 0));
    const note: Note = {
      id: `note_${uuid()}`,
      videoId: input.videoId,
      videoTitle: String(input.videoTitle || "Untitled Video").slice(0, 500),
      channelName: String(input.channelName || "").slice(0, 300),
      timestamp: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
      timestampSeconds: seconds,
      timestampedUrl: `${url}&t=${seconds}s`,
      text: text.slice(0, 3000),
      rawText,
      createdAt: now(),
      operationId: input.operationId,
    };
    let saved = note;
    await ports.store.update<Note[]>("ytd_notes", (previous) => {
      if (expected !== generation)
        throw new Error("Collection was reset during capture");
      const notes = previous || [];
      const existing =
        input.operationId &&
        notes.find((item) => item.operationId === input.operationId);
      if (existing) {
        saved = existing;
        return notes;
      }
      return [note, ...notes].slice(0, 100);
    });
    return { success: true as const, note: saved };
  }
  return {
    async saveExact(input: NoteInput) {
      const text = String(input.selectedText || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 3000);
      if (!text) return { success: false as const, error: "Empty selection" };
      return save(input, text, text);
    },
    async saveMoment(input: NoteInput, transcript: Caption[]) {
      const expected = generation;
      if (!transcript.length)
        return { success: false as const, error: "No transcript content" };
      const at = Math.max(0, Math.floor(Number(input.timestamp) || 0));
      let index = transcript.findIndex(
        (line, i) =>
          line.start <= at &&
          (!transcript[i + 1] || transcript[i + 1].start > at),
      );
      if (index < 0)
        index = at < transcript[0].start ? 0 : transcript.length - 1;
      const before = transcript
        .slice(Math.max(0, index - 2), index)
        .map((line) => line.text)
        .join(" ");
      const after = transcript
        .slice(index + 1, index + 5)
        .map((line) => line.text)
        .join(" ");
      const context = transcript
        .slice(Math.max(0, index - 8), index + 13)
        .map((line) => line.text)
        .join(" ");
      const text = await polish(
        transcript[index].text,
        before,
        after,
        context,
        input.videoTitle || "",
      );
      return save(input, text, transcript[index].text, expected);
    },
    async list(videoId?: string | null) {
      const notes = (await ports.store.get<Note[]>("ytd_notes")) || [];
      return {
        success: true as const,
        notes: videoId
          ? notes.filter((note) => note.videoId === videoId)
          : notes,
      };
    },
    async delete(noteId: string) {
      await ports.store.update<Note[]>("ytd_notes", (old) =>
        (old || []).filter((note) => note.id !== noteId),
      );
      return { success: true as const };
    },
    async clear() {
      generation += 1;
      await ports.store.remove("ytd_notes");
      return { success: true as const };
    },
  };
}
export type Collection = ReturnType<typeof createCollectionService>;
