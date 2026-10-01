import type { UIMessage } from "@/types";

export interface RetryRequest {
  content: string;
  images?: UIMessage["images"];
  displayContent?: string;
}

/** Find the most recent user turn before a retryable error. */
export function getRetryRequest(messages: UIMessage[], errorMessageId: string): RetryRequest | null {
  const errorIndex = messages.findIndex((message) => message.id === errorMessageId);
  if (errorIndex < 0 || !messages[errorIndex].retryable) return null;

  for (let index = errorIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user" && !message.isQueued) {
      return {
        content: message.content,
        images: message.images,
        displayContent: message.displayContent,
      };
    }
  }

  return null;
}
