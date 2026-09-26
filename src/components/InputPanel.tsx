"use client";

import { useState } from "react";
import { NOTE_PRESETS, type PolicySettings } from "@/scenario/equipment";
import s from "./demo.module.css";

export interface AlarmLine {
  text: string;
  on: boolean;
}

/** What the user edits. The engine input is derived from it. */
export interface Draft {
  pressure: string;
  pressure_limit: string;
  evaluation_time: string;
  alarms: AlarmLine[];
  noteId: string; // a NOTE_PRESETS id, or "custom"
  customNote: string;
  settings: PolicySettings;
}

export function noteText(d: Draft): string {
  return d.noteId === "custom" ? d.customNote : (NOTE_PRESETS.find((p) => p.id === d.noteId)?.text ?? "");
}

export function InputPanel({
  draft,
  setDraft,
  changed,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  /** Field keys that differ from the last applied run, for highlighting. */
  changed: Set<string>;
}) {
  const [newAlarmTime, setNewAlarmTime] = useState("2026-09-26 16:30");
  const mark = (key: string) => (changed.has(key) ? `${s.field} ${s.fieldChanged}` : s.field);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft({ ...draft, [key]: value });
  const setSetting = (key: keyof PolicySettings, value: number) =>
    setDraft({ ...draft, settings: { ...draft.settings, [key]: value } });

  const pressure = Number(draft.pressure);

  return (
    <>
      <div className={mark("pressure")}>
        <span className={s.fieldLabel}>
          챔버 압력 <span className={s.fieldHint}>(Pa)</span>
        </span>
        <div className={s.sliderRow}>
          <input
            type="range"
            min={5}
            max={15}
            step={0.1}
            value={Number.isFinite(pressure) ? pressure : 0}
            onChange={(e) => set("pressure", e.target.value)}
            aria-label="챔버 압력 슬라이더"
          />
          <input className={s.numBox} value={draft.pressure} onChange={(e) => set("pressure", e.target.value)} aria-label="챔버 압력" />
        </div>
      </div>

      <label className={mark("pressure_limit")}>
        <span className={s.fieldLabel}>
          압력 기준값 <span className={s.fieldHint}>(Pa)</span>
        </span>
        <input value={draft.pressure_limit} onChange={(e) => set("pressure_limit", e.target.value)} />
      </label>

      <label className={mark("evaluation_time")}>
        <span className={s.fieldLabel}>
          판단 시각 <span className={s.fieldHint}>YYYY-MM-DD HH:MM</span>
        </span>
        <input value={draft.evaluation_time} onChange={(e) => set("evaluation_time", e.target.value)} />
      </label>

      <fieldset className={`${mark("alarms")} ${s.fieldset}`}>
        <legend className={s.fieldLabel}>
          알람 이력 <span className={s.fieldHint}>체크한 알람만 반영</span>
        </legend>
        {draft.alarms.map((a, i) => (
          <label key={i} className={s.checkRow}>
            <input
              type="checkbox"
              checked={a.on}
              onChange={(e) => set("alarms", draft.alarms.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))}
            />
            <span className={a.on ? undefined : s.strike}>{a.text}</span>
          </label>
        ))}
        <div className={s.addRow}>
          <input value={newAlarmTime} onChange={(e) => setNewAlarmTime(e.target.value)} aria-label="추가할 알람 시각" />
          <button
            type="button"
            className={s.small}
            onClick={() => set("alarms", [...draft.alarms, { text: `${newAlarmTime.trim()} 압력 경고`, on: true }])}
          >
            + 압력 경고 추가
          </button>
        </div>
      </fieldset>

      <fieldset className={`${mark("note")} ${s.fieldset}`}>
        <legend className={s.fieldLabel}>
          정비 기록 <span className={s.fieldHint}>LLM이 읽는 유일한 입력</span>
        </legend>
        <div className={s.segment} role="radiogroup" aria-label="정비 기록 선택">
          {[...NOTE_PRESETS.map((p) => ({ id: p.id, label: p.label })), { id: "custom", label: "직접 입력" }].map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={draft.noteId === o.id}
              className={draft.noteId === o.id ? s.segOn : s.seg}
              onClick={() => set("noteId", o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
        {draft.noteId === "custom" ? (
          <>
            <textarea rows={5} maxLength={4000} value={draft.customNote} onChange={(e) => set("customNote", e.target.value)} />
            <p className={s.fieldNote}>직접 입력한 기록은 실제 LLM이 연결된 경우에만 판단됩니다.</p>
          </>
        ) : (
          <p className={s.notePreview}>{noteText(draft)}</p>
        )}
      </fieldset>

      <fieldset className={`${mark("settings")} ${s.fieldset}`}>
        <legend className={s.fieldLabel}>
          규칙 값 <span className={s.fieldHint}>정책을 바꿔 보기</span>
        </legend>
        <Stepper label="알람 기준 횟수" unit="회 이상" value={draft.settings.threshold} min={1} max={20} onChange={(v) => setSetting("threshold", v)} />
        <Stepper label="알람 집계 범위" unit="시간" value={draft.settings.windowHours} min={1} max={168} onChange={(v) => setSetting("windowHours", v)} />
      </fieldset>
    </>
  );
}

function Stepper({
  label,
  unit,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className={s.stepper}>
      <span>{label}</span>
      <div className={s.stepperCtl}>
        <button type="button" className={s.small} onClick={() => onChange(Math.max(min, value - 1))} aria-label={`${label} 줄이기`}>
          −
        </button>
        <b>
          {value}
          <span className={s.fieldHint}> {unit}</span>
        </b>
        <button type="button" className={s.small} onClick={() => onChange(Math.min(max, value + 1))} aria-label={`${label} 늘리기`}>
          +
        </button>
      </div>
    </div>
  );
}
