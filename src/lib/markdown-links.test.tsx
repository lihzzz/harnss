import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { describe, expect, it } from "vitest";
import { parseLocalFileLink, type LocalFileLink } from "@shared/lib/file-paths";
import { markdownUrlTransform } from "./markdown-links";

describe("Markdown file links", () => {
  it("preserves actual renderer anchor hrefs for Windows, macOS and UNC paths", () => {
    const targets: Array<LocalFileLink | null> = [];
    renderToStaticMarkup(createElement(ReactMarkdown, {
      urlTransform: markdownUrlTransform,
      components: { a: ({ href, children }) => { targets.push(parseLocalFileLink(href ?? "")); return createElement("a", { href }, children); } },
      children: "[win](<C:/My Project/中文.ts:4>) [mac](/Users/me/a.ts#L5) [unc](file://server/share/a.ts#L6)",
    }));
    expect(targets).toEqual([
      { filePath: "C:/My Project/中文.ts", line: 4 },
      { filePath: "/Users/me/a.ts", line: 5 },
      { filePath: "\\\\server\\share\\a.ts", line: 6 },
    ]);
  });
  it("retains the default unsafe URL policy and does not load local file images", () => {
    const html = renderToStaticMarkup(createElement(ReactMarkdown, {
      urlTransform: markdownUrlTransform,
      components: { img: ({ src, alt }) => createElement("img", { src: src || undefined, alt }) },
      children: "[unsafe](javascript:alert) [web](https://example.com) ![local](file:///C:/secret.png)",
    }));
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("file:");
    expect(html).toContain('href="https://example.com"');
  });
});
