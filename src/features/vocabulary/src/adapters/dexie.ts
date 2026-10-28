import { Dexie, type Table, type DexieOptions } from "dexie";
import {
  normalizeTerm,
  type Entry,
  type Example,
  type Capture,
} from "../domain/entry.js";
import type { VocabularyRepository } from "../application/service.js";

/** Open lazily in the extension origin, never in a YouTube content script.
 * Versioned stores contain only vocabulary; cache reset has no access to this DB.
 */
export function createVocabularyDatabase(
  name = "ys_vocabulary",
  options?: DexieOptions,
) {
  const db = new Dexie(name, options);
  db.version(1).stores({
    entries: "id, &[language+normalizedTerm], createdAt",
    examples: "id, entryId, &[entryId+videoId+startMs], createdAt",
  });
  const entries: Table<Entry, string> = db.table("entries");
  const examples: Table<Example, string> = db.table("examples");
  const repository: VocabularyRepository = {
    async add(input: Capture) {
      // One IndexedDB transaction also serializes competing tabs/worker instances.
      // The unique source identity makes repeated saves harmless without evicting history.
      return db.transaction("rw", entries, examples, async () => {
        const normalizedTerm = normalizeTerm(input.term);
        let entry = await entries
          .where("[language+normalizedTerm]")
          .equals(["en", normalizedTerm])
          .first();
        if (!entry) {
          entry = {
            id: crypto.randomUUID(),
            language: "en",
            term: normalizedTerm,
            normalizedTerm,
            createdAt: Date.now(),
          };
          await entries.add(entry);
        }
        const previous = await examples
          .where("[entryId+videoId+startMs]")
          .equals([entry.id, input.videoId, input.startMs])
          .first();
        if (previous) {
          if (!previous.sentenceZh && input.sentenceZh) {
            previous.sentenceZh = input.sentenceZh;
            previous.translationStatus = "ready";
            await examples.put(previous);
          }
          return { entryId: entry.id, example: previous, duplicate: true };
        }
        const example: Example = {
          id: crypto.randomUUID(),
          entryId: entry.id,
          videoId: input.videoId,
          videoTitle: input.videoTitle,
          sentenceEn: input.sentenceEn,
          sentenceZh: input.sentenceZh || "",
          startMs: input.startMs,
          translationStatus: input.sentenceZh ? "ready" : "pending",
          createdAt: Date.now(),
        };
        await examples.add(example);
        return { entryId: entry.id, example, duplicate: false };
      });
    },
    async list() {
      return db.transaction("r", entries, examples, async () => {
        const all = await examples.toArray();
        const byEntry = new Map<string, Example[]>();
        for (const example of all) {
          const group = byEntry.get(example.entryId) || [];
          group.push(example);
          byEntry.set(example.entryId, group);
        }
        return (await entries.orderBy("createdAt").reverse().toArray()).map(
          (entry) => ({
            ...entry,
            examples: (byEntry.get(entry.id) || []).sort(
              (a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id),
            ),
          }),
        );
      });
    },
    getExample: (id) => examples.get(id),
    async translate(id, text) {
      // Update only: a late model reply cannot resurrect a deleted entry/example.
      return db.transaction("rw", examples, async () => {
        const example = await examples.get(id);
        if (!example) return false;
        if (example.sentenceZh) return true;
        const translated = String(text || "")
          .trim()
          .slice(0, 8000);
        await examples.update(id, {
          sentenceZh: translated,
          translationStatus: translated ? "ready" : "failed",
        });
        return true;
      });
    },
    async removeEntry(id) {
      await db.transaction("rw", entries, examples, async () => {
        await examples.where("entryId").equals(id).delete();
        await entries.delete(id);
      });
    },
    async removeExample(id) {
      await db.transaction("rw", entries, examples, async () => {
        const example = await examples.get(id);
        if (!example) return;
        await examples.delete(id);
        if (!(await examples.where("entryId").equals(example.entryId).count()))
          await entries.delete(example.entryId);
      });
    },
    async clear() {
      await db.transaction("rw", entries, examples, async () => {
        await examples.clear();
        await entries.clear();
      });
    },
  };
  return { repository, close: () => db.close(), destroy: () => db.delete() };
}
