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
      // Whitespace around a value is ignored by the app, but shown here so it can be cleaned up in the settings.
      hasWhitespace: ["LLM_PROVIDER", "LLM_MODEL", "LLM_API_KEY", "GEMINI_API_KEY"].filter((k) => {
        const v = process.env[k];
        return v !== undefined && v !== v.trim();
      }),
      LLM_API_KEY: !!process.env.LLM_API_KEY,
      GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
    },
  });
}
