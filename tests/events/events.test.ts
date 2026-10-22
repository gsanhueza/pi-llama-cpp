import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { ModelSelectEvent } from "../../src/interfaces/events";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { READABLE_TIMEOUT, THINKING_BUDGETS } from "../../src/constants";
import { defaultBaseUrl } from "../constants";
import { ServerStatus } from "../../src/enums/serverStatus";
import { Status } from "../../src/enums/status";
import { EventManager } from "../../src/managers/events";
import { Model } from "../../src/models/model";
import { ServerManager } from "../../src/managers/server";
import { InflightTracker } from "../../src/managers/inflightTracker";
import type { Server } from "../../src/servers/server";
import { createMockModel } from "../mocks/model";
import { createMockPi } from "../mocks/context";
import { createMockServer, createTestServer } from "../mocks/server";
import { makeSettingsStub } from "../mocks/settings";

/**
 * Injected settings stub (EventManager and — in the live-list test — the
 * real ServerManager). Recreated in `beforeEach` so per-case overrides
 * (budgets, autoload, …) cannot leak between tests.
 */
let settingsStub = makeSettingsStub();
let mockPi = createMockPi();
/** Fresh per test — injected into EventManager, so no singleton reset. */
let tracker = new InflightTracker();

/**
 * Builds an EventManager on a ServerManager stub exposing `servers` and
 * `getServer`. (The real ServerManager is exercised in the live-list test
 * below.)
 */
const createStubServerManager = (servers: Server[]): ServerManager =>
  ({
    servers,
    getServer: (model: Model) =>
      servers.find((s) => s.models.some((m) => m.id === model.id)),
    update: vi.fn(async () => {}),
  }) as Partial<ServerManager> as ServerManager;

const createEventManager = (...servers: Server[]) =>
  new EventManager(createStubServerManager(servers), settingsStub, tracker);

beforeEach(() => {
  vi.restoreAllMocks();
  tracker = new InflightTracker();
  settingsStub = makeSettingsStub();
  mockPi = createMockPi();
});

const createPayload = (modelId: string) => ({
  model: modelId,
  messages: [{ role: "user", content: "hello" }],
});

const createNonLlamaPayload = () => ({
  model: "gpt-4",
  messages: [{ role: "user", content: "hello" }],
});

/** Build a typed BeforeProviderRequestEvent. */
const createBeforeProviderRequestEvent = (
  payload: Record<string, unknown>,
) => ({
  type: "before_provider_request" as const,
  payload,
});

/** Build a typed ModelSelectEvent. */
const createModelSelectEvent = (
  providerId: string,
  modelId: string,
): ModelSelectEvent =>
  ({
    type: "model_select",
    model: { provider: providerId, id: modelId },
    previousModel: undefined,
    source: "set",
  }) as Partial<ModelSelectEvent> as ModelSelectEvent;

