import { describe, expect, it } from "vitest";
import { selectWhisperLanguage } from "./whisper-language";

describe("Whisper language detection", () => {
  it("detects Chinese and English from language logits without preferring ordinary text", () => {
    const tokens = { "<|en|>": 1, "<|zh|>": 2, "<|transcribe|>": 3 };
    expect(selectWhisperLanguage(Float32Array.from([100, -4, -1, 50]), tokens)).toBe("zh");
    expect(selectWhisperLanguage(Float32Array.from([100, -1, -4, 50]), tokens)).toBe("en");
  });
  it("reports invalid or unavailable scores instead of silently choosing English", () => {
    expect(() => selectWhisperLanguage([], null)).toThrow("language map");
    expect(() => selectWhisperLanguage([NaN], { "<|zh|>": 0 })).toThrow("could not be detected");
  });
});
