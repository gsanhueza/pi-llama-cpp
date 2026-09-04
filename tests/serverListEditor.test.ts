import type { Theme } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LlamaServer } from "../src/interfaces/settings";
import {
  ServerListEditor,
  addServer,
  normalizeServerUrl,
  removeServer,
  updateServerUrl,
} from "../src/ui/serverListEditor";

/** Raw key sequences used to drive the editor */
const UP = "\x1b[A";
const DOWN = "\x1b[B";
const ENTER = "\r";
const ESC = "\x1b";

const createMockKeybindings = (): KeybindingsManager => {
  const map: Record<string, string> = {
    [UP]: "tui.select.up",
    [DOWN]: "tui.select.down",
    [ENTER]: "tui.select.confirm",
    [ESC]: "tui.select.cancel",
  };
  return {
    matches: vi.fn((data: string, name: string) => map[data] === name),
  } as unknown as KeybindingsManager;
};

const createMockTui = (): TUI => ({ requestRender: vi.fn() }) as unknown as TUI;

const createMockTheme = (): Theme =>
  ({
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  }) as unknown as Theme;

const setup = (servers: LlamaServer[] = []) => {
  const persist = vi.fn(async (_next: LlamaServer[]) => {});
  const done = vi.fn();
  const onError = vi.fn();
  const editor = new ServerListEditor({
    tui: createMockTui(),
    theme: createMockTheme(),
    keybindings: createMockKeybindings(),
    servers,
    persist,
    done,
    onError,
  });
  return { editor, persist, done, onError };
};

/** Flushes the microtask queue so awaited persist calls settle */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const render = (editor: ServerListEditor) => editor.render(80).join("\n");