const createMockCtx = (thinkingLevel?: ThinkingLevel): ExtensionContext =>
  ({
    thinkingLevel,
    ui: { notify: vi.fn(), setStatus: vi.fn() },
  }) as unknown as ExtensionContext;

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
        vi.mocked(settingsStub.resolveThinkingLevel).mockReturnValue(
          level as ModelThinkingLevel,
        );

        const server = createMockServer({
          models: ["model-a"].map((id) => createMockModel(id)),
        });
        const eventManager = createEventManager(server);

        const ctx = createMockCtx(level as ThinkingLevel);
        const result = (await eventManager.onBeforeProviderRequest(
          createBeforeProviderRequestEvent(createPayload("model-a")),
          ctx,
          mockPi,
        )) as Record<string, unknown>;

        expect(result.model).toBe("model-a");
        expect(result).toMatchObject(expected);
      },
    );

    it("should preserve original payload fields alongside new ones", async () => {
      vi.mocked(settingsStub.resolveThinkingLevel).mockReturnValue("low");

      const server = createMockServer({
        models: ["model-b"].map((id) => createMockModel(id)),
      });
      const eventManager = createEventManager(server);

      const ctx = createMockCtx("low");
      const result = (await eventManager.onBeforeProviderRequest(
        createBeforeProviderRequestEvent({
          model: "model-b",
          messages: [{ role: "user", content: "test" }],
          temperature: 0.7,
        }),
        ctx,
        mockPi,
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

      const ctx = createMockCtx();
      const result = await eventManager.onBeforeProviderRequest(
        createBeforeProviderRequestEvent(createNonLlamaPayload()),
        ctx,
        mockPi,
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

      const ctx = createMockCtx();
      const result = await eventManager.onBeforeProviderRequest(
        createBeforeProviderRequestEvent({ messages: [] }),
        ctx,
        mockPi,
      );

      expect(result).toEqual({ messages: [] });
    });
  });

  describe("user-defined budget overrides", () => {
    it("should use user-defined budgets instead of defaults", async () => {
      vi.mocked(settingsStub.resolveThinkingLevel).mockReturnValue("low");
      vi.mocked(settingsStub.resolveThinkingBudgets).mockReturnValue({
        ...THINKING_BUDGETS,
        low: 4096,
      });

      const server = createMockServer({
        models: ["model-a"].map((id) => createMockModel(id)),
      });
      const eventManager = createEventManager(server);

      const ctx = createMockCtx("low");
      const result = (await eventManager.onBeforeProviderRequest(
        createBeforeProviderRequestEvent(createPayload("model-a")),
        ctx,
        mockPi,
      )) as Record<string, unknown>;

      expect(result.thinking_budget_tokens).toBe(4096);
    });

    it("should merge user budgets with defaults (partial override)", async () => {
      vi.mocked(settingsStub.resolveThinkingLevel).mockReturnValue("medium");
      vi.mocked(settingsStub.resolveThinkingBudgets).mockReturnValue({
        ...THINKING_BUDGETS,
        low: 4096,
      });

      const server = createMockServer({
        models: ["model-a"].map((id) => createMockModel(id)),
      });
      const eventManager = createEventManager(server);

      const ctx = createMockCtx("medium");
      const result = (await eventManager.onBeforeProviderRequest(
        createBeforeProviderRequestEvent(createPayload("model-a")),
        ctx,
        mockPi,
      )) as Record<string, unknown>;

      // medium uses default since user only overrode low
      expect(result.thinking_budget_tokens).toBe(THINKING_BUDGETS.medium);
    });
  });

  // ─── Edge cases ─────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("should ignore invalid keys in user budgets (they are silently dropped)", async () => {
      vi.mocked(settingsStub.resolveThinkingLevel).mockReturnValue("medium");
      vi.mocked(settingsStub.resolveThinkingBudgets).mockReturnValue({
        ...THINKING_BUDGETS,
        foo: 999,
        bar: 123,
      } as Record<string, number>);

      const server = createMockServer({
        models: ["model-a"].map((id) => createMockModel(id)),
      });
      const eventManager = createEventManager(server);

      const ctx = createMockCtx("medium");
      const result = (await eventManager.onBeforeProviderRequest(
        createBeforeProviderRequestEvent(createPayload("model-a")),
        ctx,
        mockPi,
      )) as Record<string, unknown>;

      // Should fall back to default since "medium" is not in user budgets
      expect(result.thinking_budget_tokens).toBe(THINKING_BUDGETS.medium);
    });

    it("should not allow overriding 'off' — thinking stays disabled", async () => {
      vi.mocked(settingsStub.resolveThinkingLevel).mockReturnValue("off");
      vi.mocked(settingsStub.resolveThinkingBudgets).mockReturnValue({
        ...THINKING_BUDGETS,
        off: 99999,
      });

      const server = createMockServer({
        models: ["model-a"].map((id) => createMockModel(id)),
      });
      const eventManager = createEventManager(server);

      const ctx = createMockCtx("off");
      const result = (await eventManager.onBeforeProviderRequest(
        createBeforeProviderRequestEvent(createPayload("model-a")),
        ctx,
        mockPi,
      )) as Record<string, unknown>;

      expect(result).toMatchObject({
        chat_template_kwargs: { enable_thinking: false },
      });
      expect(result).not.toHaveProperty("thinking_budget_tokens");
    });

    it("should not inject budget for 'max' — unlimited reasoning", async () => {
      vi.mocked(settingsStub.resolveThinkingLevel).mockReturnValue("max");
      vi.mocked(settingsStub.resolveThinkingBudgets).mockReturnValue({
        ...THINKING_BUDGETS,
        max: 1,
      });

      const server = createMockServer({
        models: ["model-a"].map((id) => createMockModel(id)),
      });
      const eventManager = createEventManager(server);

      const ctx = createMockCtx("max");
      const result = (await eventManager.onBeforeProviderRequest(
        createBeforeProviderRequestEvent(createPayload("model-a")),
        ctx,
        mockPi,
      )) as Record<string, unknown>;

      expect(result).toEqual(createPayload("model-a"));
      expect(result).not.toHaveProperty("thinking_budget_tokens");
    });

    it("should handle empty user budgets gracefully", async () => {
      vi.mocked(settingsStub.resolveThinkingLevel).mockReturnValue("high");
      // No user overrides — the resolver returns the default budget table
      vi.mocked(settingsStub.resolveThinkingBudgets).mockReturnValue({
        ...THINKING_BUDGETS,
      });

      const server = createMockServer({
        models: ["model-a"].map((id) => createMockModel(id)),
      });
      const eventManager = createEventManager(server);

      const ctx = createMockCtx("high");
      const result = (await eventManager.onBeforeProviderRequest(
        createBeforeProviderRequestEvent(createPayload("model-a")),
        ctx,
        mockPi,
      )) as Record<string, unknown>;

      expect(result.thinking_budget_tokens).toBe(THINKING_BUDGETS.high);
    });
  });
});

