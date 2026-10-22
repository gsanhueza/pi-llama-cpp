import { beforeEach, describe, expect, it, vi } from "vitest";
import { Action } from "../../../src/enums/action";
import { Mode } from "../../../src/enums/mode";
import { Status } from "../../../src/enums/status";
import { ModelsMenu } from "../../../src/managers/menus/models";
import { EventManager } from "../../../src/managers/events";
import { Model } from "../../../src/models/model";
import type { ServerManager } from "../../../src/managers/server";
import type { SettingsService } from "../../../src/settings/settings";
import { makeSettingsStub } from "../../mocks/settings";
import { createMockPi } from "../../mocks/context";

let mockServerManager: ServerManager;
let mockSettings: SettingsService;
let mockEventManager: EventManager;
let menu: ModelsMenu;

beforeEach(() => {
  mockServerManager = {
    getAllModels: vi.fn(),
    getServer: vi.fn(),
    servers: [],
    update: vi.fn(),
    getWarnings: vi.fn().mockReturnValue([]),
    getFailedUrls: vi.fn().mockReturnValue([]),
  } as unknown as ServerManager;
  mockSettings = makeSettingsStub();
  mockEventManager = {
    loadWithFeedback: vi.fn(),
    unloadModel: vi.fn(),
  } as unknown as EventManager;
  menu = new ModelsMenu(mockServerManager, mockSettings, mockEventManager);
});

describe("ModelsMenu.show - Switch action", () => {
  it("should throw when piModel is not found", async () => {
    const mockModel = {
      name: "test-model",
      id: "test-model-id",
      serverId: "test-provider",
      serverUrl: "http://127.0.0.1:9931",
      server: { mode: Mode.ROUTER },
      getStatus: vi.fn().mockResolvedValue(Status.LOADED),
      getInfo: vi.fn().mockResolvedValue("test info"),
      getLabel: vi.fn().mockResolvedValue("test-model"),
      unload: vi.fn().mockResolvedValue(undefined),
    } as unknown as Model;
    const mockPi = createMockPi();
    const mockCtx = {
      ui: {
        notify: vi.fn(),
        select: vi.fn(),
      },
      modelRegistry: {
        find: vi.fn().mockReturnValue(null),
      },
    } as never;

    // Stub the private methods to bypass the select flow
    const selectModelSpy = vi
      .spyOn(menu as any, "selectModel")
      .mockResolvedValue(mockModel);
    const selectActionSpy = vi
      .spyOn(menu as any, "selectAction")
      .mockResolvedValue(Action.SWITCH);

    vi.spyOn(mockServerManager, "getAllModels").mockResolvedValue([mockModel]);

    await expect(menu.show(mockCtx, mockPi)).rejects.toThrow(
      "Cannot find model test-model in pi registry",
    );

    expect(selectModelSpy).toHaveBeenCalled();
    expect(selectActionSpy).toHaveBeenCalled();
  });
});

describe("ModelsMenu.show - Load action", () => {
  it("should call loadWithFeedback for LOAD action", async () => {
    const mockModel = {
      name: "test-model",
      id: "test-model-id",
      serverId: "test-provider",
      serverUrl: "http://127.0.0.1:9931",
      server: { mode: Mode.ROUTER },
      getStatus: vi.fn().mockResolvedValue(Status.UNLOADED),
      getInfo: vi.fn().mockResolvedValue("test info"),
      getLabel: vi.fn().mockResolvedValue("test-model"),
      unload: vi.fn().mockResolvedValue(undefined),
    } as unknown as Model;
    const mockPi = createMockPi();
    const mockCtx = {
      ui: {
        notify: vi.fn(),
        select: vi.fn(),
      },
      modelRegistry: {
        find: vi.fn().mockReturnValue({ id: "pi-model-id" }),
      },
    } as never;

    const selectModelSpy = vi
      .spyOn(menu as any, "selectModel")
      .mockResolvedValue(mockModel);
    const selectActionSpy = vi
      .spyOn(menu as any, "selectAction")
      .mockResolvedValue(Action.LOAD);

    vi.spyOn(mockServerManager, "getAllModels").mockResolvedValue([mockModel]);

    await menu.show(mockCtx, mockPi);

    expect(selectModelSpy).toHaveBeenCalled();
    expect(selectActionSpy).toHaveBeenCalled();
    expect(mockEventManager.loadWithFeedback).toHaveBeenCalledWith(
      mockModel,
      expect.any(Object),
      mockPi,
    );
  });

  it("should call loadWithFeedback for RETRY action", async () => {
    const mockModel = {
      name: "retry-model",
      id: "retry-model-id",
      serverId: "test-provider",
      serverUrl: "http://127.0.0.1:9931",
      server: { mode: Mode.ROUTER },
      getStatus: vi.fn().mockResolvedValue(Status.FAILED),
      getInfo: vi.fn().mockResolvedValue("test info"),
      getLabel: vi.fn().mockResolvedValue("retry-model"),
      unload: vi.fn().mockResolvedValue(undefined),
    } as unknown as Model;
    const mockPi = createMockPi();
    const mockCtx = {
      ui: {
        notify: vi.fn(),
        select: vi.fn(),
      },
      modelRegistry: {
        find: vi.fn().mockReturnValue({ id: "pi-model-id" }),
      },
    } as never;

    const selectModelSpy = vi
      .spyOn(menu as any, "selectModel")
      .mockResolvedValue(mockModel);
    const selectActionSpy = vi
      .spyOn(menu as any, "selectAction")
      .mockResolvedValue(Action.RETRY);

    vi.spyOn(mockServerManager, "getAllModels").mockResolvedValue([mockModel]);

    await menu.show(mockCtx, mockPi);

    expect(selectModelSpy).toHaveBeenCalled();
    expect(selectActionSpy).toHaveBeenCalled();
    expect(mockEventManager.loadWithFeedback).toHaveBeenCalledWith(
      mockModel,
      expect.any(Object),
      mockPi,
    );
  });
});