const type = (editor: ServerListEditor, text: string) => {
  for (const ch of text) editor.handleInput(ch);
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("server URL helpers", () => {
  describe("normalizeServerUrl", () => {
    it("should trim whitespace and strip trailing slashes", () => {
      expect(normalizeServerUrl("  http://a:8080/  ")).toBe("http://a:8080");
      expect(normalizeServerUrl("https://x.y///")).toBe("https://x.y");
    });

    it("should reject empty input", () => {
      expect(normalizeServerUrl("")).toBeNull();
      expect(normalizeServerUrl("   ")).toBeNull();
    });

    it("should reject semicolons (one URL per entry)", () => {
      expect(normalizeServerUrl("http://a:1;http://b:2")).toBeNull();
    });

    it("should reject values without an http(s) scheme", () => {
      expect(normalizeServerUrl("foo")).toBeNull();
      expect(normalizeServerUrl("127.0.0.1:8080")).toBeNull();
      expect(normalizeServerUrl("ftp://a:1")).toBeNull();
    });
  });

  describe("addServer", () => {
    it("should append a url-only entry without mutating the input", () => {
      const servers: LlamaServer[] = [{ url: "http://a:1", name: "A" }];
      const next = addServer(servers, "http://b:2");

      expect(next).toEqual([
        { url: "http://a:1", name: "A" },
        { url: "http://b:2" },
      ]);
      expect(servers).toEqual([{ url: "http://a:1", name: "A" }]);
    });
  });

  describe("updateServerUrl", () => {
    it("should replace the url and preserve id/name overrides", () => {
      const servers: LlamaServer[] = [
        { url: "http://a:1", id: "custom", name: "A" },
        { url: "http://b:2" },
      ];
      const next = updateServerUrl(servers, 0, "http://a:9");

      expect(next).toEqual([
        { url: "http://a:9", id: "custom", name: "A" },
        { url: "http://b:2" },
      ]);
      expect(servers[0].url).toBe("http://a:1");
    });
  });

  describe("removeServer", () => {
    it("should remove the entry at the index", () => {
      const servers: LlamaServer[] = [
        { url: "http://a:1" },
        { url: "http://b:2" },
      ];
      expect(removeServer(servers, 0)).toEqual([{ url: "http://b:2" }]);
      expect(servers).toHaveLength(2);
    });

    it("should allow removing the last entry", () => {
      expect(removeServer([{ url: "http://a:1" }], 0)).toEqual([]);
    });
  });
});

describe("ServerListEditor", () => {
  describe("rendering", () => {
    it("should render the title, the rows and the selection cursor", () => {
      const { editor } = setup([
        { url: "http://a:1" },
        { url: "http://b:2", name: "Bee" },
      ]);

      const out = render(editor);
      expect(out).toContain("Manage llama.cpp servers");
      expect(out).toContain("→ http://a:1");
      expect(out).toContain("http://b:2  Bee");
      expect(out).toContain("Enter/e edit · a add · d delete · Esc done");
    });

    it("should render an empty-state hint when there are no servers", () => {
      const { editor } = setup([]);

      const out = render(editor);
      expect(out).toContain("No servers configured");
      expect(out).toContain("http://127.0.0.1:8080");
    });

    it("should render the edit mode with a URL field", () => {
      const { editor } = setup([{ url: "http://a:1" }]);
      editor.handleInput(ENTER);

      const out = render(editor);
      expect(out).toContain("URL:");
      expect(out).toContain("> http://a:1");
      expect(out).toContain("Enter save · Esc cancel");
    });
  });

  describe("list mode", () => {
    it("should move the selection with up/down, wrapping around", () => {
      const { editor } = setup([{ url: "http://a:1" }, { url: "http://b:2" }]);

      editor.handleInput(DOWN);
      expect(render(editor)).toContain("→ http://b:2");

      editor.handleInput(DOWN);
      expect(render(editor)).toContain("→ http://a:1");

      editor.handleInput(UP);
      expect(render(editor)).toContain("→ http://b:2");
    });

    it("should close on Escape", () => {
      const { editor, done } = setup([{ url: "http://a:1" }]);

      editor.handleInput(ESC);

      expect(done).toHaveBeenCalledTimes(1);
    });

    it("should ignore edit/delete on an empty list", () => {
      const { editor, persist } = setup([]);

      editor.handleInput(ENTER);
      editor.handleInput("d");

      expect(render(editor)).not.toContain("URL:");
      expect(persist).not.toHaveBeenCalled();
    });
  });

  describe("editing", () => {
    it("should prefill the input and append at the cursor (cursor at end)", async () => {
      const { editor, persist, done } = setup([{ url: "http://a:1" }]);

      editor.handleInput(ENTER);
      editor.handleInput("X");
      editor.handleInput(ENTER);
      await flush();

      expect(persist).toHaveBeenCalledWith([{ url: "http://a:1X" }]);
      expect(done).not.toHaveBeenCalled();
      // Back in list mode
      expect(render(editor)).not.toContain("URL:");
    });

    it("should preserve id/name overrides when saving", async () => {
      const { editor, persist } = setup([
        { url: "http://a:1", id: "custom", name: "A" },
      ]);

      editor.handleInput(ENTER);
      editor.handleInput("X");
      editor.handleInput(ENTER);
      await flush();

      expect(persist).toHaveBeenCalledWith([
        { url: "http://a:1X", id: "custom", name: "A" },
      ]);
    });

    it("should revert without writing on Escape", async () => {
      const { editor, persist } = setup([{ url: "http://a:1" }]);

      editor.handleInput(ENTER);
      editor.handleInput("X");
      editor.handleInput(ESC);
      await flush();

      expect(persist).not.toHaveBeenCalled();
      expect(render(editor)).not.toContain("URL:");
      expect(render(editor)).not.toContain("http://a:1X");
    });

    it("should reject invalid URLs with an inline error and keep editing", async () => {
      const { editor, persist, onError } = setup([{ url: "http://a:1" }]);

      editor.handleInput("a");
      type(editor, "foo");
      editor.handleInput(ENTER);
      await flush();

      expect(persist).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
      expect(render(editor)).toContain("Invalid URL");
      expect(render(editor)).toContain("URL:");
    });

    it("should reject semicolon-separated URLs", async () => {
      const { editor, persist } = setup([]);

      editor.handleInput("a");
      type(editor, "http://a:1;http://b:2");
      editor.handleInput(ENTER);
      await flush();

      expect(persist).not.toHaveBeenCalled();
      expect(render(editor)).toContain("Invalid URL");
    });

    it("should normalize the URL on save", async () => {
      const { editor, persist } = setup([{ url: "http://a:1" }]);

      editor.handleInput("a");
      type(editor, "  http://new:2/  ");
      editor.handleInput(ENTER);
      await flush();

      expect(persist).toHaveBeenCalledWith([
        { url: "http://a:1" },
        { url: "http://new:2" },
      ]);
    });

    it("should move the selection to the added entry", async () => {
      const { editor } = setup([{ url: "http://a:1" }]);

      editor.handleInput("a");
      type(editor, "http://new:2");
      editor.handleInput(ENTER);
      await flush();

      expect(render(editor)).toContain("→ http://new:2");
    });

    it("should notify and stay in edit mode when the write fails", async () => {
      const { editor, persist, onError } = setup([{ url: "http://a:1" }]);
      persist.mockRejectedValueOnce(new Error("disk boom"));

      editor.handleInput("a");
      type(editor, "http://new:2");
      editor.handleInput(ENTER);
      await flush();

      expect(onError).toHaveBeenCalledWith("disk boom");
      // Pre-mutation list unchanged (no new row), still editing
      expect(render(editor)).toContain("→ http://a:1");
      expect(render(editor)).toContain("URL:");
    });
  });

  describe("deleting", () => {
    it("should persist the list without the selected entry", async () => {
      const { editor, persist } = setup([
        { url: "http://a:1" },
        { url: "http://b:2" },
      ]);

      editor.handleInput("d");
      await flush();

      expect(persist).toHaveBeenCalledWith([{ url: "http://b:2" }]);
    });

    it("should clamp the selection when the last entry is removed", async () => {
      const { editor } = setup([{ url: "http://a:1" }, { url: "http://b:2" }]);

      editor.handleInput(DOWN);
      editor.handleInput("d");
      await flush();

      expect(render(editor)).toContain("→ http://a:1");
    });

    it("should allow emptying the list", async () => {
      const { editor, persist } = setup([{ url: "http://a:1" }]);

      editor.handleInput("d");
      await flush();

      expect(persist).toHaveBeenCalledWith([]);
      expect(render(editor)).toContain("No servers configured");
    });

    it("should notify and keep the list when the write fails", async () => {
      const { editor, persist, onError } = setup([{ url: "http://a:1" }]);
      persist.mockRejectedValueOnce(new Error("disk boom"));

      editor.handleInput("d");
      await flush();

      expect(onError).toHaveBeenCalledWith("disk boom");
      expect(render(editor)).toContain("http://a:1");
    });
  });

  describe("env override hint", () => {
    it("should hint when LLAMA_SERVER_URL overrides the settings", () => {
      vi.stubEnv("LLAMA_SERVER_URL", "http://env:1");
      const { editor } = setup([{ url: "http://a:1" }]);

      expect(render(editor)).toContain(
        "LLAMA_SERVER_URL env var overrides these servers",
      );
    });

    it("should not hint when LLAMA_SERVER_URL is unset", () => {
      const { editor } = setup([{ url: "http://a:1" }]);

      expect(render(editor)).not.toContain("LLAMA_SERVER_URL");
    });
  });
});
