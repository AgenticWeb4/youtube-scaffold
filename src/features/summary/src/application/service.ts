import type { Analysis, KVStore, ModelPort, SummaryInput } from "@ys/shared";

export function createSummaryService(ports: {
  model: {
    analyze(...args: any[]): Promise<any>;
    validate(value: unknown, max: number): Analysis;
  };
  store: KVStore;
}) {
  const model = ports.model;
  const generation = new Map<string, number>();
  let epoch = 0;
  return {
    async analyze(input: SummaryInput) {
      const expected = epoch;
      const serial = (generation.get(input.videoId) || 0) + 1;
      generation.set(input.videoId, serial);
      const result = await model.analyze(
        input.transcriptText,
        input.videoTitle,
        input.channelName,
        input.videoDescription,
        input.videoDuration,
      );
      if (expected !== epoch || generation.get(input.videoId) !== serial)
        return { success: false, error: "Superseded summary" };
      return result;
    },
    validate: (value: unknown, maxSeconds: number): Analysis =>
      model.validate(value, maxSeconds),
    async read(id: string) {
      return (await ports.store.get<Analysis>("ys_summary_" + id)) || null;
    },
    async save(id: string, analysis: Analysis | null) {
      if (analysis)
        await ports.store.set(
          "ys_summary_" + id,
          model.validate(analysis, Number.MAX_SAFE_INTEGER),
        );
      return { success: true as const };
    },
    async remove(ids: string[]) {
      await ports.store.remove(ids.map((id) => "ys_summary_" + id));
      return { success: true as const };
    },
    async clear() {
      epoch += 1;
      await ports.store.remove(await ports.store.keys("ys_summary_"));
      generation.clear();
      return { success: true as const };
    },
  };
}
export type Summary = ReturnType<typeof createSummaryService>;
