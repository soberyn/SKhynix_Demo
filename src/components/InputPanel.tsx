"use client";

import { useState } from "react";
import type { Draft, FieldSpec, Scenario, SettingSpec } from "@/scenario/types";
import { noteText } from "@/scenario/types";
import s from "./demo.module.css";

/** Renders a scenario's input fields and rule values. Fields that differ from the last run are marked. */
export function InputPanel({
  scenario,
  draft,
  setDraft,
  changed,
}: {
  scenario: Scenario;
  draft: Draft;
  setDraft: (d: Draft) => void;
  changed: Set<string>;
}) {
  const mark = (key: string) => (changed.has(key) ? `${s.field} ${s.fieldChanged}` : s.field);
  const setValue = (key: string, v: string) => setDraft({ ...draft, values: { ...draft.values, [key]: v } });

  return (
    <>
      {scenario.fields.map((f) => (
        <Field key={f.key} f={f} scenario={scenario} draft={draft} setDraft={setDraft} setValue={setValue} className={mark(f.key)} />
      ))}

      {scenario.settings.length > 0 && (
        <fieldset className={`${mark("settings")} ${s.fieldset}`}>
          <legend className={s.fieldLabel}>
            규칙 값 <span className={s.fieldHint}>정책을 바꿔 보기</span>
          </legend>
          {scenario.settings.map((spec) => (
            <Stepper
              key={spec.key}
              spec={spec}
              value={draft.settings[spec.key]}
              onChange={(v) => setDraft({ ...draft, settings: { ...draft.settings, [spec.key]: v } })}
            />
          ))}
        </fieldset>
      )}
    </>
  );
}

function Field({
  f,
  scenario,
  draft,
  setDraft,
  setValue,
  className,
}: {
  f: FieldSpec;
  scenario: Scenario;
  draft: Draft;
  setDraft: (d: Draft) => void;
  setValue: (key: string, v: string) => void;
  className: string;
}) {
  const [newLine, setNewLine] = useState(f.kind === "lines" && f.add ? f.add.placeholder : "");
  const value = draft.values[f.key] ?? "";

  switch (f.kind) {
    case "number": {
      const n = Number(value);
      return (
        <div className={className}>
          <span className={s.fieldLabel}>
            {f.label} {f.unit && <span className={s.fieldHint}>({f.unit})</span>}
          </span>
          {f.slider ? (
            <div className={s.sliderRow}>
              <input
                type="range"
                min={f.slider.min}
                max={f.slider.max}
                step={f.slider.step}
                value={Number.isFinite(n) ? n : f.slider.min}
                onChange={(e) => setValue(f.key, e.target.value)}
                aria-label={`${f.label} 슬라이더`}
              />
              <input className={s.numBox} value={value} onChange={(e) => setValue(f.key, e.target.value)} aria-label={f.label} />
            </div>
          ) : (
            <input value={value} onChange={(e) => setValue(f.key, e.target.value)} aria-label={f.label} />
          )}
        </div>
      );
    }
    case "text":
      return (
        <label className={className}>
          <span className={s.fieldLabel}>
            {f.label} {f.hint && <span className={s.fieldHint}>{f.hint}</span>}
          </span>
          <input value={value} onChange={(e) => setValue(f.key, e.target.value)} />
        </label>
      );
    case "toggle":
      return (
        <div className={className}>
          <span className={s.fieldLabel}>
            {f.label} {f.hint && <span className={s.fieldHint}>{f.hint}</span>}
          </span>
          <div className={s.segment} role="radiogroup" aria-label={f.label}>
            {["예", "아니오"].map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={value === v}
                className={value === v ? s.segOnPlain : s.seg}
                onClick={() => setValue(f.key, v)}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      );
    case "lines": {
      const lines = draft.lines[f.key] ?? [];
      const setLines = (next: typeof lines) => setDraft({ ...draft, lines: { ...draft.lines, [f.key]: next } });
      return (
        <fieldset className={`${className} ${s.fieldset}`}>
          <legend className={s.fieldLabel}>
            {f.label} {f.hint && <span className={s.fieldHint}>{f.hint}</span>}
          </legend>
          {lines.map((l, i) => (
            <label key={i} className={s.checkRow}>
              <input
                type="checkbox"
                checked={l.on}
                onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))}
              />
              <span className={l.on ? undefined : s.strike}>{l.text}</span>
            </label>
          ))}
          {f.add && (
            <div className={s.addRow}>
              <input value={newLine} onChange={(e) => setNewLine(e.target.value)} aria-label={`${f.label} 추가`} />
              <button type="button" className={s.small} onClick={() => setLines([...lines, { text: f.add!.template(newLine), on: true }])}>
                {f.add.label}
              </button>
            </div>
          )}
        </fieldset>
      );
    }
    case "note": {
      const n = draft.notes[f.key] ?? { presetId: f.presets[0]?.id ?? "custom", custom: "" };
      const setNote = (next: typeof n) => setDraft({ ...draft, notes: { ...draft.notes, [f.key]: next } });
      return (
        <fieldset className={`${className} ${s.fieldset}`}>
          <legend className={s.fieldLabel}>
            {f.label} {f.hint && <span className={s.fieldHint}>{f.hint}</span>}
          </legend>
          <div className={s.segment} role="radiogroup" aria-label={`${f.label} 선택`}>
            {[...f.presets.map((p) => ({ id: p.id, label: p.label })), { id: "custom", label: "직접 입력" }].map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={n.presetId === o.id}
                className={n.presetId === o.id ? s.segOn : s.seg}
                onClick={() => setNote({ ...n, presetId: o.id })}
              >
                {o.label}
              </button>
            ))}
          </div>
          {n.presetId === "custom" ? (
            <>
              <textarea rows={5} maxLength={4000} value={n.custom} onChange={(e) => setNote({ ...n, custom: e.target.value })} />
              <p className={s.fieldNote}>직접 입력한 기록은 실제 LLM이 연결된 경우에만 판단됩니다.</p>
            </>
          ) : (
            <p className={s.notePreview}>{noteText(scenario, draft, f.key)}</p>
          )}
        </fieldset>
      );
    }
  }
}

function Stepper({ spec, value, onChange }: { spec: SettingSpec; value: number; onChange: (v: number) => void }) {
  return (
    <div className={s.stepper}>
      <span>{spec.label}</span>
      <div className={s.stepperCtl}>
        <button type="button" className={s.small} onClick={() => onChange(Math.max(spec.min, value - spec.step))} aria-label={`${spec.label} 줄이기`}>
          −
        </button>
        <b>
          {value}
          <span className={s.fieldHint}> {spec.unit}</span>
        </b>
        <button type="button" className={s.small} onClick={() => onChange(Math.min(spec.max, value + spec.step))} aria-label={`${spec.label} 늘리기`}>
          +
        </button>
      </div>
    </div>
  );
}
