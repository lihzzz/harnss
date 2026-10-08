import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testMemoryLlm } from "./llm-connection";

const { memory, getKey } = vi.hoisted(() => ({
  memory: { enabled: false, llmProvider: "openai", llmModel: "test-model", llmBaseUrl: "http://localhost:11111/v1" },
  getKey: vi.fn(() => "saved-key"),
}));
vi.mock("../app-settings", () => ({ getAppSettings: () => ({ memory }) }));
vi.mock("./secrets", () => ({ getMemoryLlmKey: getKey }));

const request = vi.fn();
beforeEach(() => {
  memory.llmProvider = "openai";
  memory.llmBaseUrl = "http://localhost:11111/v1";
  getKey.mockReturnValue("saved-key");
  request.mockReset();
  vi.stubGlobal("fetch", request);
});
afterEach(() => vi.unstubAllGlobals());

describe("memory provider connection test", () => {
  it("tests a model while memory is disabled without starting the daemon", async () => {
    request.mockResolvedValue(Response.json({ choices: [{ message: { content: "OK" } }] }));
    expect(await testMemoryLlm()).toEqual({ ok: true });
    expect(request).toHaveBeenCalledWith("http://localhost:11111/v1/chat/completions", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer saved-key" }),
      body: expect.stringContaining('"model":"test-model"'),
      redirect: "error",
      signal: expect.any(AbortSignal),
    }));
  });

  it("can test an entered key before saving it", async () => {
    request.mockResolvedValue(Response.json({ choices: [{ message: { content: "OK" } }] }));
    await testMemoryLlm("draft-key");
    expect(request.mock.calls[0][1].headers.Authorization).toBe("Bearer draft-key");
  });

  it("supports the default Anthropic endpoint", async () => {
    memory.llmProvider = "anthropic";
    memory.llmBaseUrl = "";
    request.mockResolvedValue(Response.json({ type: "message", content: [{ type: "text", text: "OK" }] }));
    expect(await testMemoryLlm()).toEqual({ ok: true });
    expect(request.mock.calls[0][0]).toBe("https://api.anthropic.com/v1/messages");
    expect(request.mock.calls[0][1].headers["x-api-key"]).toBe("saved-key");
  });

  it.each([401, 403, 404, 429, 500])("reports HTTP %i without exposing the key", async (status) => {
    request.mockResolvedValue(new Response("saved-key", { status }));
    const result = await testMemoryLlm();
    expect(result.ok).toBe(false);
    expect(result.error).toContain(String(status));
    expect(result.error).not.toContain("saved-key");
  });

  it("rejects a missing key before making a request", async () => {
    getKey.mockReturnValue("");
    expect((await testMemoryLlm()).error).toContain("API key");
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects invalid endpoint schemes before sending credentials", async () => {
    memory.llmBaseUrl = "file:///tmp/test";
    expect((await testMemoryLlm()).ok).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it("does not treat other providers as OpenAI-compatible", async () => {
    memory.llmProvider = "ollama";
    expect((await testMemoryLlm()).error).toContain("supports openai and anthropic");
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects a successful HTTP response that is not a model response", async () => {
    request.mockResolvedValue(Response.json({ ok: true }));
    expect((await testMemoryLlm()).ok).toBe(false);
  });

  it("reports request timeouts", async () => {
    request.mockRejectedValue(new DOMException("Timeout", "TimeoutError"));
    expect((await testMemoryLlm()).error).toContain("timed out");
  });
});
