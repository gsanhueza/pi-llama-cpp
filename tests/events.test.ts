import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { THINKING_BUDGETS } from "../src/constants";
import { Status } from "../src/enums/status";
import type { Server } from "../src/server";
import { createMockModel, createMockServer } from "./mocks";

// Mock settings — reactToModelSelect and autoloadOnMessage
const mockSettings = {
  resolveReactToModelSelect: vi.fn(() => true),
  resolveAutoloadOnMessage: vi.fn(() => false),
  resolveSortBy: vi.fn(() => "asc"),
  resolveServers: vi.fn((): Server[] => []),
  takeWarnings: vi.fn(() => [] as string[]),
  resolveThinkingLevel: vi.fn(() => "medium"),
  resolveThinkingBudgets: vi.fn(() => ({ ...THINKING_BUDGETS })),
};

// Wire resolveThinkingBudgets to use the SettingsManager mock when set
mockSettings.resolveThinkingBudgets.mockImplementation(() => {
  const userBudgets = mockSettingsManager.getThinkingBudgets();
  if (userBudgets) {
    return { ...THINKING_BUDGETS, ...userBudgets };
  }
  return { ...THINKING_BUDGETS };
});

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

vi.mock("../src/managers/settings", () => ({
  settings: mockSettings,
}));

let EventManager: typeof import("../src/managers/events").EventManager;
let ServerManager: typeof import("../src/managers/server").ServerManager;

beforeAll(async () => {
  const mod = await vi.importActual("../src/managers/events");
  EventManager =
    mod.EventManager as typeof import("../src/managers/events").EventManager;
  const serverMod = await vi.importActual("../src/managers/server");
  ServerManager =
    serverMod.ServerManager as typeof import("../src/managers/server").ServerManager;
});

/**
 * Builds an EventManager on a ServerManager stub exposing `servers`.
 * (The real ServerManager is exercised in the live-list test below.)
 */
const createEventManager = (...servers: Server[]) =>
  new EventManager({
    servers,
  } as unknown as import("../src/managers/server").ServerManager);

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

