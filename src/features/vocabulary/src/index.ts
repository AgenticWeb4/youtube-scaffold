export {
  createVocabulary,
  type Vocabulary,
  type VocabularyRepository,
} from "./application/service.js";
export type { Capture, Entry, Example, Card } from "./domain/entry.js";
export { createVocabularyDatabase } from "./adapters/dexie.js";
