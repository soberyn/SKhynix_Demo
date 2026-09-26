// A scenario = one domain shown with the same engine and the same screen.
// It declares its inputs, rule values, graph, policy text and missions; the UI and the API are generic over it.

import type { LLMJudgment, RuleFunctions } from "@/core/resolvers";
import type { JudgmentGraph, Override } from "@/core/types";

/** A prepared text for the LLM node, with a written answer used only when no live or recorded answer exists. */
export interface NotePreset {
  id: string;
  label: string;
  text: string;
  prepared: LLMJudgment;
}

export type FieldSpec =
  | { kind: "number"; key: string; label: string; unit?: string; slider?: { min: number; max: number; step: number } }
  | { kind: "text"; key: string; label: string; hint?: string }
  | { kind: "toggle"; key: string; label: string; hint?: string }
  /** A list of lines, each switchable on/off; the input value is the checked lines joined by newlines. */
  | { kind: "lines"; key: string; label: string; hint?: string; add?: { label: string; placeholder: string; template: (v: string) => string } }
  /** Free text read by the LLM node: prepared variants or custom text. */
  | { kind: "note"; key: string; label: string; hint?: string; presets: NotePreset[] };

export interface SettingSpec {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
}

export type Settings = Record<string, number>;

/** What the user edits; the engine input is derived from it. */
export interface Draft {
  values: Record<string, string>;
  lines: Record<string, { text: string; on: boolean }[]>;
  notes: Record<string, { presetId: string; custom: string }>;
  settings: Settings;
}

export interface Mission {
  id: string;
  title: string;
  /** What the mission changed, shown before the user applies it. */
  what: string;
  apply: (d: Draft) => { draft: Draft; overrides?: Record<string, Override> };
  benefit: string;
  llmOnly: string;
}

export interface Scenario {
  id: string;
  /** Short name for the scenario switcher. */
  name: string;
  /** One line under the name, e.g. "원래 문제" / "다른 도메인 적용". */
  role: string;
  disclaimer: string;
  fields: FieldSpec[];
  settings: SettingSpec[];
  defaultSettings: Settings;
  buildGraph: (settings: Settings) => JudgmentGraph;
  functions: RuleFunctions;
  /** The policy in plain language, given verbatim to LLM-only mode so both approaches see the same rules. */
  policyText: (settings: Settings) => string;
  /** The allowed final actions (LLM-only output is validated against these). */
  actions: string[];
  /** Short context for LLM-only mode (what the data is about). */
  llmOnlyRole: string;
  exampleDraft: Draft;
  missions: Mission[];
}

// ---------- helpers shared by the UI, the API and the scripts ----------

export function noteText(s: Scenario, d: Draft, key: string): string {
  const field = s.fields.find((f) => f.key === key);
  const n = d.notes[key];
  if (!field || field.kind !== "note" || !n) return "";
  return n.presetId === "custom" ? n.custom : (field.presets.find((p) => p.id === n.presetId)?.text ?? "");
}

export function toInput(s: Scenario, d: Draft): Record<string, string> {
  const input: Record<string, string> = {};
  for (const f of s.fields) {
    if (f.kind === "lines") input[f.key] = (d.lines[f.key] ?? []).filter((l) => l.on).map((l) => l.text).join("\n");
    else if (f.kind === "note") input[f.key] = noteText(s, d, f.key);
    else input[f.key] = d.values[f.key] ?? "";
  }
  return input;
}

/** Keeps user-entered rule values in their declared range. */
export function clampSettings(s: Scenario, raw: Record<string, unknown> | undefined): Settings {
  const out: Settings = {};
  for (const spec of s.settings) {
    const n = Number(raw?.[spec.key]);
    const v = Number.isFinite(n) ? n : s.defaultSettings[spec.key];
    out[spec.key] = Math.min(spec.max, Math.max(spec.min, v));
  }
  return out;
}

/** The prepared answer for exactly this text in any note field of the scenario. */
export function preparedFor(s: Scenario, text: string): LLMJudgment | undefined {
  for (const f of s.fields) if (f.kind === "note") {
    const p = f.presets.find((x) => x.text === text.trim());
    if (p) return p.prepared;
  }
  return undefined;
}

export function fieldLabel(s: Scenario, key: string): string {
  const f = s.fields.find((x) => x.key === key);
  if (!f) return key;
  return f.kind === "number" && f.unit ? `${f.label} (${f.unit})` : f.label;
}

/** Same scenario, input and rule values → same key (for recorded LLM-only answers). */
export function llmOnlyKey(s: Scenario, input: Record<string, string>, settings: Settings): string {
  return JSON.stringify({
    s: s.id,
    input: s.fields.map((f) => (input[f.key] ?? "").trim()),
    settings: s.settings.map((x) => settings[x.key]),
  });
}
