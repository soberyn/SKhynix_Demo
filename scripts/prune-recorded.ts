// Removes recordings that no longer match any current input (e.g. after a preset text was edited).
import { readFileSync, writeFileSync } from "node:fs";
import { SCENARIOS } from "../src/scenario";
import { llmOnlyKey, toInput } from "../src/scenario/types";

const FILE = new URL("../src/scenario/recorded.json", import.meta.url);
const store = JSON.parse(readFileSync(FILE, "utf8"));
const notes = new Set(SCENARIOS.flatMap((sc) => sc.fields.flatMap((f) => (f.kind === "note" ? f.presets.map((p) => `${sc.id}\u0000${p.text}`) : []))));
const keys = new Set(
  SCENARIOS.flatMap((sc) =>
    [sc.exampleDraft, ...sc.missions.map((m) => m.apply(sc.exampleDraft).draft), ...sc.cases.map((c) => c.apply(sc.exampleDraft))].map((d) =>
      llmOnlyKey(sc, toInput(sc, d), d.settings),
    ),
  ),
);
const before = [store.judge.length, store.llmOnly.length];
store.judge = store.judge.filter((r: { scenario: string; note: string }) => notes.has(`${r.scenario}\u0000${r.note}`));
store.llmOnly = store.llmOnly.filter((r: { key: string }) => keys.has(r.key));
writeFileSync(FILE, JSON.stringify(store, null, 2) + "\n");
console.log(`judge ${before[0]} → ${store.judge.length}, llmOnly ${before[1]} → ${store.llmOnly.length}`);
