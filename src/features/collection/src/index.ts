import { createCollectionService } from "./application/service.js";
import { createPolisher } from "./adapters/polish.js";
import type { ModelPort, KVStore } from "@ys/shared";
export function createCollection(ports: {
  model: ModelPort;
  store: KVStore;
  canonicalUrl(id: string): string;
  clock?: () => number;
  uuid?: () => string;
}) {
  return createCollectionService({
    ...ports,
    polish: createPolisher(ports.model),
  });
}
export type Collection = ReturnType<typeof createCollection>;
