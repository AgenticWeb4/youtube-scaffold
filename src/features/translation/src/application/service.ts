import type { KVStore, ModelPort } from "@ys/shared";
import { alignTranslatedSegmentBatch } from "../domain/alignment.js";

export function createTranslationService(ports: {
  model: {
    translate(...args: any[]): Promise<any>;
    validate(value: any): any;
    normalize(...args: any[]): any;
  };
  store: KVStore;
}) {
  const model = ports.model;
  const strings = (value: unknown): Record<string, string> =>
    Object.fromEntries(
      Object.entries(value && typeof value === "object" ? value : {}).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  return {
    translate(input: {
      content: unknown;
      contentType: string;
      targetLanguage: string;
      videoTitle: string;
    }) {
      return model.translate(
        input.content,
        input.contentType,
        input.targetLanguage,
        input.videoTitle,
      );
    },
    align: (
      source: { id: string; text: string }[],
      result: unknown,
    ): { id: string; text: string; error: string }[] =>
      alignTranslatedSegmentBatch(source, result),
    async read(id: string) {
      return (
        (await ports.store.get<{
          paragraphCache: Record<string, string>;
          interfaceCache: Record<string, string>;
        }>("ys_translation_" + id)) || {
          paragraphCache: {},
          interfaceCache: {},
        }
      );
    },
    async save(
      id: string,
      value: { paragraphCache?: unknown; interfaceCache?: unknown },
    ) {
      await ports.store.update<{
        paragraphCache: Record<string, string>;
        interfaceCache: Record<string, string>;
      }>("ys_translation_" + id, (old) => ({
        paragraphCache: {
          ...old?.paragraphCache,
          ...strings(value.paragraphCache),
        },
        interfaceCache: {
          ...old?.interfaceCache,
          ...strings(value.interfaceCache),
        },
      }));
      return { success: true as const };
    },
    async remove(ids: string[]) {
      await ports.store.remove(ids.map((id) => "ys_translation_" + id));
      return { success: true as const };
    },
    async clear() {
      await ports.store.remove(await ports.store.keys("ys_translation_"));
      return { success: true as const };
    },
    validate: model.validate,
    normalize: model.normalize,
  };
}
export type Translation = ReturnType<typeof createTranslationService>;
