import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROVIDER_ID, PROVIDER_NAME } from "../src/constants";
import { CommandManager } from "../src/managers/command";
import { BaseModel } from "../src/models/baseModel";
import { createMockServer, mockRpc } from "./mocks";

const mockPi = {
  registerProvider: vi.fn(),
  registerCommand: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockResolvedValue({});
});

describe("CommandManager", () => {
  it("should register empty models when server is not ready", async () => {
    const server = {
      ...createMockServer({ apiKey: "test-key" }),
      isReady: () => Promise.resolve(false),
    };
    const manager = new CommandManager(mockPi as any, server as any);
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
    } as unknown as BaseModel;
    const server = {
      ...createMockServer({ apiKey: "test-key" }),
      models: [mockModel],
    };

    const manager = new CommandManager(mockPi as any, server as any);
    await manager.initialize();

    expect(mockPi.registerProvider).toHaveBeenCalledWith(PROVIDER_ID, {
      name: PROVIDER_NAME,
      baseUrl: "http://127.0.0.1:8080",
      api: "openai-completions",
      apiKey: "test-key",
      models: [{ id: "test-model", maxTokens: 32000 }],
    });
  });

  it("should call notFoundCommand when server is not ready in run()", async () => {
    const server = {
      ...createMockServer({ apiKey: "test-key" }),
      isReady: () => Promise.resolve(false),
    };
    const manager = new CommandManager(mockPi as any, server as any);
    const cmd = manager.setupModelsCommand();
    await cmd.handler("", {
      cwd: "/tmp/test",
      ui: { notify: vi.fn() } as any,
    } as any);

    expect(mockPi.registerProvider).not.toHaveBeenCalled();
  });

  it("should show info for all models when args is 'info'", async () => {
    const mockModel = {
      name: "test-model",
      id: "test-model",
      getInfo: vi.fn().mockResolvedValue("Model info for test-model"),
      toProviderConfig: vi.fn().mockResolvedValue({ id: "test-model" }),
    } as unknown as BaseModel;
    const server = {
      ...createMockServer({ apiKey: "test-key" }),
      models: [mockModel],
    };

    const notifyFn = vi.fn();
    const manager = new CommandManager(mockPi as any, server as any);
    await manager.initialize();
    const cmd = manager.setupModelsCommand();
    await cmd.handler("info", {
      ui: { notify: notifyFn, theme: { fg: (_c: string, t: string) => t } },
    } as any);

    expect(notifyFn).toHaveBeenCalledWith("Model info for test-model", "info");
  });

  it("should unload all models when args is 'unload'", async () => {
    const mockModel1 = {
      name: "model-1",
      id: "model-1",
      unload: vi.fn().mockResolvedValue(undefined),
      toProviderConfig: vi.fn().mockResolvedValue({ id: "model-1" }),
    } as unknown as BaseModel;
    const mockModel2 = {
      name: "model-2",
      id: "model-2",
      unload: vi.fn().mockResolvedValue(undefined),
      toProviderConfig: vi.fn().mockResolvedValue({ id: "model-2" }),
    } as unknown as BaseModel;
    const server = {
      ...createMockServer({ apiKey: "test-key" }),
      models: [mockModel1, mockModel2],
    };

    const notifyFn = vi.fn();
    const manager = new CommandManager(mockPi as any, server as any);
    await manager.initialize();
    const cmd = manager.setupModelsCommand();
    await cmd.handler("unload", {
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
    } as unknown as BaseModel;
    const server = {
      ...createMockServer({ apiKey: "test-key" }),
      models: [mockModel],
    };

    const selectFn = vi.fn().mockReturnValue(null); // cancel immediately
    const manager = new CommandManager(mockPi as any, server as any);
    await manager.initialize();
    const cmd = manager.setupModelsCommand();
    await cmd.handler("", {
      ui: { notify: vi.fn(), select: selectFn },
    } as any);

    // modelsCommand was called (select is invoked for model picking)
    expect(selectFn).toHaveBeenCalled();
  });
});
