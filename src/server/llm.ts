import "server-only";

// Server-side LLM access. The API key never reaches the browser.
//
// Environment:
//   LLM_PROVIDER   "gemini" | "anthropic" | "openai"   (unset → no live LLM; the demo uses recorded/prepared answers)
//   LLM_API_KEY    provider API key
//   LLM_MODEL      model id (default for anthropic: claude-sonnet-5; required for gemini and openai)

type Provider = "gemini" | "anthropic" | "openai";
const PROVIDERS: Provider[] = ["gemini", "anthropic", "openai"];

export interface LiveConfig {
  provider: Provider;
  apiKey: string;
  model: string;
}

export function liveConfig(): LiveConfig | null {
  const provider = process.env.LLM_PROVIDER as Provider;
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey || !PROVIDERS.includes(provider)) return null;
  const model = process.env.LLM_MODEL || (provider === "anthropic" ? "claude-sonnet-5" : "");
  if (!model) return null;
  return { provider, apiKey, model };
}

/** Sends one prompt and returns the parsed JSON object from the reply (unvalidated). */
export async function completeJSON(config: LiveConfig, system: string, user: string): Promise<unknown> {
  const call = { gemini, anthropic, openai }[config.provider];
  const text = await call(config, system, user);
  return extractJSON(text);
}

async function gemini(config: LiveConfig, system: string, user: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": config.apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { responseMimeType: "application/json" },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Gemini API ${res.status}`);
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
}

async function anthropic(config: LiveConfig, system: string, user: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 800,
      system,
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}`);
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  return (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
}

async function openai(config: LiveConfig, system: string, user: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`OpenAI API ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Returns the JSON object in the reply, or the raw text if it is not JSON.
 * Validation is left to the caller, so a malformed reply surfaces as a FAILED node instead of being patched here.
 */
function extractJSON(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return text;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return text;
  }
}

// ---------- Abuse limits for the public endpoints ----------

const WINDOW_MS = 10 * 60_000;
const MAX_REQUESTS = 30;
const hits = new Map<string, number[]>();

/** Best-effort in-memory rate limit per IP (per server instance). */
export function rateLimited(request: Request): boolean {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_REQUESTS;
}

export const MAX_FIELD_CHARS = 4000;