describe("EventManager.onModelSelect", () => {
  beforeEach(() => {
    vi.mocked(settingsStub.resolveReactToModelSelect).mockResolvedValue(true);
  });

  it("should load the model when reactToModelSelect is true", async () => {
    const server = createMockServer({
      models: ["model-a"].map((id) => createMockModel(id)),
    });
    const eventManager = createEventManager(server);
    const ctx = createMockCtx();

    const event = createModelSelectEvent(server.providerId, "model-a");

    await eventManager.onModelSelect(event, ctx, mockPi);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Loading model-a...", "info");
  });

  it("should return early when reactToModelSelect is false", async () => {
    vi.mocked(settingsStub.resolveReactToModelSelect).mockResolvedValue(false);

    const server = createMockServer({
      models: ["model-a"].map((id) => createMockModel(id)),
    });
    const eventManager = createEventManager(server);
    const ctx = createMockCtx();

    const event = createModelSelectEvent(server.providerId, "model-a");

    await eventManager.onModelSelect(event, ctx, mockPi);

    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });

  it("should return early when the model is not found in the server", async () => {
    const server = createMockServer({
      models: ["model-a"].map((id) => createMockModel(id)),
    });
    const eventManager = createEventManager(server);
    const ctx = createMockCtx();

    const event = createModelSelectEvent(server.providerId, "model-z");

    await eventManager.onModelSelect(event, ctx, mockPi);

    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });
});

