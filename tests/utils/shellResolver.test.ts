import { describe, expect, it, vi } from "vitest";
import { ShellResolver } from "../../src/utils/shellResolver";

const mockExecSync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execSync: mockExecSync,
}));

describe("ShellResolver", () => {
  const resolver = new ShellResolver();

  describe("resolve", () => {
    it("returns undefined for empty string", () => {
      expect(resolver.resolve("")).toBeUndefined();
      // @ts-expect-error — verifying undefined falls back to undefined
      expect(resolver.resolve(undefined)).toBeUndefined();
    });

    it("returns literal value as-is", () => {
      expect(resolver.resolve("sk-abc123")).toBe("sk-abc123");
      expect(resolver.resolve("plain-value")).toBe("plain-value");
    });

    it("resolves escape sequences $$", () => {
      expect(resolver.resolve("$$literal")).toBe("$literal");
    });

    it("resolves escape sequences $!", () => {
      expect(resolver.resolve("$!bang")).toBe("!bang");
    });

    it("resolves $VAR from process.env", () => {
      process.env.TEST_PROCESS_VAR = "process-value";
      expect(resolver.resolve("$TEST_PROCESS_VAR")).toBe("process-value");
      delete process.env.TEST_PROCESS_VAR;
    });

    it("resolves ${VAR} from process.env", () => {
      process.env.TEST_BRACED_VAR = "braced-value";
      expect(resolver.resolve("${TEST_BRACED_VAR}")).toBe("braced-value");
      delete process.env.TEST_BRACED_VAR;
    });

    it("returns undefined when env var is missing", () => {
      expect(resolver.resolve("$UNSET_VAR")).toBeUndefined();
      expect(resolver.resolve("${UNSET_VAR}")).toBeUndefined();
    });

    it("returns undefined for invalid env var syntax", () => {
      expect(resolver.resolve("$123invalid")).toBeUndefined();
      expect(resolver.resolve("$has-dash")).toBeUndefined();
    });

    it("executes a shell command and returns trimmed stdout", () => {
      mockExecSync.mockReturnValue("  my-secret-key  ");
      expect(resolver.resolve("!echo my-secret-key")).toBe("my-secret-key");
    });

    it("returns undefined when shell command fails", () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("command not found");
      });
      expect(resolver.resolve("!invalid-cmd")).toBeUndefined();
    });

    it("returns undefined when shell command returns empty output", () => {
      mockExecSync.mockReturnValue("");
      expect(resolver.resolve("!echo -n")).toBeUndefined();
    });
  });
});
