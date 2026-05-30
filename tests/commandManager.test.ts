import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROVIDER_ID, PROVIDER_NAME } from "../src/constants";
import { CommandManager } from "../src/manager";

// Mock modules at top level (vi.mock is hoisted)
vi.mock("../src/tools/retriever", () => ({
  isServerReady: vi.fn(),
  listModels: vi.fn(),
}));

vi.mock("../src/tools/resolver", () => ({
  resolveUrl: vi.fn(),
  resolveApiKey: vi.fn(),
}));

// Import mocked functions after vi.mock
import { resolveApiKey, resolveUrl } from "../src/tools/resolver";
import { isServerReady, listModels } from "../src/tools/retriever";

const mockPi = {
  registerProvider: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  (resolveUrl as any).mockResolvedValue("http://127.0.0.1:8080");
  (resolveApiKey as any).mockResolvedValue("test-key");
});

describe("CommandManager", () => {
  it("should register empty models when server is not ready", async () => {
    (isServerReady as any).mockResolvedValue(false);

    const manager = new CommandManager(mockPi as any);
    await manager.initialize();

    expect(mockPi.registerProvider).toHaveBeenCalledWith(PROVIDER_ID, {
      name: PROVIDER_NAME,
      baseUrl: "http://127.0.0.1:8080",
      api: "openai-completions",
      apiKey: "test-key",
      models: [],
    });
  });

  it("should update and register models when server is ready", async () => {
    const mockModel = {
      name: "test-model",
      id: "test-model",
      toProviderConfig: vi
        .fn()
        .mockResolvedValue({ id: "test-model", maxTokens: 32000 }),
    };
    (isServerReady as any).mockResolvedValue(true);
    (listModels as any).mockResolvedValue([mockModel]);

    const manager = new CommandManager(mockPi as any);
    await manager.initialize();

    expect(resolveUrl).toHaveBeenCalledWith(expect.any(String));
    expect(listModels).toHaveBeenCalled();
    expect(mockPi.registerProvider).toHaveBeenCalledWith(PROVIDER_ID, {
      name: PROVIDER_NAME,
      baseUrl: "http://127.0.0.1:8080",
      api: "openai-completions",
      apiKey: "test-key",
      models: [{ id: "test-model", maxTokens: 32000 }],
    });
  });

  it("should call notFoundCommand when server is not ready in run()", async () => {
    (isServerReady as any).mockResolvedValue(false);

    const manager = new CommandManager(mockPi as any);
    await manager.run("", { ui: { notify: vi.fn() } } as any);

    expect(mockPi.registerProvider).not.toHaveBeenCalled();
  });

  it("should show info for all models when args is 'info'", async () => {
    const mockModel = {
      name: "test-model",
      id: "test-model",
      getInfo: vi.fn().mockResolvedValue("Model info for test-model"),
      toProviderConfig: vi.fn().mockResolvedValue({ id: "test-model" }),
    };
    (isServerReady as any).mockResolvedValue(true);
    (listModels as any).mockResolvedValue([mockModel]);

    const notifyFn = vi.fn();
    const manager = new CommandManager(mockPi as any);
    await manager.initialize();
    await manager.run("info", {
      ui: { notify: notifyFn, theme: { fg: (_c: string, t: string) => t } },
    } as any);

    expect(notifyFn).toHaveBeenCalledWith("Model info for test-model", "info");
    // Called once in initialize() and once in run() to refresh the model list
    expect(listModels).toHaveBeenCalledTimes(2);
  });

  it("should unload all models when args is 'unload'", async () => {
    const mockModel1 = {
      name: "model-1",
      id: "model-1",
      unload: vi.fn().mockResolvedValue(undefined),
      toProviderConfig: vi.fn().mockResolvedValue({ id: "model-1" }),
    };
    const mockModel2 = {
      name: "model-2",
      id: "model-2",
      unload: vi.fn().mockResolvedValue(undefined),
      toProviderConfig: vi.fn().mockResolvedValue({ id: "model-2" }),
    };
    (isServerReady as any).mockResolvedValue(true);
    (listModels as any).mockResolvedValue([mockModel1, mockModel2]);

    const notifyFn = vi.fn();
    const manager = new CommandManager(mockPi as any);
    await manager.initialize();
    await manager.run("unload", {
      ui: { notify: notifyFn },
    } as any);

    expect(mockModel1.unload).toHaveBeenCalled();
    expect(mockModel2.unload).toHaveBeenCalled();
    expect(notifyFn).toHaveBeenCalledWith(
      "Unloaded all Llama.cpp models",
      "info",
    );
  });

  it("should dispatch modelsCommand when args is empty", async () => {
    const mockModel = {
      name: "test-model",
      id: "test-model",
      getLabel: vi.fn().mockResolvedValue("test-model"),
      toProviderConfig: vi.fn().mockResolvedValue({ id: "test-model" }),
    };
    (isServerReady as any).mockResolvedValue(true);
    (listModels as any).mockResolvedValue([mockModel]);

    const selectFn = vi.fn().mockReturnValue(null); // cancel immediately
    const manager = new CommandManager(mockPi as any);
    await manager.initialize();
    await manager.run("", {
      ui: { notify: vi.fn(), select: selectFn },
    } as any);

    // modelsCommand was called (select is invoked for model picking)
    expect(selectFn).toHaveBeenCalled();
  });
});