describe("EventManager.autoLoadIfNeeded (via onBeforeProviderRequest)", () => {
  it("should load the model when autoloadOnMessage is true and model is UNLOADED", async () => {
    vi.mocked(settingsStub.resolveAutoloadOnMessage).mockResolvedValue(true);

    const server = createTestServer(defaultBaseUrl(), [
      createMockModel("model-a", {
        getStatus: vi.fn().mockResolvedValue(Status.UNLOADED),
        load: vi.fn().mockResolvedValue(undefined),
      }),
    ]);
    const eventManager = createEventManager(server);
    const ctx = createMockCtx();

    await eventManager.onBeforeProviderRequest(
      createBeforeProviderRequestEvent(createPayload("model-a")),
      ctx,
      mockPi,
    );

    expect(server.models[0].load).toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith("Loading model-a...", "info");
  });

  it("should not load the model when autoloadOnMessage is false", async () => {
    vi.mocked(settingsStub.resolveAutoloadOnMessage).mockResolvedValue(false);

    const server = createTestServer(defaultBaseUrl(), [
      createMockModel("model-a", {
        getStatus: vi.fn().mockResolvedValue(Status.UNLOADED),
        load: vi.fn().mockResolvedValue(undefined),
      }),
    ]);
    const eventManager = createEventManager(server);
    const ctx = createMockCtx();

    await eventManager.onBeforeProviderRequest(
      createBeforeProviderRequestEvent(createPayload("model-a")),
      ctx,
      mockPi,
    );

    expect(server.models[0].load).not.toHaveBeenCalled();
  });

  it("should not load the model when model is already LOADED", async () => {
    vi.mocked(settingsStub.resolveAutoloadOnMessage).mockResolvedValue(true);

    const server = createTestServer(defaultBaseUrl(), [
      createMockModel("model-a", {
        getStatus: vi.fn().mockResolvedValue(Status.LOADED),
        load: vi.fn().mockResolvedValue(undefined),
      }),
    ]);
    const eventManager = createEventManager(server);
    const ctx = createMockCtx();

    await eventManager.onBeforeProviderRequest(
      createBeforeProviderRequestEvent(createPayload("model-a")),
      ctx,
      mockPi,
    );

    expect(server.models[0].load).not.toHaveBeenCalled();
  });

  it("should not load the model when model is SLEEPING", async () => {
    vi.mocked(settingsStub.resolveAutoloadOnMessage).mockResolvedValue(true);

    const server = createTestServer(defaultBaseUrl(), [
      createMockModel("model-a", {
        getStatus: vi.fn().mockResolvedValue(Status.SLEEPING),
        load: vi.fn().mockResolvedValue(undefined),
      }),
    ]);
    const eventManager = createEventManager(server);
    const ctx = createMockCtx();

    await eventManager.onBeforeProviderRequest(
      createBeforeProviderRequestEvent(createPayload("model-a")),
      ctx,
      mockPi,
    );

    expect(server.models[0].load).not.toHaveBeenCalled();
  });

  it("should wait for an in-flight load when model is LOADING", async () => {
    vi.mocked(settingsStub.resolveAutoloadOnMessage).mockResolvedValue(true);

    let loadResolve!: () => void;
    const loadPromise = new Promise<void>((resolve) => {
      loadResolve = resolve;
    });
    const model = createMockModel("model-a", {
      getStatus: vi.fn().mockResolvedValue(Status.LOADING),
      load: vi.fn().mockReturnValue(loadPromise),
    });

    // Simulate a prior /models load: set inflightModel and inflightPromise
    tracker.setInflight(model, loadPromise);

    const server = createTestServer(defaultBaseUrl(), [model]);
    const eventManager = createEventManager(server);
    const ctx = createMockCtx();

    const before = Date.now();
    const requestPromise = eventManager.onBeforeProviderRequest(
      createBeforeProviderRequestEvent(createPayload("model-a")),
      ctx,
      mockPi,
    );

    // Delay resolving the in-flight load so we can measure the wait
    setTimeout(() => loadResolve!(), 50);

    await requestPromise;
    const elapsed = Date.now() - before;

    // Should NOT call load again (it was already in-flight)
    expect(model.load).not.toHaveBeenCalled();
    // Should have waited for the inflight load to complete
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });
});

describe("EventManager.loadWithFeedback with SSE", () => {
  it("should subscribe to SSE progress when the server supports it", async () => {
    vi.mocked(settingsStub.resolveAutoloadOnMessage).mockResolvedValue(true);
    vi.mocked(settingsStub.resolveEnableSSE).mockResolvedValue(true);

    const server = createTestServer(defaultBaseUrl(), [
      createMockModel("model-a", {
        getStatus: vi.fn().mockResolvedValue(Status.UNLOADED),
        load: vi.fn().mockResolvedValue(undefined),
      }),
    ]);
    // Make probeSSE return true so the SSE path is taken
    vi.spyOn(server.sseManager!, "probeSSE").mockResolvedValue(true);

    const eventManager = createEventManager(server);
    const ctx = createMockCtx();

    await eventManager.onBeforeProviderRequest(
      createBeforeProviderRequestEvent(createPayload("model-a")),
      ctx,
      mockPi,
    );

    // loadWithFeedback fires immediately with the loading notification
    expect(ctx.ui.notify).toHaveBeenCalledWith("Loading model-a...", "info");
  });
});

