import { describe, expect, it } from "vitest";
import { isAllowedPreviewUrl } from "../browser-safety";

describe("preview navigation boundaries", () => {
  it("allows local services and public HTTP pages", () => {
    for (const url of ["http://127.0.0.1:5173", "http://[::1]:3000", "https://example.com/path?q=1", "about:blank"]) {
      expect(isAllowedPreviewUrl(url)).toBe(true);
    }
  });
  it("rejects local resources, executable schemes and embedded credentials", () => {
    for (const url of ["file:///C:/secret", "javascript:alert(1)", "data:text/html,hi", "https://u:p@example.com", "devtools://inspect", "invalid"]) {
      expect(isAllowedPreviewUrl(url)).toBe(false);
    }
  });
});
