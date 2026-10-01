import { describe, expect, it } from "vitest";
import type { UIMessage } from "@/types";
import { getRetryRequest } from "./retry";

function message(overrides: Partial<UIMessage>): UIMessage {
  return {
    id: "message",
    role: "system",
    content: "error",
    timestamp: 1,
    ...overrides,
  };
}

describe("getRetryRequest", () => {
  it("returns the user turn before a retryable error", () => {
    const images = [{ id: "image", data: "data", mediaType: "image/png" as const }];
    const messages = [
      message({ id: "user-1", role: "user", content: "try again", images, displayContent: "try" }),
      message({ id: "error-1", retryable: true }),
    ];

    expect(getRetryRequest(messages, "error-1")).toEqual({
      content: "try again",
      images,
      displayContent: "try",
    });
  });

  it("ignores non-retryable errors and queued messages", () => {
    const messages = [
      message({ id: "queued", role: "user", content: "queued", isQueued: true }),
      message({ id: "error-1", retryable: true }),
    ];
    expect(getRetryRequest(messages, "error-1")).toBeNull();
    expect(getRetryRequest(messages, "missing")).toBeNull();
    expect(getRetryRequest([message({ id: "error-2" })], "error-2")).toBeNull();
  });
});
