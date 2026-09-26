// Real model answers recorded with `npm run record` (see scripts/record.ts).
// Served when no live LLM is available, labelled "기록된 실제 AI 응답" with model and date.

import data from "./recorded.json";

export interface Recording {
  raw: unknown;
  model: string;
  recordedAt: string;
}

interface Store {
  judge: (Recording & { note: string })[];
  llmOnly: (Recording & { key: string })[];
}

const store = data as Store;

export function recordedJudgment(note: string): Recording | undefined {
  return store.judge.find((r) => r.note === note.trim());
}

/** Same input and rule values → same key. */
export function llmOnlyKey(input: Record<string, string>, settings: { threshold: number; windowHours: number }): string {
  const fields = ["pressure", "pressure_limit", "evaluation_time", "alarm_history", "maintenance_note"];
  return JSON.stringify({ input: fields.map((f) => (input[f] ?? "").trim()), settings: [settings.threshold, settings.windowHours] });
}

export function recordedLLMOnly(key: string): Recording | undefined {
  return store.llmOnly.find((r) => r.key === key);
}
