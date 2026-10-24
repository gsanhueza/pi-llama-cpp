import { initTheme } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Action } from "../../src/enums/action";
import { ServerStatus } from "../../src/enums/serverStatus";
import { CommandManager } from "../../src/managers/command";
import { EventManager } from "../../src/managers/events";
import { ServerManager } from "../../src/managers/server";
import type { SettingsService } from "../../src/settings/settings";
import { SETTINGS_ITEMS } from "../../src/settings/defaults";
import { formatMs } from "../../src/settings/options";
import { ServersView } from "../../src/ui/views/serversView";
import { OverridesView } from "../../src/ui/views/overridesView";
import { ServerDisplay } from "../../src/ui/editors/server/utils";
import {
  createMockCtx,
  createMockCommandCtx,
  createMockPi,
} from "../mocks/context";
import { createMockModel } from "../mocks/model";
import { createMockTui } from "../mocks/tui";
import { createMockServer } from "../mocks/server";
import { mockResolver, mockServerOptions } from "../mocks/server";
import { createServerFactory } from "../mocks/serverFactory";
import { makeSettingsStub } from "../mocks/settings";
import { createMockRpc } from "../mocks/mockRpc";

/** Per-file isolated mock RPC. */
const mockRpc = createMockRpc();

beforeEach(() => {
  initTheme();
  vi.clearAllMocks();
  mockRpc.mockResolvedValue({ data: [] });
  // Mock health checks to return immediately
  vi.spyOn(ServerDisplay, "healthEmoji").mockResolvedValue("🟢");
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Creates a minimal EventManager for CommandManager tests.
 */
const createMockEventManager = (
  serverManager: ServerManager,
  settingsStub: SettingsService,
) => new EventManager(serverManager, settingsStub);

describe("CommandManager", () => {
  let serverManager: ServerManager;
  let commandManager: CommandManager;
  let settingsStub: SettingsService;
  let mockPi: ReturnType<typeof createMockPi>;
  let eventManager: ReturnType<typeof createMockEventManager>;

  beforeEach(() => {
    mockPi = createMockPi();
    settingsStub = makeSettingsStub();
    serverManager = new ServerManager(settingsStub, createServerFactory());
    eventManager = createMockEventManager(serverManager, settingsStub);
    commandManager = new CommandManager(
      serverManager,
      settingsStub,
      eventManager,
    );
  });

  describe("getArgumentCompletions", () => {
    it("should provide completions for /models", () => {
      const completions = commandManager.getArgumentCompletions("");
      expect(completions).toHaveLength(5);
      expect(completions?.map((c) => c.value)).toEqual([
        "info",
        "unload",
        "settings",
        "servers",
        "overrides",
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
      expect(completions?.map((c) => c.value)).toEqual(["settings", "servers"]);
    });
  });

  describe("handleCommand", () => {
    it("should unload all models when args is 'unload'", async () => {
      const model1 = createMockModel("model-1");
      const model2 = createMockModel("model-2");
      const server = createMockServer({
        options: { baseUrl: "http://127.0.0.1:9931" },
        models: [model1, model2],
      });
      const unloadSettings = makeSettingsStub({
        resolveServerConfigs: vi.fn(async () => [{ baseUrl: server.baseUrl }]),
      });
      serverManager = new ServerManager(unloadSettings, {
        create: async () => {
          const mockServer = createMockServer({
            resolver: mockResolver,
            options: mockServerOptions,
            models: [...server.models],
          });
          return { server: mockServer, status: ServerStatus.READY };
        },
      });
      const unloadEventManager = createMockEventManager(
        serverManager,
        unloadSettings,
      );
      commandManager = new CommandManager(
        serverManager,
        unloadSettings,
        unloadEventManager,
      );

      const ctx = createMockCtx(() => null);

      await commandManager.handleCommand("unload", ctx, mockPi);

      // Unloading is fire-and-forget: the "Unloading..." notification
      // and the model.unload() calls happen synchronously; the
      // "Unloaded all" notification fires later after the settled promise.
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "Unloading Llama.cpp models...",
        "info",
      );
      expect(model1.unload).toHaveBeenCalled();
      expect(model2.unload).toHaveBeenCalled();
    });

    it("should show model info when args is 'info'", async () => {
      const model1 = createMockModel("model-1");
      const model2 = createMockModel("model-2");
      const server = createMockServer({
        options: { baseUrl: "http://127.0.0.1:9931" },
        models: [model1, model2],
      });
      const infoSettings = makeSettingsStub({
        resolveServerConfigs: vi.fn(async () => [{ baseUrl: server.baseUrl }]),
      });
      serverManager = new ServerManager(infoSettings, {
        create: async () => {
          const mockServer = createMockServer({
            resolver: mockResolver,
            options: mockServerOptions,
            models: [...server.models],
          });
          return { server: mockServer, status: ServerStatus.READY };
        },
      });
      const infoEventManager = createMockEventManager(
        serverManager,
        infoSettings,
      );
      commandManager = new CommandManager(
        serverManager,
        infoSettings,
        infoEventManager,
      );

      const ctx = createMockCtx(() => null);

      await commandManager.handleCommand("info", ctx, mockPi);

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

    it("should have one item per editable scalar field", () => {
      const ids = Object.keys(SETTINGS_ITEMS);
      expect(ids).toEqual([
        "reactToModelSelect",
        "autoloadOnMessage",
        "sortBy",
        "pollingInterval",
        "pollingTimeout",
        "serverTimeout",
        "showServerUrls",
        "enableSSE",
      ]);
      // Booleans are displayed as on/off
      expect(SETTINGS_ITEMS["reactToModelSelect"].values).toEqual([
        "on",
        "off",
      ]);
      // Timeouts cycle through formatted presets
      expect(SETTINGS_ITEMS["pollingTimeout"].values).toEqual([
        "15s",
        "30s",
        "60s",
        "120s",
        "300s",
      ]);
      expect(SETTINGS_ITEMS["serverTimeout"].values).toEqual([
        "500ms",
        "1s",
        "2s",
        "5s",
        "10s",
      ]);
    });

    it("should format settings correctly from config", () => {
      const config = {
        reactToModelSelect: true,
        autoloadOnMessage: false,
        sortBy: "desc-name" as const,
        pollingTimeout: 120000,
        serverTimeout: 500,
        showServerUrls: true,
      };

      expect(SETTINGS_ITEMS["reactToModelSelect"].format(config)).toBe("on");
      expect(SETTINGS_ITEMS["autoloadOnMessage"].format(config)).toBe("off");
      expect(SETTINGS_ITEMS["sortBy"].format(config)).toBe("Descending (name)");
      expect(SETTINGS_ITEMS["pollingTimeout"].format(config)).toBe("120s");
      expect(SETTINGS_ITEMS["serverTimeout"].format(config)).toBe("500ms");
      expect(SETTINGS_ITEMS["showServerUrls"].format(config)).toBe("on");
    });

    it("should set config values correctly", () => {
      const reactResult = SETTINGS_ITEMS["reactToModelSelect"].setConfig(
        {},
        "on",
      );
      expect(reactResult).toEqual({
        valid: true,
        config: { reactToModelSelect: true },
      });

      const autoloadResult = SETTINGS_ITEMS["autoloadOnMessage"].setConfig(
        {},
        "off",
      );
      expect(autoloadResult).toEqual({
        valid: true,
        config: { autoloadOnMessage: false },
      });

      const sortByResult = SETTINGS_ITEMS["sortBy"].setConfig(
        {},
        "Descending (name)",
      );
      expect(sortByResult).toEqual({
        valid: true,
        config: { sortBy: "desc-name" },
      });

      const pollingResult = SETTINGS_ITEMS["pollingTimeout"].setConfig(
        {},
        "120s",
      );
      expect(pollingResult).toEqual({
        valid: true,
        config: { pollingTimeout: 120000 },
      });

      const serverResult = SETTINGS_ITEMS["serverTimeout"].setConfig(
        {},
        "500ms",
      );
      expect(serverResult).toEqual({
        valid: true,
        config: { serverTimeout: 500 },
      });

      const showResult = SETTINGS_ITEMS["showServerUrls"].setConfig({}, "on");
      expect(showResult).toEqual({
        valid: true,
        config: { showServerUrls: true },
      });
    });
  });

  describe("/models settings menu", () => {
    it("should open the settings menu without touching servers", async () => {
      const updateSpy = vi
        .spyOn(serverManager, "update")
        .mockResolvedValue(undefined);
      const ctx = createMockCtx(() => null);

      await commandManager.handleCommand("settings", ctx, mockPi);

      expect(updateSpy).not.toHaveBeenCalled();
      expect(ctx.ui.notify).not.toHaveBeenCalled();
      expect(ctx.ui.custom).toHaveBeenCalledTimes(1);
    });

    it("should notify instead of opening the menu outside the TUI", async () => {
      const ctx = createMockCommandCtx(() => null, { mode: "rpc" });

      await commandManager.handleCommand("settings", ctx, mockPi);

      expect(ctx.ui.custom).not.toHaveBeenCalled();
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "[pi-llama-cpp]\n/models settings requires an interactive session (TUI)",
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
            (data === ESC && name === "tui.select.cancel") ||
            (data === "\x1b[A" && name === "tui.select.up") ||
            (data === "\x1b[B" && name === "tui.select.down"),
        ),
      }) as Partial<KeybindingsManager> as KeybindingsManager;

    const createMockTheme = (): Theme =>
      ({
        fg: (_color: string, text: string) => text,
        bold: (text: string) => text,
      }) as Partial<Theme> as Theme;

    it("should re-register providers after the editor closes", async () => {
      const updateSpy = vi
        .spyOn(serverManager, "update")
        .mockResolvedValue(undefined);
      const ctx = createMockCtx(() => null);

      await commandManager.handleCommand("servers", ctx, mockPi);

      expect(ctx.ui.custom).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenCalledTimes(1);
      // Re-registration happens on close, not on open. The mock dialog
      // resolves immediately, so the update call must come after custom.
      expect(updateSpy.mock.invocationCallOrder[0]).toBeGreaterThan(
        vi.mocked(ctx.ui.custom).mock.invocationCallOrder[0],
      );
    });

    it("should notify instead of opening the editor outside the TUI", async () => {
      const ctx = createMockCommandCtx(() => null, { mode: "rpc" });

      await commandManager.handleCommand("servers", ctx, mockPi);

      expect(ctx.ui.custom).not.toHaveBeenCalled();
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "[pi-llama-cpp]\n/models servers requires an interactive session (TUI)",
        "warning",
      );
    });

    it("should wire the editor to the merged servers and the write path", async () => {
      const editorSettings = makeSettingsStub({
        getLlamaServers: vi.fn(async () => [{ url: "http://seed:1" }]),
      });
      const wireEventManager = createMockEventManager(
        serverManager,
        editorSettings,
      );
      commandManager = new CommandManager(
        serverManager,
        editorSettings,
        wireEventManager,
      );
      const ctx = createMockCtx(() => null);

      await commandManager.handleCommand("servers", ctx, mockPi);

      // Invoke the factory captured from ctx.ui.custom
      const factory = vi.mocked(ctx.ui.custom).mock.calls[0][0] as (
        tui: TUI,
        theme: Theme,
        kb: KeybindingsManager,
        done: (result: undefined) => void,
      ) => ServersView;
      const done = vi.fn();
      const editor = factory(
        createMockTui(),
        createMockTheme(),
        {
          matches: vi.fn(
            (data: string, name: string) =>
              (data === ENTER && name === "tui.select.confirm") ||
              (data === ESC && name === "tui.select.cancel"),
          ),
        } as Partial<KeybindingsManager> as KeybindingsManager,
        done,
      );

      expect(editor).toBeInstanceOf(ServersView);
      // Wait for async health checks to complete
      await editor.ready;
      // Seeded with the merged snapshot
      expect(editor.render(80).join("\n")).toContain("http://seed:1");

      // Add a server through the wizard (URL → ID → name) →
      // setLlamaSettings({ servers: … }) persists only after the final step
      editor.handleInput("a");
      expect(editor.render(80).join("\n")).toContain("Add server · 1/3");
      for (const ch of "http://new:2") editor.handleInput(ch);
      editor.handleInput(ENTER);
      expect(editor.render(80).join("\n")).toContain("Add server · 2/3");
      editor.handleInput(ENTER); // skip optional ID
      expect(editor.render(80).join("\n")).toContain("Add server · 3/3");
      editor.handleInput(ENTER); // skip optional name → persist
      // Wait for async persist and rebuild (fake timers flush deterministically)
      vi.useFakeTimers();
      await vi.advanceTimersByTimeAsync(0);
      expect(editorSettings.setLlamaSettings).toHaveBeenCalledWith({
        servers: [{ url: "http://seed:1" }, { url: "http://new:2" }],
      });

      // Esc closes the editor
      editor.handleInput(ESC);
      expect(done).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it("should persist nothing when the add wizard is cancelled", async () => {
      const editorSettings = makeSettingsStub({
        getLlamaServers: vi.fn(async () => [{ url: "http://seed:1" }]),
      });
      const cancelledEventManager = createMockEventManager(
        serverManager,
        editorSettings,
      );
      commandManager = new CommandManager(
        serverManager,
        editorSettings,
        cancelledEventManager,
      );
      const ctx = createMockCtx(() => null);

      await commandManager.handleCommand("servers", ctx, mockPi);

      const factory = vi.mocked(ctx.ui.custom).mock.calls[0][0] as (
        tui: TUI,
        theme: Theme,
        kb: KeybindingsManager,
        done: (result: undefined) => void,
      ) => ServersView;
      const editor = factory(
        createMockTui(),
        createMockTheme(),
        createMockKeybindings(),
        vi.fn(),
      );

      // Walk to wizard step 2, then abort — nothing must be persisted
      editor.handleInput("a");
      for (const ch of "http://new:2") editor.handleInput(ch);
      editor.handleInput(ENTER);
      editor.handleInput(ESC);
      vi.useFakeTimers();
      await vi.advanceTimersByTimeAsync(0);

      expect(editorSettings.setLlamaSettings).not.toHaveBeenCalled();
      // Back to the list view
      expect(editor.render(80).join("\n")).toContain("http://seed:1");
      vi.useRealTimers();
    });

    it("should delete the selected server after confirming", async () => {
      const editorSettings = makeSettingsStub({
        getLlamaServers: vi.fn(async () => [
          { url: "http://seed:1" },
          { url: "http://doomed:2" },
        ]),
      });
      const doomedEventManager = createMockEventManager(
        serverManager,
        editorSettings,
      );
      commandManager = new CommandManager(
        serverManager,
        editorSettings,
        doomedEventManager,
      );
      const ctx = createMockCtx(() => null);

      await commandManager.handleCommand("servers", ctx, mockPi);

      const factory = vi.mocked(ctx.ui.custom).mock.calls[0][0] as (
        tui: TUI,
        theme: Theme,
        kb: KeybindingsManager,
        done: (result: undefined) => void,
      ) => ServersView;
      const editor = factory(
        createMockTui(),
        createMockTheme(),
        createMockKeybindings(),
        vi.fn(),
      );

      // Wait for async health checks to complete
      await editor.ready;

      // Move to the second row and open the confirm dialog
      editor.handleInput("\x1b[B");
      editor.handleInput("d");
      expect(editor.render(80).join("\n")).toContain(
        'Delete "http://doomed:2"?',
      );

      // Esc keeps the server
      editor.handleInput(ESC);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(editorSettings.setLlamaSettings).not.toHaveBeenCalled();

      // Re-open and confirm the default "Delete" selection
      editor.handleInput("d");
      editor.handleInput(ENTER);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(editorSettings.setLlamaSettings).toHaveBeenCalledWith({
        servers: [{ url: "http://seed:1" }],
      });
    });
  });

  describe("/models overrides editor", () => {
    const ESC = "\x1b";
    const ENTER = "\r";

    const createMockKeybindings = (): KeybindingsManager =>
      ({
        matches: vi.fn(
          (data: string, name: string) =>
            (data === ENTER && name === "tui.select.confirm") ||
            (data === ESC && name === "tui.select.cancel") ||
            (data === "\x1b[A" && name === "tui.select.up") ||
            (data === "\x1b[B" && name === "tui.select.down"),
        ),
      }) as Partial<KeybindingsManager> as KeybindingsManager;

    const createMockTheme = (): Theme =>
      ({
        fg: (_color: string, text: string) => text,
        bold: (text: string) => text,
      }) as Partial<Theme> as Theme;

    it("should re-register providers after the editor closes", async () => {
      const updateSpy = vi
        .spyOn(serverManager, "update")
        .mockResolvedValue(undefined);
      const ctx = createMockCtx(() => null);

      await commandManager.handleCommand("overrides", ctx, mockPi);

      expect(ctx.ui.custom).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenCalledTimes(1);
    });

    it("should notify instead of opening the editor outside the TUI", async () => {
      const ctx = createMockCommandCtx(() => null, { mode: "rpc" });

      await commandManager.handleCommand("overrides", ctx, mockPi);

      expect(ctx.ui.custom).not.toHaveBeenCalled();
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "[pi-llama-cpp]\n/models overrides requires an interactive session (TUI)",
        "warning",
      );
    });

    it("should open the overrides list seeded with server overrides", async () => {
      const editorSettings = makeSettingsStub({
        getLlamaServers: vi.fn(async () => [
          {
            url: "http://seed:1",
            overrides: { "model-a": { cost: { input: 0.1 } } },
          },
        ]),
      });
      const overridesEventManager = createMockEventManager(
        serverManager,
        editorSettings,
      );
      commandManager = new CommandManager(
        serverManager,
        editorSettings,
        overridesEventManager,
      );
      const ctx = createMockCtx(() => null);

      await commandManager.handleCommand("overrides", ctx, mockPi);

      const factory = vi.mocked(ctx.ui.custom).mock.calls[0][0] as (
        tui: TUI,
        theme: Theme,
        kb: KeybindingsManager,
        done: (result: undefined) => void,
      ) => OverridesView;
      const done = vi.fn();
      const editor = factory(
        createMockTui(),
        createMockTheme(),
        createMockKeybindings(),
        done,
      );

      expect(editor.render(80).join("\n")).toContain("1 entries");
    });
  });

  describe("/models interactive menu", () => {
    const CHOICE = "model-a   [Server: http://127.0.0.1:9931]";

    /**
     * Helper to create a CommandManager with mock servers and models.
     */
    const createCommandManager = (
      models: ReturnType<typeof createMockModel>[],
    ) => {
      const mockPi = createMockPi();
      const settingsStub = makeSettingsStub({
        resolveServerConfigs: vi.fn(async () =>
          models.map((model) => ({ baseUrl: model.serverUrl })),
        ),
      });
      // Servers are built fresh by each scan; seed the mock models into
      // them (keyed by baseUrl) via the server factory.
      const seededModels = [...models];
      const serverManager = new ServerManager(settingsStub, {
        create: async (_resolver, options) => {
          const mockServer = createMockServer({
            options: { baseUrl: options.baseUrl },
            models: seededModels.filter((m) => m.serverUrl === options.baseUrl),
          });
          return { server: mockServer, status: ServerStatus.READY };
        },
      });
      const factoryEventManager = createMockEventManager(
        serverManager,
        settingsStub,
      );
      return {
        commandManager: new CommandManager(
          serverManager,
          settingsStub,
          factoryEventManager,
        ),
        serverManager,
        settingsStub,
        seededModels,
        mockPi,
      };
    };

    it("should return early on cancel (null model selection)", async () => {
      const models = [createMockModel("model-a")];
      const { commandManager, mockPi } = createCommandManager(models);
      const ctx = createMockCtx(() => null);

      await commandManager.handleCommand("", ctx, mockPi);

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

      await commandManager.handleCommand("", ctx, mockPi);

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

      await commandManager.handleCommand("", ctx, mockPi);

      // unloadModel is fire-and-forget — the command returns
      // immediately after initiating the unload (unlike the old await
      // model.unload() which blocked until completion).
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "Unloading model-a...",
        "info",
      );
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

      await commandManager.handleCommand("", ctx, mockPi);

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

      await commandManager.handleCommand("", ctx, mockPi);

      expect(ctx.ui.select).toHaveBeenCalledTimes(3);
      expect(ctx.ui.notify).not.toHaveBeenCalled();
    });

    it("should pick up servers added via the editor on the next /models scan", async () => {
      const { commandManager, settingsStub, seededModels } =
        createCommandManager([createMockModel("model-a")]);

      const ctx = createMockCtx(() => null);
      await commandManager.handleCommand("", ctx, mockPi);

      // First scan: only model-a is offered
      let choices = vi.mocked(ctx.ui.select).mock.calls[0][1] as string[];
      expect(choices).toHaveLength(1);
      expect(choices[0]).toContain("model-a");

      // Editor persist → settings change → resolveServerConfigs now
      // returns both servers, and the seed picks up the new model
      const modelB = createMockModel("model-b", {
        serverUrl: "http://127.0.0.1:8081",
      });
      seededModels.push(modelB);
      vi.mocked(settingsStub.resolveServerConfigs).mockResolvedValue([
        { baseUrl: "http://127.0.0.1:9931" },
        { baseUrl: "http://127.0.0.1:8081" },
      ]);

      await commandManager.handleCommand("", ctx, mockPi);

      choices = vi.mocked(ctx.ui.select).mock.calls[1][1] as string[];
      expect(choices).toHaveLength(2);
      expect(choices[1]).toContain("model-b");
    });

    it("should omit server URLs when showServerUrls is false", async () => {
      const models = [createMockModel("model-a")];
      const mockPi = createMockPi();
      const settingsStub = makeSettingsStub({
        resolveServerConfigs: vi.fn(async () =>
          models.map((model) => ({ baseUrl: model.serverUrl })),
        ),
        resolveShowServerUrls: vi.fn(async () => false),
      });
      const serverManager = new ServerManager(settingsStub, {
        create: async (_resolver, options) => {
          const mockServer = createMockServer({
            options: { baseUrl: options.baseUrl },
            models: models.filter((m) => m.serverUrl === options.baseUrl),
          });
          return { server: mockServer, status: ServerStatus.READY };
        },
      });
      const urlEventManager = createMockEventManager(
        serverManager,
        settingsStub,
      );
      const commandManager = new CommandManager(
        serverManager,
        settingsStub,
        urlEventManager,
      );

      const ctx = createMockCtx((prompt, options) => {
        if (prompt.includes("models")) return options[0];
        return Action.INFO;
      });

      await commandManager.handleCommand("", ctx, mockPi);

      const choices = vi.mocked(ctx.ui.select).mock.calls[0][1] as string[];
      expect(choices).toHaveLength(1);
      expect(choices[0]).toBe("model-a  ");
      expect(choices[0]).not.toContain("[Server:");
    });

    it("should include server URLs when showServerUrls is true", async () => {
      const models = [createMockModel("model-a")];
      const mockPi = createMockPi();
      const settingsStub = makeSettingsStub({
        resolveServerConfigs: vi.fn(async () =>
          models.map((model) => ({ baseUrl: model.serverUrl })),
        ),
        resolveShowServerUrls: vi.fn(async () => true),
      });
      const serverManager = new ServerManager(settingsStub, {
        create: async (_resolver, options) => {
          const mockServer = createMockServer({
            options: { baseUrl: options.baseUrl },
            models: models.filter((m) => m.serverUrl === options.baseUrl),
          });
          return { server: mockServer, status: ServerStatus.READY };
        },
      });
      const showUrlEventManager = createMockEventManager(
        serverManager,
        settingsStub,
      );
      const commandManager = new CommandManager(
        serverManager,
        settingsStub,
        showUrlEventManager,
      );

      const ctx = createMockCtx((prompt, options) => {
        if (prompt.includes("models")) return options[0];
        return Action.INFO;
      });

      await commandManager.handleCommand("", ctx, mockPi);

      const choices = vi.mocked(ctx.ui.select).mock.calls[0][1] as string[];
      expect(choices).toHaveLength(1);
      expect(choices[0]).toContain("[Server: http://127.0.0.1:9931]");
    });
  });
});