describe("ModelsMenu.show - Unload action", () => {
  it("should call unloadModel for UNLOAD action", async () => {
    const mockModel = {
      name: "test-model",
      id: "test-model-id",
      serverId: "test-provider",
      serverUrl: "http://127.0.0.1:9931",
      server: { mode: Mode.ROUTER },
      getStatus: vi.fn().mockResolvedValue(Status.LOADED),
      getInfo: vi.fn().mockResolvedValue("test info"),
      getLabel: vi.fn().mockResolvedValue("test-model"),
      unload: vi.fn().mockResolvedValue(undefined),
    } as unknown as Model;
    const mockPi = createMockPi();
    const mockCtx = {
      ui: {
        notify: vi.fn(),
        select: vi.fn(),
      },
      modelRegistry: {
        find: vi.fn().mockReturnValue({ id: "pi-model-id" }),
      },
    } as never;

    const selectModelSpy = vi
      .spyOn(menu as any, "selectModel")
      .mockResolvedValue(mockModel);
    const selectActionSpy = vi
      .spyOn(menu as any, "selectAction")
      .mockResolvedValue(Action.UNLOAD);

    vi.spyOn(mockServerManager, "getAllModels").mockResolvedValue([mockModel]);

    await menu.show(mockCtx, mockPi);

    expect(selectModelSpy).toHaveBeenCalled();
    expect(selectActionSpy).toHaveBeenCalled();
    expect(mockEventManager.unloadModel).toHaveBeenCalledWith(
      mockModel,
      expect.any(Object),
      mockPi,
    );
  });
});

describe("ModelsMenu.show - Cancel action", () => {
  it("should return early for CANCEL action", async () => {
    const mockModel = {
      name: "test-model",
      id: "test-model-id",
      serverId: "test-provider",
      serverUrl: "http://127.0.0.1:9931",
      server: { mode: Mode.ROUTER },
      getStatus: vi.fn().mockResolvedValue(Status.LOADED),
      getInfo: vi.fn().mockResolvedValue("test info"),
      getLabel: vi.fn().mockResolvedValue("test-model"),
      unload: vi.fn().mockResolvedValue(undefined),
    } as unknown as Model;
    const mockPi = createMockPi();
    const mockCtx = {
      ui: {
        notify: vi.fn(),
        select: vi.fn(),
      },
      modelRegistry: {
        find: vi.fn().mockReturnValue({ id: "pi-model-id" }),
      },
    } as never;

    const selectModelSpy = vi
      .spyOn(menu as any, "selectModel")
      .mockResolvedValue(mockModel);
    const selectActionSpy = vi
      .spyOn(menu as any, "selectAction")
      .mockResolvedValue(Action.CANCEL);

    vi.spyOn(mockServerManager, "getAllModels").mockResolvedValue([mockModel]);

    await menu.show(mockCtx, mockPi);

    expect(selectModelSpy).toHaveBeenCalled();
    expect(selectActionSpy).toHaveBeenCalled();
    expect(mockEventManager.loadWithFeedback).not.toHaveBeenCalled();
  });
});
