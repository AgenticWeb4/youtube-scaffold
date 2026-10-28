import { wordMatches } from "../domain/word-matches.js";
import type {
  Caption,
  Material,
  KVStore,
  ModelPort,
  Segment,
  DisplayMode,
  SelectionSnapshot,
} from "@ys/shared";
import {
  groupTranscriptEntries,
  splitOversizedThought,
  findLiteralTranscriptMatches,
} from "../domain/segments.js";

export type Reading = ReturnType<typeof createReadingService>;
export function createReadingService(ports: {
  store: KVStore;
  session: KVStore;
  source?: { fetchTranscript(id: string): Promise<any> };
  clock?: () => number;
}) {
  const now = ports.clock || Date.now;
  const source = ports.source || null;
  const pending = new Map<string, Promise<any>>();
  const prefix = "ys_reading_";
  let generation = 0;
  async function read(id: string): Promise<Material | null> {
    const value = await ports.store.get<Material>(prefix + id);
    if (!value) return null;
    if (now() - value.timestamp > 30 * 86400000) {
      await ports.store.remove(prefix + id);
      return null;
    }
    return value;
  }
  async function save(id: string, value: Partial<Material>) {
    if (!id || !Array.isArray(value.transcript))
      throw new Error("Invalid material");
    return ports.store.update<Material>(prefix + id, (old) => ({
      transcript: value.transcript!.map((item) => ({
        text: String(item.text),
        start: Math.max(0, Number(item.start) || 0),
        duration: Math.max(0, Number(item.duration) || 0),
        language: item.language || null,
      })),
      transcriptText: String(value.transcriptText || ""),
      transcriptTimestamped: String(value.transcriptTimestamped || ""),
      transcriptLanguage: value.transcriptLanguage || null,
      videoTitle: String(value.videoTitle || old?.videoTitle || ""),
      channelName: String(value.channelName || old?.channelName || ""),
      timestamp: now(),
    }));
  }
  const viewKeys = new Set([
    "ytd_transcript_view_state",
    "ytd_display_language_modes_by_video",
  ]);
  const viewStorage = {
    async get(key: string) {
      if (!viewKeys.has(key)) throw new Error("Unknown reading state");
      const area =
        key === "ytd_transcript_view_state" ? ports.session : ports.store;
      return { [key]: await area.get(key) };
    },
    async set(values: Record<string, unknown>) {
      for (const [key, value] of Object.entries(values)) {
        if (!viewKeys.has(key) || !value || typeof value !== "object")
          throw new Error("Invalid reading state");
        const area =
          key === "ytd_transcript_view_state" ? ports.session : ports.store;
        await area.update<Record<string, any>>(key, (old) =>
          Object.fromEntries(
            Object.entries({ ...old, ...value })
              .sort(([, a], [, b]) => (b.updatedAt || 0) - (a.updatedAt || 0))
              .slice(0, key === "ytd_transcript_view_state" ? 20 : 50),
          ),
        );
      }
    },
  };
  function context(entries: Caption[], at: number) {
    let index = entries.findIndex(
      (entry, i) =>
        entry.start <= at && (!entries[i + 1] || entries[i + 1].start > at),
    );
    if (index < 0) index = entries.length ? 0 : -1;
    return index < 0
      ? ""
      : entries
          .slice(Math.max(0, index - 2), index + 5)
          .map((entry) => entry.text)
          .join(" ");
  }
  return {
    wordMatches: (
      text: string,
      terms: Map<string, string>,
    ): { start: number; end: number; entryId: string }[] =>
      wordMatches(text, terms),
    /** Freeze the exact displayed source group before async capture or navigation. */
    vocabularyContext(
      entries: Caption[],
      segmentId: string | undefined,
      at: number,
    ) {
      const groups = groupTranscriptEntries(entries);
      const group =
        groups.find((g: Segment) => g.id === segmentId) ||
        groups.find((g: Segment) => g.start === at);
      if (!group) throw new Error("转写片段已变化，请重新选词");
      return {
        sentenceEn: group.text,
        startMs: Math.round(group.start * 1000),
      };
    },
    read,
    save,
    viewStorage,
    async load(id: string) {
      const expected = generation;
      const existing = await read(id);
      if (expected !== generation)
        return {
          success: false,
          error: "Reading data was reset during acquisition",
        };
      if (existing)
        return {
          success: true,
          transcript: existing.transcript,
          transcriptText: existing.transcriptText,
          transcriptTextTimestamped: existing.transcriptTimestamped,
          language: existing.transcriptLanguage,
        };
      if (!source)
        return { success: false, error: "Material source unavailable" };
      if (!pending.has(id)) {
        const operation = source.fetchTranscript(id).then(async (result) => {
          if (expected !== generation)
            return {
              success: false,
              error: "Reading data was reset during acquisition",
            };
          if (result.success && result.transcript?.length)
            await save(id, {
              transcript: result.transcript,
              transcriptText: result.transcriptText,
              transcriptTimestamped: result.transcriptTextTimestamped,
              transcriptLanguage: result.language,
            });
          return result;
        });
        const tracked = operation.finally(() => {
          if (pending.get(id) === tracked) pending.delete(id);
        });
        pending.set(id, tracked);
      }
      return pending.get(id)!;
    },
    groupTranscriptEntries: (entries: Caption[], limits?: any): Segment[] =>
      groupTranscriptEntries(entries, limits),
    splitOversizedThought: (text: string, maxChars: number): string[] =>
      splitOversizedThought(text, maxChars),
    normalizeCaptionText: (text: string): string =>
      String(text || "")
        .replace(/\s+/g, " ")
        .trim(),
    findLiteralTranscriptMatches: (
      text: string,
      query: string,
    ): { start: number; end: number }[] =>
      findLiteralTranscriptMatches(text, query),
    context,
    selection(
      origin: string,
      displayText: string,
      at: number,
      displayRole: SelectionSnapshot["displayRole"],
      entries: Caption[],
      unitId?: string,
    ): SelectionSnapshot {
      return {
        origin,
        displayText,
        displayRole,
        anchor: { seconds: at, unitId, precision: "segment" },
        context: context(entries, at),
      };
    },
    async evict(max = 20) {
      const keys = await ports.store.keys(prefix);
      const records = await Promise.all(
        keys.map(async (key) => ({
          key,
          time: (await ports.store.get<Material>(key))?.timestamp || 0,
        })),
      );
      const sorted = records
        .filter((item) => now() - item.time <= 30 * 86400000)
        .sort((a, b) => b.time - a.time);
      const keep = new Set(sorted.slice(0, max).map((item) => item.key));
      const removed = keys.filter((key) => !keep.has(key));
      await ports.store.remove(removed);
      return removed.map((key) => key.slice(prefix.length));
    },
    async clear() {
      generation += 1;
      pending.clear();
      const keys = await ports.store.keys(prefix);
      await ports.store.remove(keys);
      return keys.length;
    },
    async resetView() {
      await ports.session.remove("ytd_transcript_view_state");
      await ports.store.remove([
        "ytd_transcript_view_state",
        "ytd_display_language_modes_by_video",
      ]);
    },
  };
}
export type { DisplayMode };
