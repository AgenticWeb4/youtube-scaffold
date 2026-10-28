export type DisplayMode = "original" | "zh" | "bilingual";
/** A selection identifies a displayed passage, not a guessed word-level alignment. */
export interface SelectionSnapshot {
  origin: string;
  displayText: string;
  displayRole: "source" | "translation" | "mixed";
  anchor: { seconds: number; unitId?: string; precision: "segment" };
  context: string;
}
export interface Caption {
  text: string;
  start: number;
  duration: number;
  language?: string | null;
}
export interface Segment {
  id: string;
  start: number;
  text: string;
  texts?: string[];
}
export interface Material {
  transcript: Caption[];
  transcriptText: string;
  transcriptTimestamped: string;
  transcriptLanguage: string | null;
  videoTitle: string;
  channelName: string;
  timestamp: number;
}
export interface Chapter {
  title: string;
  summary: string;
  timestampSeconds: number;
  timestamp: string;
}
export interface Quote {
  quote: string;
  timestampSeconds: number;
  timestamp: string;
}
export interface Analysis {
  chapters: Chapter[];
  keyQuotes: Quote[];
  keyMoments: number[];
}
export interface Note {
  id: string;
  videoId: string;
  videoTitle: string;
  channelName: string;
  timestamp: string;
  timestampSeconds: number;
  timestampedUrl: string;
  text: string;
  rawText: string;
  createdAt: number;
  operationId?: string;
}
export interface NoteInput {
  videoId: string;
  timestamp: number;
  videoTitle?: string;
  channelName?: string;
  selectedText?: string;
  operationId?: string;
}
export interface Config {
  provider: string;
  aiApiKey: string;
  aiBaseUrl: string;
  aiModel: string;
  supadataApiKey: string;
}
export interface KVStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  update<T>(key: string, change: (old: T | undefined) => T): Promise<T>;
  keys(prefix?: string): Promise<string[]>;
  remove(keys: string | string[]): Promise<void>;
}
export interface ModelPort {
  getSettings(): Promise<Config>;
  prompt(
    file: string,
    heading: string,
    values?: Record<string, unknown>,
  ): Promise<string>;
  request(options: {
    messages: { role: string; content: string }[];
    maxTokens: number;
    temperature?: number;
    responseFormat?: { type: string };
  }): Promise<{ text: string }>;
}
export type Failure = {
  success: false;
  error: string;
  message?: string;
  code?: string;
};
export type RemoteMessage = {
  action: string;
  __ys_requestId?: string;
  [key: string]: unknown;
};
export type Remote = (message: RemoteMessage) => Promise<any>;
export type Trace = {
  requestId: string;
  actionId: string;
  flow: string;
  causedBy: string;
  rule: string;
  objectId: string;
  emittedCalls: string[];
  phase: "started" | "completed" | "failed";
  at: number;
  error?: string;
};
export interface CacheSnapshot extends Material {
  analysis: Analysis | null;
  paragraphCache: Record<string, string>;
  interfaceCache: Record<string, string>;
}
export interface SummaryInput {
  videoId: string;
  transcriptText: string;
  videoTitle?: string;
  channelName?: string;
  videoDescription?: string;
  videoDuration?: number;
}
