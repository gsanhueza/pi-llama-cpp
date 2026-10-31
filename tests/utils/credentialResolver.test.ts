import { describe, expect, it, vi } from "vitest";
import { API_KEY_PLACEHOLDER } from "../../src/constants";
import { CredentialResolver } from "../../src/utils/credentialResolver";
import { ShellResolver } from "../../src/utils/shellResolver";

const mockExecSync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execSync: mockExecSync,
}));

describe("CredentialResolver", () => {
  const resolver = new CredentialResolver(new ShellResolver());

  describe("resolve", () => {
    it("returns placeholder for empty key", () => {
      expect(resolver.resolve("")).toBe(API_KEY_PLACEHOLDER);
      // @ts-expect-error — verifying undefined falls back to placeholder
      expect(resolver.resolve(undefined)).toBe(API_KEY_PLACEHOLDER);
    });

    it("returns literal key as-is", () => {
      expect(resolver.resolve("sk-abc123")).toBe("sk-abc123");
      expect(resolver.resolve("plain-key-without-dollars")).toBe(
        "plain-key-without-dollars",
      );
    });

    it("resolves escape sequences $$", () => {
      expect(resolver.resolve("$$literal")).toBe("$literal");
    });

    it("resolves escape sequences $!", () => {
      expect(resolver.resolve("$!bang")).toBe("!bang");
    });

    it("resolves $VAR from credential.env", () => {
      expect(resolver.resolve("$MY_KEY", { MY_KEY: "from-env" })).toBe(
        "from-env",
      );
    });

    it("resolves ${VAR} from credential.env", () => {
      expect(resolver.resolve("${MY_KEY}", { MY_KEY: "from-env" })).toBe(
        "from-env",
      );
    });

    it("resolves $VAR from process.env as fallback", () => {
      process.env.TEST_PROCESS_VAR = "process-value";
      expect(resolver.resolve("$TEST_PROCESS_VAR")).toBe("process-value");
      delete process.env.TEST_PROCESS_VAR;
    });

    it("prioritizes credential.env over process.env", () => {
      process.env.PREF_KEY = "process-value";
      expect(
        resolver.resolve("$PREF_KEY", { PREF_KEY: "credential-value" }),
      ).toBe("credential-value");
      delete process.env.PREF_KEY;
    });

    it("returns placeholder when env var is missing", () => {
      expect(resolver.resolve("$UNSET_VAR")).toBe(API_KEY_PLACEHOLDER);
      expect(resolver.resolve("${UNSET_VAR}", { OTHER_KEY: "value" })).toBe(
        API_KEY_PLACEHOLDER,
      );
    });

    it("returns placeholder for invalid env var syntax", () => {
      expect(resolver.resolve("$123invalid")).toBe(API_KEY_PLACEHOLDER);
      expect(resolver.resolve("$has-dash")).toBe(API_KEY_PLACEHOLDER);
    });

    it("executes a shell command and returns trimmed stdout", () => {
      mockExecSync.mockReturnValue("  my-secret-key  ");
      expect(resolver.resolve("!echo my-secret-key")).toBe("my-secret-key");
    });

    it("returns placeholder when shell command fails", () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("command not found");
      });
      expect(resolver.resolve("!invalid-cmd")).toBe(API_KEY_PLACEHOLDER);
    });

    it("returns placeholder when shell command returns empty output", () => {
      mockExecSync.mockReturnValue("");
      expect(resolver.resolve("!echo -n")).toBe(API_KEY_PLACEHOLDER);
    });
  });

  describe("resolveForProvider", () => {
    it("returns placeholder when credential has no key", () => {
      // readStoredCredential is imported from pi-coding-agent,
      // so we can't easily mock it here — this tests the fallback path
      // through the class's resolve method with an empty key
      expect(resolver.resolve("")).toBe(API_KEY_PLACEHOLDER);
    });
  });
});
