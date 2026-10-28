import { createExplanationService } from "./application/service.js";
import { createExplanationModel } from "./adapters/model.js";
import type { ModelPort } from "@ys/shared";
export function createExplanation(port: ModelPort) {
  return createExplanationService(createExplanationModel(port));
}
export type Explanation = ReturnType<typeof createExplanation>;
