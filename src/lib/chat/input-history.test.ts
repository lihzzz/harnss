import { describe, expect, it } from "vitest";
import type { UIMessage } from "@/types";
import {
  appendPersistedInputHistory,
  canNavigateInputHistory,
  getInputHistory,
  loadPersistedInputHistory,
  mergeInputHistory,
  stripInputContext,
} from "./input-history";

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

  it("continues navigating when the composer shows the selected history entry", () => {
    expect(canNavigateInputHistory({
      currentText: "second",
      history: ["first", "second"],
      currentIndex: 1,
      isEmpty: false,
      atBoundary: false,
    })).toBe(true);
  });

  it("does not take over arrows from text being edited away from a boundary", () => {
    expect(canNavigateInputHistory({
      currentText: "draft",
      history: ["first", "second"],
      currentIndex: 2,
      isEmpty: false,
      atBoundary: false,
    })).toBe(false);
  });
});

describe("persistent input history", () => {
  const fakeStorage = () => {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
    };
  };

  it("appends prompts per project and skips consecutive duplicates", () => {
    const storage = fakeStorage();
    appendPersistedInputHistory("/repo", "first", storage);
    appendPersistedInputHistory("/repo", "second", storage);
    appendPersistedInputHistory("/repo", "second", storage);
    appendPersistedInputHistory("/repo", "  ", storage);
    appendPersistedInputHistory(undefined, "ignored", storage);
    expect(loadPersistedInputHistory("/repo", storage)).toEqual(["first", "second"]);
    expect(loadPersistedInputHistory("/other", storage)).toEqual([]);
  });

  it("caps the persisted history at 50 entries", () => {
    const storage = fakeStorage();
    for (let i = 0; i < 60; i++) appendPersistedInputHistory("/repo", `prompt-${i}`, storage);
    const history = loadPersistedInputHistory("/repo", storage);
    expect(history).toHaveLength(50);
    expect(history[0]).toBe("prompt-10");
  });

  it("returns an empty list for corrupt stored data", () => {
    const storage = fakeStorage();
    storage.setItem("harnss-input-history-/repo", "{not json");
    expect(loadPersistedInputHistory("/repo", storage)).toEqual([]);
    storage.setItem("harnss-input-history-/repo", JSON.stringify(["ok", 42, ""]));
    expect(loadPersistedInputHistory("/repo", storage)).toEqual(["ok"]);
  });

  it("merges persisted history with the session suffix already persisted", () => {
    expect(mergeInputHistory(["old-a", "old-b", "one", "two"], ["one", "two"]))
      .toEqual(["old-a", "old-b", "one", "two"]);
  });

  it("appends session prompts that predate persistence", () => {
    expect(mergeInputHistory(["from-other-session"], ["one", "two"]))
      .toEqual(["from-other-session", "one", "two"]);
  });

  it("collapses consecutive duplicates in the merged result", () => {
    expect(mergeInputHistory(["dup"], ["dup", "again", "again"]))
      .toEqual(["dup", "again"]);
  });
});
