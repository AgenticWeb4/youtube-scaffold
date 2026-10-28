import { createTranslationService } from "./application/service.js";
import { createTranslationModel } from "./adapters/model.js";
import type { ModelPort, KVStore } from "@ys/shared";
export function createTranslation(ports: { model: ModelPort; store: KVStore }) {
  return createTranslationService({
    ...ports,
    model: createTranslationModel(ports.model),
  });
}
export type Translation = ReturnType<typeof createTranslation>;