describe("EventManager.loadWithFeedback", () => {
  it("should call pi.setModel when the model is found in the registry", async () => {
    vi.mocked(settingsStub.resolveAutoloadOnMessage).mockResolvedValue(true);

    const server = createTestServer(defaultBaseUrl(), [
      createMockModel("model-a", {
        getStatus: vi.fn().mockResolvedValue(Status.UNLOADED),
        load: vi.fn().mockResolvedValue(undefined),
      }),
    ]);
    const eventManager = createEventManager(server);

    // Build a context with a modelRegistry that finds the model
    const findModel = { id: "pi-model-id" };
    const ctx = {
      ui: { notify: vi.fn(), setStatus: vi.fn() },
      modelRegistry: { find: vi.fn().mockReturnValue(findModel) },
    } as unknown as ExtensionContext;

    await eventManager.loadWithFeedback(server.models[0], ctx, mockPi);

    expect(ctx.modelRegistry.find).toHaveBeenCalledWith(
      server.models[0].serverId,
      "model-a",
    );
    expect(mockPi.setModel).toHaveBeenCalledWith(findModel);
  });
});

describe("EventManager.onSessionBeforeSwitch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should notify when a session changes during an in-flight load", async () => {
    const server = createTestServer(defaultBaseUrl(), [
      createMockModel("model-a", {
        load: vi.fn().mockResolvedValue(undefined),
      }),
    ]);
    const eventManager = createEventManager(server);

    // Simulate an inflight model
    tracker.setInflight(
      server.models[0],
      new Promise(() => {}), // never resolves
    );

    const ctx = createMockCtx();
    const promise = eventManager.onSessionBeforeSwitch(ctx);

    // Advance timers to let the setTimeout resolve
    await vi.advanceTimersByTimeAsync(READABLE_TIMEOUT);
    await promise;

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("[pi-llama-cpp]"),
      "warning",
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Session change detected"),
      "warning",
    );
  });

  it("should do nothing when there is no inflight model", async () => {
    const server = createTestServer(defaultBaseUrl(), [
      createMockModel("model-a"),
    ]);
    const eventManager = createEventManager(server);
    const ctx = createMockCtx();

    await eventManager.onSessionBeforeSwitch(ctx);

    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });
});

describe("EventManager with a live ServerManager", () => {
  it("should observe servers added after construction", async () => {
    // Models are seeded into manager-built Servers via the server factory,
    // mirroring what a real `Server.initialize()` fetch would produce.
    vi.mocked(settingsStub.resolveServerConfigs).mockResolvedValue([
      { baseUrl: "http://127.0.0.1:9931" },
    ]);
    const serverManager = new ServerManager(settingsStub, {
      create: async (_resolver, options) => {
        const server = createMockServer({
          options: { baseUrl: options.baseUrl },
          models:
            options.baseUrl === "http://127.0.0.1:8081"
              ? [createMockModel("model-b", { serverUrl: options.baseUrl })]
              : [createMockModel("model-a", { serverUrl: options.baseUrl })],
        });
        return { server, status: ServerStatus.READY };
      },
    });
    const mockPi: ExtensionAPI = {
      registerProvider: vi.fn(),
      unregisterProvider: vi.fn(),
    } as Partial<ExtensionAPI> as ExtensionAPI;
    await serverManager.update(mockPi);

    const eventManager = new EventManager(serverManager, settingsStub, tracker);

    // Second scan adds the 8081 server — no manager re-construction
    vi.mocked(settingsStub.resolveServerConfigs).mockResolvedValue([
      { baseUrl: "http://127.0.0.1:9931" },
      { baseUrl: "http://127.0.0.1:8081" },
    ]);
    await serverManager.update(mockPi);

    // onBeforeProviderRequest sees the new server's models
    const ctx = createMockCtx("medium");
    const result = (await eventManager.onBeforeProviderRequest(
      createBeforeProviderRequestEvent(createPayload("model-b")),
      ctx,
      mockPi,
    )) as Record<string, unknown>;
    expect(result.thinking_budget_tokens).toBe(THINKING_BUDGETS.medium);

    // onModelSelect sees the new server's models too
    vi.mocked(settingsStub.resolveReactToModelSelect).mockResolvedValue(true);
    const selectCtx = createMockCtx();
    await eventManager.onModelSelect(
      createModelSelectEvent("llama-server=http://127.0.0.1:8081", "model-b"),
      selectCtx,
      mockPi,
    );
    expect(selectCtx.ui.notify).toHaveBeenCalledWith(
      "Loading model-b...",
      "info",
    );
  });
});

