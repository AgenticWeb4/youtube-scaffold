import { createExportService } from "./application/service.js";
import { createIndexedDbStore } from "./adapters/indexed-db.js";
export { createIndexedDbStore };
export { buildMarkdown } from "./domain/markdown.js";
/** Assembly preserves the synchronous folder-picker call needed for user activation. */
export function createExport(ports: any = {}) {
  const picker =
    ports.picker ||
    ((options: unknown) => {
      const pick = (globalThis as any).showDirectoryPicker;
      if (!pick) throw new Error("Folder selection requires desktop Chrome.");
      return pick(options);
    });
  return createExportService({
    ...ports,
    store: ports.store || createIndexedDbStore(),
    picker,
  });
}
export type Export = ReturnType<typeof createExport>;
