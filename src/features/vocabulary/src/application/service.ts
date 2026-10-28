import {
  validateCapture,
  type Capture,
  type Card,
  type Example,
} from "../domain/entry.js";

/** The repository owns atomic mutations; the application never imports Dexie. */
export interface VocabularyRepository {
  add(
    input: Capture,
  ): Promise<{ entryId: string; example: Example; duplicate: boolean }>;
  list(): Promise<Card[]>;
  getExample(id: string): Promise<Example | undefined>;
  translate(id: string, text: string): Promise<boolean>;
  removeEntry(id: string): Promise<void>;
  removeExample(id: string): Promise<void>;
  clear(): Promise<void>;
}
export function createVocabulary(repository: VocabularyRepository) {
  return {
    capture: (input: Capture) => repository.add(validateCapture(input)),
    list: () => repository.list(),
    example: (id: string) => repository.getExample(id),
    completeTranslation: (id: string, text: string) =>
      repository.translate(id, text),
    removeEntry: (id: string) => repository.removeEntry(id),
    removeExample: (id: string) => repository.removeExample(id),
    clear: () => repository.clear(),
  };
}
export type Vocabulary = ReturnType<typeof createVocabulary>;