describe("loadWithFeedback SSE progress with stage", () => {
  it("should include the stage in the progress notification", async () => {
    vi.mocked(settingsStub.resolveAutoloadOnMessage).mockResolvedValue(true);
    vi.mocked(settingsStub.resolveEnableSSE).mockResolvedValue(true);

    const server = createTestServer(defaultBaseUrl(), [
      createMockModel("model-b", {
        getStatus: vi.fn().mockResolvedValue(Status.UNLOADED),
        load: vi.fn().mockResolvedValue(undefined),
      }),
    ]);
    vi.spyOn(server.sseManager!, "probeSSE").mockResolvedValue(true);
    vi.spyOn(server.sseManager!, "subscribeToProgress").mockImplementation(
      (_modelId, callback) => {
        callback(50, "text_model");
        return () => {};
      },
    );

    const eventManager = createEventManager(server);
    const ctx = createMockCtx();

    await eventManager.onBeforeProviderRequest(
      createBeforeProviderRequestEvent(createPayload("model-b")),
      ctx,
      mockPi,
    );

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Loading model-b... [50% (text_model)]",
      "info",
    );
  });
});

describe("loadWithFeedback model failure", () => {
  it("should not show error when load() succeeds even if status is FAILED", async () => {
    vi.mocked(settingsStub.resolveAutoloadOnMessage).mockResolvedValue(true);
    vi.mocked(settingsStub.resolveEnableSSE).mockResolvedValue(false);

    const server = createTestServer(defaultBaseUrl(), [
      createMockModel("model-c", {
        getStatus: vi
          .fn()
          .mockResolvedValueOnce(Status.UNLOADED)
          .mockResolvedValueOnce(Status.FAILED),
        load: vi.fn().mockResolvedValue(undefined),
      }),
    ]);

    const eventManager = createEventManager(server);
    const ctx = createMockCtx();

    await eventManager.onBeforeProviderRequest(
      createBeforeProviderRequestEvent(createPayload("model-c")),
      ctx,
      mockPi,
    );

    // load() succeeded, so no error notification — the redundant status
    // check was removed to avoid false failures after a successful load.
    expect(ctx.ui.notify).toHaveBeenCalledWith("Model model-c ready", "info");
  });
});

describe("EventManager.unloadModel", () => {
  it("should notify on unload success and re-scan providers", async () => {
    const server = createTestServer(defaultBaseUrl(), [
      createMockModel("model-a", {
        unload: vi.fn().mockResolvedValue(undefined),
      }),
    ]);
    const eventManager = createEventManager(server);
    const ctx = createMockCtx();

    await eventManager.unloadModel(server.models[0], ctx, mockPi);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Unloading model-a...", "info");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Unloaded model-a", "info");
  });

  it("should notify on error and still re-scan providers", async () => {
    const server = createTestServer(defaultBaseUrl(), [
      createMockModel("model-a", {
        unload: vi.fn().mockRejectedValue(new Error("unload failed")),
      }),
    ]);
    const eventManager = createEventManager(server);
    const ctx = createMockCtx();

    await eventManager.unloadModel(server.models[0], ctx, mockPi);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Unloading model-a...", "info");
    expect(ctx.ui.notify).toHaveBeenCalledWith("unload failed", "error");
  });
});
