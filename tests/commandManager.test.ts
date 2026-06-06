import { beforeEach, describe, expect, it, vi } from "vitest";
import { Action } from "../src/enums/action";
import { CommandManager } from "../src/managers/command";
import { ServerManager } from "../src/managers/server";
import {
  createMockCtx,
  createMockModel,
  createMockPi,
  createMockServer,
  mockRpc,
} from "./mocks";

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockResolvedValue({ data: [] });
});

describe("CommandManager", () => {
  let serverManager: ServerManager;
  let commandManager: CommandManager;
  let mockPi: ReturnType<typeof createMockPi>;

  beforeEach(() => {
    mockPi = createMockPi();
    serverManager = new ServerManager([]);
    commandManager = new CommandManager(serverManager);
  });

  describe("getArgumentCompletions", () => {
    it("should provide completions for /models", () => {
      const completions = commandManager.getArgumentCompletions("");
      expect(completions).toHaveLength(2);
      expect(completions?.map((c) => c.value)).toEqual(["info", "unload"]);
    });

    it("should filter completions by prefix", () => {
      const completions = commandManager.getArgumentCompletions("u");
      expect(completions).toHaveLength(1);
      expect(completions?.[0].value).toBe("unload");
    });

    it("should return null when no completions match", () => {
      const completions = commandManager.getArgumentCompletions("zzz");
      expect(completions).toBeNull();
    });
  });

  describe("handleCommand", () => {
    it("should unload all models when args is 'unload'", async () => {
      const model1 = createMockModel("model-1");
      const model2 = createMockModel("model-2");
      const server = createMockServer({
        baseUrl: "http://127.0.0.1:8080",
        models: [model1, model2],
      });
      serverManager = new ServerManager([server] as any);
      commandManager = new CommandManager(serverManager);

      const ctx = {
        ui: {
          notify: vi.fn(),
          theme: { fg: (_: string, text: string) => text },
        },
      } as any;

      await commandManager.handleCommand("unload", ctx, mockPi as any);

      expect(model1.unload).toHaveBeenCalled();
      expect(model2.unload).toHaveBeenCalled();
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "Unloaded all Llama.cpp models",
        "info",
      );
    });

    it("should show model info when args is 'info'", async () => {
      const model1 = createMockModel("model-1");
      const model2 = createMockModel("model-2");
      const server = createMockServer({
        baseUrl: "http://127.0.0.1:8080",
        models: [model1, model2],
      });
      serverManager = new ServerManager([server] as any);
      commandManager = new CommandManager(serverManager);

      const ctx = {
        ui: {
          notify: vi.fn(),
          theme: { fg: (_: string, text: string) => text },
        },
      } as any;

      await commandManager.handleCommand("info", ctx, mockPi as any);

      expect(model1.getInfo).toHaveBeenCalled();
      expect(model2.getInfo).toHaveBeenCalled();
    });
  });

  describe("/models interactive menu", () => {
    const CHOICE = "model-a   [Server: http://127.0.0.1:8080]";

    /**
     * Helper to create a CommandManager with mock servers and models.
     */
    const createCommandManager = (
      models: ReturnType<typeof createMockModel>[],
    ) => {
      const mockPi = createMockPi();
      const servers = models.map((model) =>
        createMockServer({
          baseUrl: model.serverUrl,
          models: [model],
        }),
      );
      const serverManager = new ServerManager(servers as any);
      return {
        commandManager: new CommandManager(serverManager),
        serverManager,
        mockPi,
      };
    };

    it("should return early on cancel (null model selection)", async () => {
      const models = [createMockModel("model-a")];
      const { commandManager, mockPi } = createCommandManager(models);
      const ctx = createMockCtx(() => null);

      await commandManager.handleCommand("", ctx as any, mockPi as any);

      expect(ctx.ui.notify).not.toHaveBeenCalled();
    });

    it("should show info when INFO action is selected", async () => {
      const model = createMockModel("model-a");
      const { commandManager, mockPi } = createCommandManager([model]);
      let selectCallCount = 0;
      const ctx = createMockCtx(() => {
        selectCallCount++;
        if (selectCallCount === 1) return CHOICE;
        return Action.INFO;
      });

      await commandManager.handleCommand("", ctx as any, mockPi as any);

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "Model: model-a\nID: model-a",
        "info",
      );
    });

    it("should unload model when UNLOAD action is selected", async () => {
      const model = createMockModel("model-a");
      const { commandManager, mockPi } = createCommandManager([model]);
      let selectCallCount = 0;
      const ctx = createMockCtx(() => {
        selectCallCount++;
        if (selectCallCount === 1) return CHOICE;
        return Action.UNLOAD;
      });

      await commandManager.handleCommand("", ctx as any, mockPi as any);

      expect(model.unload).toHaveBeenCalled();
      expect(ctx.ui.notify).toHaveBeenCalledWith("Unloaded model-a", "info");
    });

    it("should switch model when SWITCH action is selected", async () => {
      const model = createMockModel("model-a");
      const { commandManager, mockPi } = createCommandManager([model]);
      let selectCallCount = 0;
      const ctx = createMockCtx(() => {
        selectCallCount++;
        if (selectCallCount === 1) return CHOICE;
        return Action.SWITCH;
      });

      await commandManager.handleCommand("", ctx as any, mockPi as any);

      expect(mockPi.setModel).toHaveBeenCalled();
      expect(ctx.ui.notify).toHaveBeenCalledWith("Model model-a ready", "info");
    });

    it("should loop back to model selection when action is cancelled", async () => {
      const model = createMockModel("model-a");
      const { commandManager, mockPi } = createCommandManager([model]);

      let selectCallCount = 0;
      const ctx = createMockCtx(() => {
        selectCallCount++;
        // 1st: select model-a, 2nd: cancel action, 3rd: cancel model => exit
        if (selectCallCount === 1) return CHOICE;
        return null;
      });

      await commandManager.handleCommand("", ctx as any, mockPi as any);

      expect(ctx.ui.select).toHaveBeenCalledTimes(3);
      expect(ctx.ui.notify).not.toHaveBeenCalled();
    });
  });
});
