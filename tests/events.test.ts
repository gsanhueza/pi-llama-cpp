import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_THINKING_BUDGETS } from "../src/constants";
import { createMockModel, createMockServer } from "./mocks";

// Create a mutable mock object shared across tests
const mockSettingsManager = {
  getDefaultThinkingLevel: vi.fn(() => "medium"),
  getThinkingBudgets: vi.fn<() => Record<string, number> | undefined>(),
};

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...actual,
    SettingsManager: {
      create: () => mockSettingsManager,
    },
  };
});

let EventManager: typeof import("../src/managers/events").EventManager;

beforeAll(async () => {
  const mod = await vi.importActual("../src/managers/events");
  EventManager =
    mod.EventManager as typeof import("../src/managers/events").EventManager;
});

beforeEach(() => {
  vi.restoreAllMocks();
  EventManager.resetInflightModel();
  mockSettingsManager.getDefaultThinkingLevel.mockReturnValue("medium");
  mockSettingsManager.getThinkingBudgets.mockReturnValue(undefined);
});

const createPayload = (modelId: string) => ({
  model: modelId,
  messages: [{ role: "user", content: "hello" }],
});

const createNonLlamaPayload = () => ({
  model: "gpt-4",
  messages: [{ role: "user", content: "hello" }],
});

