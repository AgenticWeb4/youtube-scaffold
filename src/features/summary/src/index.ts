import { createSummaryService } from "./application/service.js";
import { createSummaryModel } from "./adapters/model.js";
import type { ModelPort, KVStore } from "@ys/shared";
export function createSummary(ports: { model: ModelPort; store: KVStore }) {
  return createSummaryService({
    ...ports,
    model: createSummaryModel(ports.model),
  });
}
export type Summary = ReturnType<typeof createSummary>;
