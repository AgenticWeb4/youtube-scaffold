/** A word owns independent source snapshots; transcript-cache eviction cannot erase them. */
export interface Entry {
  id: string;
  language: "en";
  term: string;
  normalizedTerm: string;
  createdAt: number;
}
export interface Example {
  id: string;
  entryId: string;
  videoId: string;
  videoTitle: string;
  sentenceEn: string;
  sentenceZh: string;
  startMs: number;
  translationStatus: "pending" | "ready" | "failed";
  createdAt: number;
}
export interface Capture {
  term: string;
  videoId: string;
  videoTitle: string;
  sentenceEn: string;
  sentenceZh?: string;
  startMs: number;
}
export interface Card extends Entry {
  examples: Example[];
}
export function normalizeTerm(value: string): string {
  return value.normalize("NFKC").replaceAll("’", "'").trim().toLowerCase();
}
export function validTerm(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length <= 80 &&
    /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/.test(value.trim())
  );
}
/** Keep lexical identity deterministic; no stemming or model inference. */
export function validateCapture(input: Capture): Capture {
  if (!input || !validTerm(input.term))
    throw new Error("请选择一个完整英文单词");
  if (!/^[A-Za-z0-9_-]{11}$/.test(input.videoId))
    throw new Error("视频来源无效");
  if (
    typeof input.sentenceEn !== "string" ||
    !input.sentenceEn.trim() ||
    input.sentenceEn.length > 4000
  )
    throw new Error("上下文片段无效或过长");
  const tokens = input.sentenceEn.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || [];
  if (!tokens.some((t) => normalizeTerm(t) === normalizeTerm(input.term)))
    throw new Error("单词必须来自英文原文");
  if (
    !Number.isSafeInteger(input.startMs) ||
    input.startMs < 0 ||
    input.startMs > 604800000
  )
    throw new Error("视频时间无效");
  return {
    ...input,
    term: input.term.trim(),
    videoTitle: String(input.videoTitle || "YouTube").slice(0, 500),
    sentenceZh:
      typeof input.sentenceZh === "string"
        ? input.sentenceZh.trim().slice(0, 8000)
        : "",
  };
}
