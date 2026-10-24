import { describe, expect, it, vi } from "vitest";
import { resolveApiKey, createLoginPrompt } from "../../src/utils/authBuilder";
import { API_KEY_PLACEHOLDER } from "../../src/constants";

describe("resolveApiKey", () => {
  it("resolves from a credential with a key", async () => {
    const result = await resolveApiKey({
      credential: { type: "api_key", key: "secret-key-123" },
    });
    expect(result).toEqual({
      auth: { apiKey: "secret-key-123" },
      source: "stored credential",
    });
  });

  it("resolves from a credential with env var", async () => {
    process.env.MY_API_KEY = "env-secret";
    const result = await resolveApiKey({
      credential: { type: "api_key", key: "${MY_API_KEY}" },
    });
    expect(result).toEqual({
      auth: { apiKey: "env-secret" },
      source: "stored credential",
    });
    delete process.env.MY_API_KEY;
  });

  it("resolves from settings when key is not the placeholder", async () => {
    const result = await resolveApiKey({ settingsKey: "settings-api-key" });
    expect(result).toEqual({
      auth: { apiKey: "settings-api-key" },
      source: "settings",
    });
  });

  it("returns undefined when credential has no key", async () => {
    const result = await resolveApiKey({
      credential: { type: "api_key" as const, key: undefined },
    });
    expect(result).toBeUndefined();
  });

  it("returns undefined when settingsKey is the placeholder", async () => {
    const result = await resolveApiKey({ settingsKey: API_KEY_PLACEHOLDER });
    expect(result).toBeUndefined();
  });

  it("returns undefined when neither credential nor settingsKey is provided", async () => {
    const result = await resolveApiKey({});
    expect(result).toBeUndefined();
  });

  it("prefers credential over settingsKey", async () => {
    const result = await resolveApiKey({
      credential: { type: "api_key", key: "cred-key" },
      settingsKey: "settings-key",
    });
    expect(result).toEqual({
      auth: { apiKey: "cred-key" },
      source: "stored credential",
    });
  });
});

describe("createLoginPrompt", () => {
  it("prompts for a secret key", async () => {
    const prompt = createLoginPrompt();
    const interaction = {
      signal: { throwIfAborted: () => {}, aborted: false },
      prompt: vi.fn().mockResolvedValue("my-api-key"),
    };
    const result = await prompt(interaction as any);
    expect(result).toEqual({ type: "api_key", key: "my-api-key" });
  });

  it("returns undefined key when the user provides an empty string", async () => {
    const prompt = createLoginPrompt();
    const interaction = {
      signal: { throwIfAborted: () => {}, aborted: false },
      prompt: vi.fn().mockResolvedValue(""),
    };
    const result = await prompt(interaction as any);
    expect(result).toEqual({ type: "api_key", key: undefined });
  });

  it("throws when the signal is aborted before prompt", async () => {
    const prompt = createLoginPrompt();
    const interaction = {
      signal: {
        throwIfAborted: () => {
          throw new Error("aborted");
        },
        aborted: true,
      },
      prompt: vi.fn(),
    };
    await expect(prompt(interaction as any)).rejects.toThrow("aborted");
  });
});
