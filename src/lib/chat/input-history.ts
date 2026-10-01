import type { UIMessage } from "@/types";

/** Remove internal context blocks from user messages created by file mentions or browser grabs. */
export function stripInputContext(text: string): string {
  let result = text.replace(/<file path="[^"]*">[\s\S]*?<\/file>\s*/g, "");
  result = result.replace(/<folder path="[^"]*">[\s\S]*?<\/folder>\s*/g, "");
  result = result.replace(/<element [^>]*>[\s\S]*?<\/element>\s*/g, "");
  return result.trim();
}

function stripInputDecorations(text: string): string {
  return text.replace(/\s*\[\[element:[^\]]+\]\]/g, "").trim();
}

/** Return the user-entered prompts for a session in chronological order. */
export function getInputHistory(messages: UIMessage[]): string[] {
  return messages.flatMap((message) => {
    if (message.role !== "user") return [];
    const displayContent = message.displayContent?.trim();
    const prompt = stripInputDecorations(
      displayContent || stripInputContext(message.content),
    );
    return prompt ? [prompt] : [];
  });
}
