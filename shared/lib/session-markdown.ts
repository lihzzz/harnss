/**
 * Serialize a persisted chat session into a human-readable Markdown document.
 */

import type { SessionMeta } from "./session-persistence";

export interface MarkdownSubagentStep {
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  toolError?: boolean;
}

export interface MarkdownMessage {
  role?: string;
  content?: string;
  displayContent?: string;
  thinking?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  subagentSteps?: MarkdownSubagentStep[];
  isError?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Fence a block of text, using a longer fence when the content contains backticks. */
function codeBlock(text: string, language = ""): string {
  const body = text.replace(/\s+$/, "");
  let fence = "```";
  while (body.includes(fence)) fence += "`";
  return `${fence}${language}\n${body}\n${fence}`;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function blockquote(text: string): string {
  return text
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

/** Extract the readable text out of a normalized tool result. */
function toolResultText(result: unknown): string {
  if (typeof result === "string") return result.trim();
  if (!isRecord(result)) return "";

  const parts: string[] = [];
  if (typeof result.stdout === "string" && result.stdout.trim()) parts.push(result.stdout.trim());
  if (typeof result.stderr === "string" && result.stderr.trim()) parts.push(result.stderr.trim());
  if (typeof result.content === "string" && result.content.trim()) {
    parts.push(result.content.trim());
  } else if (Array.isArray(result.content)) {
    for (const block of result.content) {
      if (isRecord(block) && typeof block.text === "string" && block.text.trim()) {
        parts.push(block.text.trim());
      }
    }
  }
  if (parts.length > 0) return parts.join("\n\n");
  if (typeof result.detailedContent === "string" && result.detailedContent.trim()) {
    return result.detailedContent.trim();
  }
  if (isRecord(result.file) && typeof result.file.content === "string") {
    return result.file.content.trim();
  }
  return "";
}

function renderToolCall(message: MarkdownMessage): string {
  const name = message.toolName || "Tool";
  const sections: string[] = [`### Tool call: ${name}`];

  const input = stringify(message.toolInput).trim();
  if (input && input !== "{}") sections.push(codeBlock(input, "json"));

  const resultText = toolResultText(message.toolResult);
  if (resultText) sections.push(codeBlock(resultText));

  for (const step of message.subagentSteps ?? []) {
    const stepParts: string[] = [`- ${step.toolName || "Tool"}`];
    const stepInput = stringify(step.toolInput).trim();
    if (stepInput && stepInput !== "{}") stepParts.push(`\n${codeBlock(stepInput, "json")}`);
    const stepResult = toolResultText(step.toolResult);
    if (stepResult) stepParts.push(`\n${codeBlock(stepResult)}`);
    sections.push(stepParts.join("\n"));
  }

  return sections.join("\n\n");
}

function renderMessage(message: MarkdownMessage): string {
  const role = message.role ?? "assistant";
  switch (role) {
    case "user": {
      const text = (message.displayContent ?? message.content ?? "").trim();
      return text ? `## User\n\n${text}` : "";
    }
    case "assistant": {
      const parts: string[] = [];
      const text = (message.content ?? "").trim();
      if (text) parts.push(text);
      const thinking = (message.thinking ?? "").trim();
      if (thinking) {
        parts.push(`<details>\n<summary>Thinking</summary>\n\n${thinking}\n\n</details>`);
      }
      return parts.length > 0 ? `## Assistant\n\n${parts.join("\n\n")}` : "";
    }
    case "tool_call":
      return renderToolCall(message);
    case "system": {
      const text = (message.content ?? "").trim();
      return text ? blockquote(text) : "";
    }
    case "summary": {
      const text = (message.content ?? "").trim();
      return text ? `## Summary\n\n${text}` : "";
    }
    default: {
      const text = (message.content ?? "").trim();
      return text ? `## ${role}\n\n${text}` : "";
    }
  }
}

export function buildSessionMarkdown(session: SessionMeta, messages: MarkdownMessage[]): string {
  const sections: string[] = [];

  sections.push(`# ${session.title || "Untitled"}`);

  const meta: string[] = [];
  if (session.createdAt) meta.push(`- **Created:** ${new Date(session.createdAt).toLocaleString()}`);
  if (session.engine) meta.push(`- **Engine:** ${session.engine}`);
  if (session.model) meta.push(`- **Model:** ${session.model}`);
  if (session.branch) meta.push(`- **Branch:** ${session.branch}`);
  if (typeof session.totalCost === "number" && session.totalCost > 0) {
    meta.push(`- **Cost:** $${session.totalCost.toFixed(4)}`);
  }
  meta.push(`- **Exported:** ${new Date().toLocaleString()}`);
  sections.push(meta.join("\n"));

  for (const message of messages) {
    const rendered = renderMessage(message);
    if (rendered) sections.push(rendered);
  }

  return `${sections.join("\n\n")}\n`;
}