describe("EventManager.onBeforeProviderRequest", () => {
  describe("normal usage — each thinking level", () => {
    it.each([
      {
        level: "off",
        expected: { chat_template_kwargs: { enable_thinking: false } },
      },
      { level: "minimal", expected: { thinking_budget_tokens: 1024 } },
      { level: "low", expected: { thinking_budget_tokens: 2048 } },
      { level: "medium", expected: { thinking_budget_tokens: 8192 } },
      { level: "high", expected: { thinking_budget_tokens: 16384 } },
      { level: "xhigh", expected: {} },
    ])(
      'level "$level" should return $expected',
      async ({ level, expected }) => {
        mockSettingsManager.getDefaultThinkingLevel.mockReturnValue(level);

        const server = createMockServer({
          models: ["model-a"].map((id) => createMockModel(id)),
        });
        const eventManager = new EventManager([server]);
        const event = { payload: createPayload("model-a") };

        const result = (await eventManager.onBeforeProviderRequest(
          event as any,
        )) as Record<string, unknown>;

        expect(result.model).toBe("model-a");
        expect(result).toMatchObject(expected);
      },
    );

    it("should preserve original payload fields alongside new ones", async () => {
      mockSettingsManager.getDefaultThinkingLevel.mockReturnValue("low");

      const server = createMockServer({
        models: ["model-b"].map((id) => createMockModel(id)),
      });
      const eventManager = new EventManager([server]);
      const event = {
        payload: {
          model: "model-b",
          messages: [{ role: "user", content: "test" }],
          temperature: 0.7,
        },
      };

      const result = (await eventManager.onBeforeProviderRequest(
        event as any,
      )) as Record<string, unknown>;

      expect(result.messages).toEqual([{ role: "user", content: "test" }]);
      expect(result.temperature).toBe(0.7);
      expect(result.thinking_budget_tokens).toBe(DEFAULT_THINKING_BUDGETS.low);
    });
  });

  describe("non-llama.cpp models", () => {
    it("should return the payload unchanged for unknown models", async () => {
      const server = createMockServer({
        models: ["model-a"].map((id) => createMockModel(id)),
      });
      const eventManager = new EventManager([server]);
      const event = { payload: createNonLlamaPayload() };

      const result = await eventManager.onBeforeProviderRequest(event as any);

      expect(result).toEqual(createNonLlamaPayload());
    });
  });

  describe("missing model in payload", () => {
    it("should return the payload unchanged when model is absent", async () => {
      const server = createMockServer({
        models: ["model-a"].map((id) => createMockModel(id)),
      });
      const eventManager = new EventManager([server]);
      const event = { payload: { messages: [] } };

      const result = await eventManager.onBeforeProviderRequest(event as any);

      expect(result).toEqual({ messages: [] });
    });
  });

  describe("user-defined budget overrides", () => {
    it("should use user-defined budgets instead of defaults", async () => {
      mockSettingsManager.getDefaultThinkingLevel.mockReturnValue("low");
      mockSettingsManager.getThinkingBudgets.mockReturnValue({ low: 4096 });

      const server = createMockServer({
        models: ["model-a"].map((id) => createMockModel(id)),
      });
      const eventManager = new EventManager([server]);
      const event = { payload: createPayload("model-a") };

      const result = (await eventManager.onBeforeProviderRequest(
        event as any,
      )) as Record<string, unknown>;

      expect(result.thinking_budget_tokens).toBe(4096);
    });

    it("should merge user budgets with defaults (partial override)", async () => {
      mockSettingsManager.getDefaultThinkingLevel.mockReturnValue("medium");
      mockSettingsManager.getThinkingBudgets.mockReturnValue({ low: 4096 });

      const server = createMockServer({
        models: ["model-a"].map((id) => createMockModel(id)),
      });
      const eventManager = new EventManager([server]);
      const event = { payload: createPayload("model-a") };

      const result = (await eventManager.onBeforeProviderRequest(
        event as any,
      )) as Record<string, unknown>;

      // medium uses default since user only overrode low
      expect(result.thinking_budget_tokens).toBe(
        DEFAULT_THINKING_BUDGETS.medium,
      );
    });
  });

  // ─── Edge cases ─────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("should ignore invalid keys in user budgets (they are silently dropped)", async () => {
      mockSettingsManager.getDefaultThinkingLevel.mockReturnValue("medium");
      mockSettingsManager.getThinkingBudgets.mockReturnValue({
        foo: 999,
        bar: 123,
      } as any);

      const server = createMockServer({
        models: ["model-a"].map((id) => createMockModel(id)),
      });
      const eventManager = new EventManager([server]);
      const event = { payload: createPayload("model-a") };

      const result = (await eventManager.onBeforeProviderRequest(
        event as any,
      )) as Record<string, unknown>;

      // Should fall back to default since "medium" is not in user budgets
      expect(result.thinking_budget_tokens).toBe(
        DEFAULT_THINKING_BUDGETS.medium,
      );
    });

    it("should not allow overriding 'off' — thinking stays disabled", async () => {
      mockSettingsManager.getDefaultThinkingLevel.mockReturnValue("off");
      mockSettingsManager.getThinkingBudgets.mockReturnValue({
        off: 99999,
      } as any);

      const server = createMockServer({
        models: ["model-a"].map((id) => createMockModel(id)),
      });
      const eventManager = new EventManager([server]);
      const event = { payload: createPayload("model-a") };

      const result = (await eventManager.onBeforeProviderRequest(
        event as any,
      )) as Record<string, unknown>;

      expect(result).toMatchObject({
        chat_template_kwargs: { enable_thinking: false },
      });
      expect(result).not.toHaveProperty("thinking_budget_tokens");
    });

    it("should not allow overriding 'xhigh' — no budget is injected", async () => {
      mockSettingsManager.getDefaultThinkingLevel.mockReturnValue("xhigh");
      mockSettingsManager.getThinkingBudgets.mockReturnValue({
        xhigh: 1,
      } as any);

      const server = createMockServer({
        models: ["model-a"].map((id) => createMockModel(id)),
      });
      const eventManager = new EventManager([server]);
      const event = { payload: createPayload("model-a") };

      const result = (await eventManager.onBeforeProviderRequest(
        event as any,
      )) as Record<string, unknown>;

      expect(result).toEqual(createPayload("model-a"));
      expect(result).not.toHaveProperty("thinking_budget_tokens");
    });

    it("should handle empty user budgets gracefully", async () => {
      mockSettingsManager.getDefaultThinkingLevel.mockReturnValue("high");
      mockSettingsManager.getThinkingBudgets.mockReturnValue({});

      const server = createMockServer({
        models: ["model-a"].map((id) => createMockModel(id)),
      });
      const eventManager = new EventManager([server]);
      const event = { payload: createPayload("model-a") };

      const result = (await eventManager.onBeforeProviderRequest(
        event as any,
      )) as Record<string, unknown>;

      expect(result.thinking_budget_tokens).toBe(DEFAULT_THINKING_BUDGETS.high);
    });
  });
});
