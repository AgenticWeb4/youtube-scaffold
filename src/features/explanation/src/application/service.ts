import type { ModelPort } from "@ys/shared";

export function createExplanationService(model: {
  explain(...args: any[]): Promise<any>;
}) {
  return {
    async explain(input: {
      selectedText: string;
      transcriptContext: string;
      videoTitle: string;
    }) {
      if (!input.selectedText?.trim())
        return { success: false, error: "Empty selection" };
      return model.explain(
        input.selectedText,
        input.transcriptContext,
        input.videoTitle,
      );
    },
  };
}
export type Explanation = ReturnType<typeof createExplanationService>;
