import type { LLMProvider, LLMRequest, LLMResponse } from "./resolvers";

/** Test / demo provider that returns scripted raw outputs. Its answers are labelled source "mock". */
export class MockLLM implements LLMProvider {
  readonly calls: LLMRequest[] = [];

  constructor(private readonly answer: (request: LLMRequest) => unknown) {}

  async evaluate(request: LLMRequest): Promise<LLMResponse> {
    this.calls.push(request);
    return { raw: this.answer(request), source: "mock", model: "mock" };
  }
}
