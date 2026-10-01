import { describe, expect, it } from "vitest";
import type { UIMessage } from "@/types";
import { getInputHistory, stripInputContext } from "./input-history";

const userMessage = (content: string, extra: Partial<UIMessage> = {}): UIMessage => ({
  id: content,
  role: "user",
  content,
  timestamp: 1,
  ...extra,
});

describe("input history", () => {
  it("keeps only non-empty user prompts in chronological order", () => {
    const messages: UIMessage[] = [
      userMessage("first"),
      { ...userMessage("answer"), role: "assistant" },
      userMessage("  \n  "),
      userMessage("second"),
    ];

    expect(getInputHistory(messages)).toEqual(["first", "second"]);
  });

  it("prefers display content and strips internal context from older messages", () => {
    expect(getInputHistory([
      userMessage('<file path="src/App.tsx">contents</file>\n\nfix this'),
      userMessage("full content", { displayContent: "shown prompt\n\n[[element:<button> Save]]" }),
    ])).toEqual(["fix this", "shown prompt"]);
    expect(stripInputContext('<element tag="button">details</element>\n\ninspect')).toBe("inspect");
  });
});
