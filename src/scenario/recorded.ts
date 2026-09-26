// Real model answers recorded with `npm run record` (see scripts/record.ts).
// Served when no live LLM is available, labelled "기록된 실제 LLM 응답" with model and date.

import data from "./recorded.json";

export interface Recording {
  raw: unknown;
  model: string;
  recordedAt: string;
}

interface Store {
  judge: (Recording & { scenario: string; note: string })[];
  llmOnly: (Recording & { key: string; name: string })[];
}

const store = data as Store;

export function recordedJudgment(scenario: string, note: string): Recording | undefined {
  return store.judge.find((r) => r.scenario === scenario && r.note === note.trim());
}

/** `key` comes from llmOnlyKey() in ./types (it includes the scenario id). */
export function recordedLLMOnly(key: string): Recording | undefined {
  return store.llmOnly.find((r) => r.key === key);
}
