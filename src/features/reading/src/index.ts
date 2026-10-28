import { createReadingService } from "./application/service.js";
import { createCaptionSource } from "./adapters/source.js";
import type { ModelPort, KVStore } from "@ys/shared";
export function createReading(ports: {
  store: KVStore;
  session: KVStore;
  clock?: () => number;
  source?: {
    getSettings: ModelPort["getSettings"];
    canonicalUrl(id: string): string;
    fetch?: typeof fetch;
  };
}) {
  return createReadingService({
    ...ports,
    source: ports.source ? createCaptionSource(ports.source) : undefined,
  });
}
export type Reading = ReturnType<typeof createReading>;
