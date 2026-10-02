import { describe, expect, it } from "vitest";
import { buildSessionMarkdown, type MarkdownMessage } from "@shared/lib/session-markdown";
import type { SessionMeta } from "@shared/lib/session-persistence";

const session: SessionMeta = {
  id: "s1",
  projectId: "p1",
  title: "My Chat",
  createdAt: 0,
  lastMessageAt: 0,
  engine: "claude",
  model: "claude-sonnet",
};

describe("buildSessionMarkdown", () => {
  it("starts with the session title and metadata", () => {
    const md = buildSessionMarkdown(session, []);
    expect(md.startsWith("# My Chat\n")).toBe(true);
    expect(md).toContain("- **Engine:** claude");
    expect(md).toContain("- **Model:** claude-sonnet");
  });

  it("renders user and assistant turns", () => {
    const messages: MarkdownMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ];
    const md = buildSessionMarkdown(session, messages);
    expect(md).toContain("## User\n\nHello");
    expect(md).toContain("## Assistant\n\nHi there");
  });

  it("prefers displayContent for user messages", () => {
    const md = buildSessionMarkdown(session, [
      { role: "user", content: "raw <file>xml</file>", displayContent: "clean text" },
    ]);
    expect(md).toContain("## User\n\nclean text");
    expect(md).not.toContain("raw <file>");
  });

  it("wraps thinking in a details block", () => {
    const md = buildSessionMarkdown(session, [
      { role: "assistant", content: "Answer", thinking: "Let me think" },
    ]);
    expect(md).toContain("<summary>Thinking</summary>");
    expect(md).toContain("Let me think");
  });

  it("renders tool calls with input and result", () => {
    const md = buildSessionMarkdown(session, [
      {
        role: "tool_call",
        toolName: "Bash",
        toolInput: { command: "ls" },
        toolResult: { stdout: "file.txt" },
      },
    ]);
    expect(md).toContain("### Tool call: Bash");
    expect(md).toContain('"command": "ls"');
    expect(md).toContain("file.txt");
  });

  it("uses a longer fence when fenced content contains backticks", () => {
    const md = buildSessionMarkdown(session, [
      {
        role: "tool_call",
        toolName: "Read",
        toolResult: { stdout: "```js\nconst a = 1;\n```" },
      },
    ]);
    expect(md).toContain("````");
  });

  it("skips empty messages", () => {
    const md = buildSessionMarkdown(session, [
      { role: "assistant", content: "   " },
      { role: "user", content: "" },
    ]);
    expect(md).not.toContain("## Assistant");
    expect(md).not.toContain("## User");
  });
});
