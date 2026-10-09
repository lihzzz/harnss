import { getAppSettings } from "../app-settings";
import { getMemoryLlmKey } from "./secrets";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Tests provider credentials without starting Hindsight or creating a memory bank. */
export async function testMemoryLlm(enteredKey?: string): Promise<{ ok: boolean; error?: string }> {
  const settings = getAppSettings().memory;
  const apiKey = enteredKey?.trim() || getMemoryLlmKey();
  if (!apiKey) return { ok: false, error: "Enter an API key or save one before testing." };
  const provider = settings.llmProvider?.trim().toLowerCase();
  if (provider !== "openai" && provider !== "anthropic") {
    return { ok: false, error: "Connection testing currently supports openai and anthropic providers." };
  }
  const model = settings.llmModel?.trim();
  if (!model) return { ok: false, error: "Enter a model before testing." };
  const anthropic = provider === "anthropic";
  const baseUrl = (settings.llmBaseUrl?.trim() || (anthropic ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1")).replace(/\/+$/, "");
  let endpoint: URL;
  try {
    endpoint = new URL(`${baseUrl}${anthropic ? (baseUrl.endsWith("/v1") ? "/messages" : "/v1/messages") : "/chat/completions"}`);
    if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error();
  } catch {
    return { ok: false, error: "Enter a valid HTTP or HTTPS Base URL without embedded credentials." };
  }
  try {
    const response = await fetch(endpoint.toString(), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: {
        "Content-Type": "application/json",
        ...(anthropic ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } : { Authorization: `Bearer ${apiKey}` }),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with OK." }],
        ...(anthropic ? { max_tokens: 32 } : {}),
        stream: false,
      }),
    });
    if (!response.ok) {
      const hint = response.status === 401 || response.status === 403 ? "Check the API key and model permissions."
        : response.status === 404 ? "Check the Base URL and model name."
        : response.status === 429 ? "Check the provider quota or retry later."
        : "Check the provider configuration and availability.";
      return { ok: false, error: `Connection failed (HTTP ${response.status}). ${hint}` };
    }
    const data: unknown = await response.json();
    const valid = isRecord(data) && (anthropic
      ? data.type === "message" && Array.isArray(data.content) && data.content.length > 0
      : Array.isArray(data.choices) && data.choices.some((choice: unknown) => isRecord(choice)
        && isRecord(choice.message) && (choice.message.role === "assistant" || typeof choice.message.content === "string")));
    return valid ? { ok: true } : { ok: false, error: "The endpoint did not return a valid model response. Check the Base URL and model." };
  } catch (error) {
    // Do not return provider bodies or exception messages that may echo credentials.
    return { ok: false, error: error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
      ? "Connection timed out after 30 seconds. Check the Base URL and network."
      : "Unable to complete the model request. Check the Base URL, network, and provider response format." };
  }
}
