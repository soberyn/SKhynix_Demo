import { liveConfig } from "@/server/llm";

// Deployment check: which LLM settings are present. Never returns the key itself.
export const dynamic = "force-dynamic";

export async function GET() {
  const config = liveConfig();
  return Response.json({
    live: !!config,
    provider: config?.provider ?? null,
    model: config?.model ?? null,
    env: {
      LLM_PROVIDER: process.env.LLM_PROVIDER ?? null,
      LLM_MODEL: process.env.LLM_MODEL ?? null,
      LLM_API_KEY: !!process.env.LLM_API_KEY,
      GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
    },
  });
}
