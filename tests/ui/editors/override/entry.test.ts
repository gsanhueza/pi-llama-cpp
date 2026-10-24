import { describe, expect, it } from "vitest";
import type { LlamaServer } from "../../../../src/interfaces/settings";
import { OverrideEntry } from "../../../../src/ui/editors/override/entry";

describe("OverrideEntry.listFrom", () => {
  it("returns entries from a server's overrides map", () => {
    const server: LlamaServer = {
      url: "http://localhost:8080",
      overrides: {
        "gpt-*": { reasoning: false },
        "claude-*": { contextSize: 8192 },
      },
    };
    const entries = OverrideEntry.listFrom(server);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toBeInstanceOf(OverrideEntry);
    expect(entries[0].pattern).toBe("gpt-*");
    expect(entries[0].override).toEqual({ reasoning: false });
    expect(entries[1].pattern).toBe("claude-*");
    expect(entries[1].override).toEqual({ contextSize: 8192 });
  });

  it("returns an empty array when overrides is undefined", () => {
    const server: LlamaServer = { url: "http://localhost:8080" };
    expect(OverrideEntry.listFrom(server)).toEqual([]);
  });

  it("returns an empty array when overrides is null", () => {
    const server: LlamaServer = {
      url: "http://localhost:8080",
      overrides: null as unknown as Record<string, { reasoning: boolean }>,
    };
    expect(OverrideEntry.listFrom(server)).toEqual([]);
  });

  it("preserves iteration order of the overrides map", () => {
    const server: LlamaServer = {
      url: "http://localhost:8080",
      overrides: {
        zebra: { reasoning: true },
        alpha: { reasoning: false },
        middle: { contextSize: 4096 },
      },
    };
    const entries = OverrideEntry.listFrom(server);
    expect(entries[0].pattern).toBe("zebra");
    expect(entries[1].pattern).toBe("alpha");
    expect(entries[2].pattern).toBe("middle");
  });

  it("handles a server with an empty overrides object", () => {
    const server: LlamaServer = { url: "http://localhost:8080", overrides: {} };
    expect(OverrideEntry.listFrom(server)).toEqual([]);
  });

  it("handles an undefined server", () => {
    expect(OverrideEntry.listFrom(undefined as unknown as LlamaServer)).toEqual(
      [],
    );
  });
});