const createMockCtx = (
  thinkingLevel?:
    | "off"
    | "minimal"
    | "low"
    | "medium"
    | "high"
    | "xhigh"
    | "max",
) =>
  ({
    thinkingLevel,
    ui: { notify: vi.fn() },
  }) as any;

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
      { level: "xhigh", expected: { thinking_budget_tokens: 32768 } },
      { level: "max", expected: {} },
    ])(
      'level "$level" should return $expected',
      async ({ level, expected }) => {
        mockSettingsManager.getDefaultThinkingLevel.mockReturnValue(level);

        const server = createMockServer({
          models: ["model-a"].map((id) => createMockModel(id)),
        });
        const eventManager = createEventManager(server);
        const event = { payload: createPayload("model-a") };

        const ctx = createMockCtx(level as any);
        const result = (await eventManager.onBeforeProviderRequest(
          event as any,
          ctx,
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
      const eventManager = createEventManager(server);
      const event = {
        payload: {
          model: "model-b",
          messages: [{ role: "user", content: "test" }],
          temperature: 0.7,
        },
      };

      const ctx = createMockCtx("low");
      const result = (await eventManager.onBeforeProviderRequest(
        event as any,
        ctx,
      )) as Record<string, unknown>;

      expect(result.messages).toEqual([{ role: "user", content: "test" }]);
      expect(result.temperature).toBe(0.7);
      expect(result.thinking_budget_tokens).toBe(THINKING_BUDGETS.low);
    });
  });

  describe("non-llama.cpp models", () => {
    it("should return the payload unchanged for unknown models", async () => {
      const server = createMockServer({
        models: ["model-a"].map((id) => createMockModel(id)),
      });
      const eventManager = createEventManager(server);
      const event = { payload: createNonLlamaPayload() };

      const ctx = createMockCtx();
      const result = await eventManager.onBeforeProviderRequest(
        event as any,
        ctx,
      );

      expect(result).toEqual(createNonLlamaPayload());
    });
  });

  describe("missing model in payload", () => {
    it("should return the payload unchanged when model is absent", async () => {
      const server = createMockServer({
        models: ["model-a"].map((id) => createMockModel(id)),
      });
      const eventManager = createEventManager(server);
      const event = { payload: { messages: [] } };

      const ctx = createMockCtx();
      const result = await eventManager.onBeforeProviderRequest(
        event as any,
        ctx,
      );

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
      const eventManager = createEventManager(server);
      const event = { payload: createPayload("model-a") };

      const ctx = createMockCtx("low");
      const result = (await eventManager.onBeforeProviderRequest(
        event as any,
        ctx,
      )) as Record<string, unknown>;

      expect(result.thinking_budget_tokens).toBe(4096);
    });

    it("should merge user budgets with defaults (partial override)", async () => {
      mockSettingsManager.getDefaultThinkingLevel.mockReturnValue("medium");
      mockSettingsManager.getThinkingBudgets.mockReturnValue({ low: 4096 });

      const server = createMockServer({
        models: ["model-a"].map((id) => createMockModel(id)),
      });
      const eventManager = createEventManager(server);
      const event = { payload: createPayload("model-a") };

      const ctx = createMockCtx("medium");
      const result = (await eventManager.onBeforeProviderRequest(
        event as any,
        ctx,
      )) as Record<string, unknown>;

      // medium uses default since user only overrode low
      expect(result.thinking_budget_tokens).toBe(THINKING_BUDGETS.medium);
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
      const eventManager = createEventManager(server);
      const event = { payload: createPayload("model-a") };

      const ctx = createMockCtx("medium");
      const result = (await eventManager.onBeforeProviderRequest(
        event as any,
        ctx,
      )) as Record<string, unknown>;

      // Should fall back to default since "medium" is not in user budgets
      expect(result.thinking_budget_tokens).toBe(THINKING_BUDGETS.medium);
    });

    it("should not allow overriding 'off' — thinking stays disabled", async () => {
      mockSettingsManager.getDefaultThinkingLevel.mockReturnValue("off");
      mockSettingsManager.getThinkingBudgets.mockReturnValue({
        off: 99999,
      } as any);

      const server = createMockServer({
        models: ["model-a"].map((id) => createMockModel(id)),
      });
      const eventManager = createEventManager(server);
      const event = { payload: createPayload("model-a") };

      const ctx = createMockCtx("off");
      const result = (await eventManager.onBeforeProviderRequest(
        event as any,
        ctx,
      )) as Record<string, unknown>;

      expect(result).toMatchObject({
        chat_template_kwargs: { enable_thinking: false },
      });
      expect(result).not.toHaveProperty("thinking_budget_tokens");
    });

    it("should not inject budget for 'max' — unlimited reasoning", async () => {
      mockSettingsManager.getDefaultThinkingLevel.mockReturnValue("max");
      mockSettingsManager.getThinkingBudgets.mockReturnValue({
        max: 1,
      } as any);

      const server = createMockServer({
        models: ["model-a"].map((id) => createMockModel(id)),
      });
      const eventManager = createEventManager(server);
      const event = { payload: createPayload("model-a") };

      const ctx = createMockCtx("max");
      const result = (await eventManager.onBeforeProviderRequest(
        event as any,
        ctx,
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
      const eventManager = createEventManager(server);
      const event = { payload: createPayload("model-a") };

      const ctx = createMockCtx("high");
      const result = (await eventManager.onBeforeProviderRequest(
        event as any,
        ctx,
      )) as Record<string, unknown>;

      expect(result.thinking_budget_tokens).toBe(THINKING_BUDGETS.high);
    });
  });
});

