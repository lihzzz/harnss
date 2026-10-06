import { describe, expect, it } from "vitest";
import { MEMORY_USER_BANK, bankTags, banksForProject, memoryMcpUrl, projectBankId, tagsForBank } from "./bank-router";

describe("memory bank routing", () => {
  it("uses stable, filesystem-safe project bank IDs", () => {
    expect(projectBankId("project/with spaces")).toMatch(/^harnss-project-project-with-spaces-[a-f0-9]{12}$/);
    expect(projectBankId("  ")).toMatch(/^harnss-project-unknown-[a-f0-9]{12}$/);
  });

  it("routes shared and isolated project memories to the intended banks", () => {
    expect(banksForProject("p1", { memoryMode: "manual", memoryIsolated: false })).toEqual([
      MEMORY_USER_BANK,
      projectBankId("p1"),
    ]);
    expect(banksForProject("p1", { memoryMode: "manual", memoryIsolated: true })).toEqual([projectBankId("p1")]);
  });

  it("keeps source and session tags explicit", () => {
    expect(bankTags("p1", "claude", "manual", "s1")).toEqual([
      "project:p1",
      "engine:claude",
      "source:manual",
      "session:s1",
    ]);
  });

  it("keeps shared user-bank memories discoverable across projects", () => {
    expect(tagsForBank(MEMORY_USER_BANK, "p1", "claude", "manual", "s1")).toEqual([
      "scope:user",
      "engine:claude",
      "source:manual",
    ]);
    expect(tagsForBank(projectBankId("p1"), "p1", "claude", "manual", "s1")).toEqual(bankTags("p1", "claude", "manual", "s1"));
  });

  it("builds the per-bank MCP endpoint", () => {
    expect(memoryMcpUrl("http://127.0.0.1:8888/", MEMORY_USER_BANK)).toBe("http://127.0.0.1:8888/mcp/harnss-user/");
  });
});
