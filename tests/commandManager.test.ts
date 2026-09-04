import type { Theme } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Action } from "../src/enums/action";
import {
  applySettingChange,
  buildSettingsItems,
  CommandManager,
  formatMs,
} from "../src/managers/command";
import { ServerManager } from "../src/managers/server";
import { settings } from "../src/managers/settings";
import { ServerListEditor } from "../src/ui/serverListEditor";
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
      expect(completions).toHaveLength(4);
      expect(completions?.map((c) => c.value)).toEqual([
        "info",
        "unload",
        "servers",
        "settings",
      ]);
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

    it("should provide the server/settings completions by prefix", () => {
      const completions = commandManager.getArgumentCompletions("s");
      expect(completions?.map((c) => c.value)).toEqual(["servers", "settings"]);
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

  describe("settings menu helpers", () => {
    it("should format milliseconds compactly", () => {
      expect(formatMs(500)).toBe("500ms");
      expect(formatMs(60000)).toBe("60s");
      expect(formatMs(1500)).toBe("1500ms");
    });

    it("should build one item per editable scalar field", () => {
      const items = buildSettingsItems();
      expect(items.map((i) => i.id)).toEqual([
        "reactToModelSelect",
        "autoloadOnMessage",
        "sortBy",
        "pollingTimeout",
        "serverTimeout",
      ]);
      // Booleans are displayed as on/off
      expect(items[0].values).toEqual(["on", "off"]);
      // Timeouts cycle through formatted presets
      expect(items[3].values).toEqual(["15s", "30s", "60s", "120s", "300s"]);
      expect(items[4].values).toEqual(["500ms", "1s", "2s", "5s", "10s"]);
    });

    it("should map changes to the right key and type", async () => {
      const spy = vi
        .spyOn(settings, "setLlamaSetting")
        .mockResolvedValue(undefined);

      await applySettingChange("reactToModelSelect", "on");
      expect(spy).toHaveBeenCalledWith("reactToModelSelect", true);

      await applySettingChange("autoloadOnMessage", "off");
      expect(spy).toHaveBeenCalledWith("autoloadOnMessage", false);

      await applySettingChange("sortBy", "desc-name");
      expect(spy).toHaveBeenCalledWith("sortBy", "desc-name");

      await applySettingChange("pollingTimeout", "120s");
      expect(spy).toHaveBeenCalledWith("pollingTimeout", 120000);

      await applySettingChange("serverTimeout", "500ms");
      expect(spy).toHaveBeenCalledWith("serverTimeout", 500);

      spy.mockRestore();
    });
  });

  describe("/models settings menu", () => {
    it("should open the settings menu without touching servers", async () => {
      const updateSpy = vi
        .spyOn(serverManager, "update")
        .mockResolvedValue(undefined);
      const ctx = createMockCtx(() => null);

      await commandManager.handleCommand("settings", ctx as any, mockPi as any);

      expect(updateSpy).not.toHaveBeenCalled();
      expect(ctx.ui.notify).not.toHaveBeenCalled();
      expect(ctx.ui.custom).toHaveBeenCalledTimes(1);
    });

    it("should notify instead of opening the menu outside the TUI", async () => {
      const ctx = { ...createMockCtx(() => null), mode: "rpc" } as any;

      await commandManager.handleCommand("settings", ctx, mockPi as any);

      expect(ctx.ui.custom).not.toHaveBeenCalled();
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "/models settings requires an interactive session (TUI)",
        "warning",
      );
    });
  });

  describe("/models servers editor", () => {
    const ESC = "\x1b";
    const ENTER = "\r";

    const createMockKeybindings = (): KeybindingsManager =>
      ({
        matches: vi.fn(
          (data: string, name: string) =>
            (data === ENTER && name === "tui.select.confirm") ||
            (data === ESC && name === "tui.select.cancel"),
        ),
      }) as unknown as KeybindingsManager;

    const createMockTheme = (): Theme =>
      ({
        fg: (_color: string, text: string) => text,
        bold: (text: string) => text,
      }) as unknown as Theme;

    it("should open the editor without touching servers", async () => {
      const updateSpy = vi
        .spyOn(serverManager, "update")
        .mockResolvedValue(undefined);
      const ctx = createMockCtx(() => null);

      await commandManager.handleCommand("servers", ctx as any, mockPi as any);

      expect(updateSpy).not.toHaveBeenCalled();
      expect(ctx.ui.custom).toHaveBeenCalledTimes(1);
    });

    it("should notify instead of opening the editor outside the TUI", async () => {
      const ctx = { ...createMockCtx(() => null), mode: "rpc" } as any;

      await commandManager.handleCommand("servers", ctx, mockPi as any);

      expect(ctx.ui.custom).not.toHaveBeenCalled();
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "/models servers requires an interactive session (TUI)",
        "warning",
      );
    });

    it("should wire the editor to the merged servers and the write path", async () => {
      const llamaServersSpy = vi
        .spyOn(settings, "llamaServers", "get")
        .mockReturnValue([{ url: "http://seed:1" }]);
      const setSpy = vi
        .spyOn(settings, "setLlamaSetting")
        .mockResolvedValue(undefined);
      const ctx = createMockCtx(() => null);

      await commandManager.handleCommand("servers", ctx as any, mockPi as any);

      // Invoke the factory captured from ctx.ui.custom
      const factory = vi.mocked(ctx.ui.custom).mock.calls[0][0] as (
        tui: TUI,
        theme: Theme,
        kb: KeybindingsManager,
        done: (result: undefined) => void,
      ) => ServerListEditor;
      const done = vi.fn();
      const editor = factory(
        { requestRender: vi.fn() } as unknown as TUI,
        createMockTheme(),
        {
          matches: vi.fn(
            (data: string, name: string) =>
              (data === ENTER && name === "tui.select.confirm") ||
              (data === ESC && name === "tui.select.cancel"),
          ),
        } as unknown as KeybindingsManager,
        done,
      );

      expect(editor).toBeInstanceOf(ServerListEditor);
      // Seeded with the merged snapshot
      expect(editor.render(80).join("\n")).toContain("http://seed:1");

      // Add a server through the editor → setLlamaSetting("servers", …)
      editor.handleInput("a");
      for (const ch of "http://new:2") editor.handleInput(ch);
      editor.handleInput(ENTER);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(setSpy).toHaveBeenCalledWith("servers", [
        { url: "http://seed:1" },
        { url: "http://new:2" },
      ]);

      // Esc closes the editor
      editor.handleInput(ESC);
      expect(done).toHaveBeenCalledTimes(1);

      llamaServersSpy.mockRestore();
      setSpy.mockRestore();
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