describe("EventManager.onModelSelect", () => {
  beforeEach(() => {
    mockSettings.resolveReactToModelSelect.mockReturnValue(true);
  });

  it("should load the model when reactToModelSelect is true", async () => {
    const server = createMockServer({
      models: ["model-a"].map((id) => createMockModel(id)),
    });
    const eventManager = createEventManager(server);
    const ctx = createMockCtx();

    const event = {
      model: { provider: server.providerId, id: "model-a" },
    } as any;

    await eventManager.onModelSelect(event, ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Loading model-a...", "info");
  });

  it("should return early when reactToModelSelect is false", async () => {
    mockSettings.resolveReactToModelSelect.mockReturnValue(false);

    const server = createMockServer({
      models: ["model-a"].map((id) => createMockModel(id)),
    });
    const eventManager = createEventManager(server);
    const ctx = createMockCtx();

    const event = {
      model: { provider: server.providerId, id: "model-a" },
    } as any;

    await eventManager.onModelSelect(event, ctx);

    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });
});

describe("EventManager.autoLoadIfNeeded", () => {
  it("should load the model when autoloadOnMessage is true and model is UNLOADED", async () => {
    mockSettings.resolveAutoloadOnMessage.mockReturnValue(true);

    const server = createMockServer({
      models: [
        createMockModel("model-a", {
          getStatus: vi.fn().mockResolvedValue(Status.UNLOADED),
          load: vi.fn().mockResolvedValue(undefined),
        }),
      ],
    });
    const eventManager = createEventManager(server);
    const model = server.models[0];

    await (eventManager as any).autoLoadIfNeeded(model);

    expect(model.load).toHaveBeenCalled();
  });

  it("should not load the model when autoloadOnMessage is false", async () => {
    mockSettings.resolveAutoloadOnMessage.mockReturnValue(false);

    const server = createMockServer({
      models: [
        createMockModel("model-a", {
          getStatus: vi.fn().mockResolvedValue(Status.UNLOADED),
          load: vi.fn().mockResolvedValue(undefined),
        }),
      ],
    });
    const eventManager = createEventManager(server);
    const model = server.models[0];

    await (eventManager as any).autoLoadIfNeeded(model);

    expect(model.load).not.toHaveBeenCalled();
  });

  it("should not load the model when model is already LOADED", async () => {
    mockSettings.resolveAutoloadOnMessage.mockReturnValue(true);

    const server = createMockServer({
      models: [
        createMockModel("model-a", {
          getStatus: vi.fn().mockResolvedValue(Status.LOADED),
          load: vi.fn().mockResolvedValue(undefined),
        }),
      ],
    });
    const eventManager = createEventManager(server);
    const model = server.models[0];

    await (eventManager as any).autoLoadIfNeeded(model);

    expect(model.load).not.toHaveBeenCalled();
  });

  it("should not load the model when model is SLEEPING", async () => {
    mockSettings.resolveAutoloadOnMessage.mockReturnValue(true);

    const server = createMockServer({
      models: [
        createMockModel("model-a", {
          getStatus: vi.fn().mockResolvedValue(Status.SLEEPING),
          load: vi.fn().mockResolvedValue(undefined),
        }),
      ],
    });
    const eventManager = createEventManager(server);
    const model = server.models[0];

    await (eventManager as any).autoLoadIfNeeded(model);

    expect(model.load).not.toHaveBeenCalled();
  });
});

describe("EventManager with a live ServerManager", () => {
  it("should observe servers added after construction", async () => {
    const serverA = createMockServer({
      providerId: "llama-server=http://127.0.0.1:8080",
      models: [createMockModel("model-a")],
      initialize: async () => {},
    });
    const serverB = createMockServer({
      baseUrl: "http://127.0.0.1:8081",
      providerId: "llama-server=http://127.0.0.1:8081",
      models: [
        createMockModel("model-b", { serverUrl: "http://127.0.0.1:8081" }),
      ],
      initialize: async () => {},
    });

    mockSettings.resolveServers.mockReturnValue([serverA]);
    const serverManager = new ServerManager();
    const mockPi = { registerProvider: vi.fn(), unregisterProvider: vi.fn() };
    await serverManager.update(mockPi as any);

    const eventManager = new EventManager(serverManager);

    // Second scan adds serverB — no manager re-construction
    mockSettings.resolveServers.mockReturnValue([serverA, serverB]);
    await serverManager.update(mockPi as any);

    // onBeforeProviderRequest sees the new server's models
    const ctx = createMockCtx("medium");
    const result = (await eventManager.onBeforeProviderRequest(
      { payload: createPayload("model-b") } as any,
      ctx,
    )) as Record<string, unknown>;
    expect(result.thinking_budget_tokens).toBe(THINKING_BUDGETS.medium);

    // onModelSelect sees the new server's models too
    mockSettings.resolveReactToModelSelect.mockReturnValue(true);
    const selectCtx = createMockCtx();
    await eventManager.onModelSelect(
      { model: { provider: serverB.providerId, id: "model-b" } } as any,
      selectCtx,
    );
    expect(selectCtx.ui.notify).toHaveBeenCalledWith(
      "Loading model-b...",
      "info",
    );
  });
});
