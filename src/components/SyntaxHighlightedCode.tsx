import type { CSSProperties } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface SyntaxHighlightedCodeProps {
  code: string;
  language: string;
  customStyle: CSSProperties;
  codeTagProps: { style: CSSProperties };
}

export function SyntaxHighlightedCode({
  code,
  language,
  customStyle,
  codeTagProps,
}: SyntaxHighlightedCodeProps) {
  return (
    <SyntaxHighlighter
      style={oneDark}
      language={language}
      PreTag="div"
      customStyle={customStyle}
      codeTagProps={codeTagProps}
    >
      {code}
    </SyntaxHighlighter>
  );
}
