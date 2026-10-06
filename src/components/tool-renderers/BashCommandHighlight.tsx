import type { CSSProperties } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { INLINE_HIGHLIGHT_STYLE, INLINE_CODE_TAG_STYLE } from "@/lib/languages";
import type { ResolvedTheme } from "@/hooks/useTheme";

interface BashCommandHighlightProps {
  command: string;
  resolvedTheme: ResolvedTheme;
}

export function BashCommandHighlight({ command, resolvedTheme }: BashCommandHighlightProps) {
  const syntaxStyle = (resolvedTheme === "dark" ? oneDark : oneLight) as Record<string, CSSProperties>;
  return (
    <SyntaxHighlighter
      language="bash"
      style={syntaxStyle}
      customStyle={INLINE_HIGHLIGHT_STYLE}
      codeTagProps={{ style: INLINE_CODE_TAG_STYLE }}
      PreTag="span"
      CodeTag="span"
    >
      {command}
    </SyntaxHighlighter>
  );
}
