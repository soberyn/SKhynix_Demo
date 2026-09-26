import { yesNo } from "@/core/resolvers";
import type { ExecutionStatus, JudgmentValue, LLMSource, ResolverType } from "@/core/types";
import s from "./demo.module.css";

const RESOLVER_GLYPH: Record<ResolverType, string> = { RULE: "≡", LLM: "✦" };
const RESOLVER_NAME: Record<ResolverType, string> = { RULE: "규칙", LLM: "LLM" };

export const RESOLVER_MEANING: Record<ResolverType, string> = {
  RULE: "정해진 조건·계산으로 판단 — 같은 입력이면 항상 같은 결과",
  LLM: "LLM이 글(정비 기록)을 읽고 판단",
};

export function ResolverBadge({ type }: { type: ResolverType }) {
  return (
    <span className={`${s.badge} ${s[`badge_${type}`]}`} title={`판단방법: ${RESOLVER_MEANING[type]}`}>
      <span aria-hidden>{RESOLVER_GLYPH[type]}</span> {RESOLVER_NAME[type]}
    </span>
  );
}

export const STATUS_TEXT: Record<ExecutionStatus, { glyph: string; ko: string; meaning: string }> = {
  PENDING: { glyph: "○", ko: "대기", meaning: "앞 단계가 끝나기를 기다리는 중" },
  READY: { glyph: "◔", ko: "준비", meaning: "앞 단계가 모두 끝나 실행할 수 있음" },
  RUNNING: { glyph: "◑", ko: "실행 중", meaning: "판단하는 중" },
  SUCCEEDED: { glyph: "●", ko: "완료", meaning: "판단을 마침 (결과가 '아니오'여도 완료)" },
  FAILED: { glyph: "✕", ko: "실패", meaning: "판단 방법 자체가 실패함" },
  BLOCKED: { glyph: "⊘", ko: "차단", meaning: "앞 단계가 실패해 실행하지 않음" },
};

export function StatusPill({ status }: { status: ExecutionStatus }) {
  const t = STATUS_TEXT[status];
  return (
    <span className={`${s.pill} ${s[`pill_${status}`]}`} title={`${status}: ${t.meaning}`}>
      <span aria-hidden>{t.glyph}</span> {t.ko}
    </span>
  );
}

const SOURCE_TEXT: Record<LLMSource, { label: string; meaning: string }> = {
  live: { label: "실제 LLM 응답", meaning: "지금 실제 LLM을 호출한 결과" },
  recorded: { label: "기록된 실제 LLM 응답", meaning: "같은 입력으로 실제 LLM을 호출해 저장해 둔 응답 (지금 호출한 것은 아님)" },
  fallback: { label: "준비된 예시 답변", meaning: "LLM이 연결되지 않아, 예시 입력용으로 미리 작성한 답변을 표시" },
  mock: { label: "시뮬레이션", meaning: "실패 예시를 위해 만든 가짜 출력" },
};

export function SourceTag({ source, model, recordedAt }: { source: LLMSource; model?: string; recordedAt?: string }) {
  const t = SOURCE_TEXT[source];
  const when = recordedAt ? ` · ${recordedAt.slice(0, 10)}` : "";
  return (
    <span className={`${s.source} ${s[`source_${source}`]}`} title={t.meaning}>
      {t.label}
      {model && (source === "live" || source === "recorded") ? ` · ${model}` : ""}
      {source === "recorded" ? when : ""}
    </span>
  );
}

export function sourceMeaning(source: LLMSource): string {
  return SOURCE_TEXT[source].meaning;
}

export function formatValue(v: JudgmentValue | undefined): string {
  if (v === undefined) return "—";
  if (typeof v === "boolean") return yesNo(v);
  return String(v);
}
