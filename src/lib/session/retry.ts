import type { UIMessage } from "@/types";

export interface RetryRequest {
  content: string;
  images?: UIMessage["images"];
  displayContent?: string;
}

const NON_RETRYABLE_ERROR_PATTERNS = [
  /\b(?:401|403)\b/,
  /unauthori[sz]ed|forbidden|missing\s+(?:bearer|basic)\s+authentication/i,
  /\b(?:authentication|api\s+key|credential)s?\b/i,
  /(?:access|permission)\s+denied/i,
  /\b(?:invalid|unknown|unsupported|missing)\b.*\b(?:model|parameter|request|config(?:uration)?|option|method)\b/i,
  /\bconfig(?:uration)?\b.*\berror\b/i,
  /\bsession(?:[- ](?:not found|closed|invalid)|\s+not found)\b/i,
  /\b(?:thread|conversation)\s+(?:not found|closed|invalid)\b|\bno active thread\b/i,
];

/** Configuration, authentication, and permission errors need user action before retrying. */
export function isRetryableUpstreamError(content: string): boolean {
  return !NON_RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(content));
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
