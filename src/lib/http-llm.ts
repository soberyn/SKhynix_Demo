import type { LLMProvider, LLMRequest, LLMResponse } from "@/core/resolvers";

/** Browser-side provider: forwards an LLM node to the server route, which holds the API key. */
export const httpLLM: LLMProvider = {
  async evaluate(request: LLMRequest): Promise<LLMResponse> {
    const res = await fetch("/api/judge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nodeId: request.nodeId, evidence: request.evidence }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `LLM 요청 실패 (${res.status})`);
    return data as LLMResponse;
  },
};

/** Failure example: a provider that returns output violating the schema. Clearly labelled as simulated. */
export const malformedLLM: LLMProvider = {
  async evaluate(): Promise<LLMResponse> {
    return {
      raw: { decision: "아마 아닐 것", reason: "센서는 괜찮아 보입니다." },
      source: "mock",
      model: "형식 위반 출력 시뮬레이션",
    };
  },
};
