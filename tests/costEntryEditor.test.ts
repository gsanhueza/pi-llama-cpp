import {
  setKeybindings,
  type KeybindingsManager,
  type SettingsListTheme,
  type TUI,
} from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LlamaServer } from "../src/interfaces/settings";
import {
  addCostEntry,
  createCostsEditor,
  formatCostSummary,
  parseCostValue,
  removeCostEntry,
  updateCostEntry,
} from "../src/ui/costEntryEditor";

/** Raw key sequences used to drive the editor */
const UP = "\x1b[A";
const DOWN = "\x1b[B";
const RIGHT = "\x1b[C";
const ENTER = "\r"; // SettingsList confirm
const LF = "\n"; // Input submit
const ESC = "\x1b";
const BACKSPACE = "\x7f";

/** Key map shared by the global bindings and the injected manager */
let map: Record<string, string>;

beforeEach(() => {
  // SettingsList and Input resolve keybindings globally inside pi-tui
  map = {
    [UP]: "tui.select.up",
    [DOWN]: "tui.select.down",
    [RIGHT]: "tui.editor.cursorRight",
    [ENTER]: "tui.select.confirm",
    [ESC]: "tui.select.cancel",
    [BACKSPACE]: "tui.editor.deleteCharBackward",
  };
  setKeybindings({
    matches: (data: string, name: string) => map[data] === name,
  } as unknown as KeybindingsManager);
});

const SERVERS: LlamaServer[] = [
  {
    url: "http://a:1",
    costs: {
      "llama-3-8b": { input: 0.2, output: 0.6, cacheRead: 0.01 },
      "llama-3-70b": { input: 0.1, output: 0.3, cacheRead: 0.01 },
    },
  },
  { url: "http://b:2" },
];

/** Plain theme for the SettingsList (no ANSI styling in assertions) */
const THEME: SettingsListTheme = {
  label: (text: string) => text,
  value: (text: string) => text,
  description: (text: string) => text,
  cursor: "→",
  hint: (text: string) => text,
};

const setup = (servers: LlamaServer[] = SERVERS) => {
  const persist = vi.fn(async (_next: LlamaServer[]) => {});
  const done = vi.fn();
  const onError = vi.fn();
  const onChanged = vi.fn();
  const keybindings: KeybindingsManager = {
    matches: (data: string, name: string) => map[data] === name,
  } as unknown as KeybindingsManager;
  const editor = createCostsEditor({
    tui: { requestRender: vi.fn() } as unknown as TUI,
    keybindings,
    theme: THEME,
    alert: (text) => text, // plain theme: no ANSI in assertions
    servers,
    persist,
    done,
    onError,
    onChanged,
  });
  return { editor, persist, done, onError, onChanged };
};

/** Flushes the microtask queue so awaited persist calls settle */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Stand-in terminal width in columns passed to render(), mirroring what
 * pi-tui supplies at runtime; wide enough that no line gets truncated.
 */
const RENDER_WIDTH = 100;

const render = (editor: ReturnType<typeof createCostsEditor>) =>
  editor.render(RENDER_WIDTH).join("\n");

const type = (editor: ReturnType<typeof createCostsEditor>, text: string) => {
  for (const ch of text) editor.handleInput(ch);
};

describe("cost entry helpers", () => {
  describe("parseCostValue", () => {
    it("should parse non-negative numbers", () => {
      expect(parseCostValue("0.42")).toBe(0.42);
      expect(parseCostValue(" 3 ")).toBe(3);
      expect(parseCostValue("0")).toBe(0);
    });

    it("should treat empty/whitespace input as zero", () => {
      expect(parseCostValue("")).toBe(0);
      expect(parseCostValue("   ")).toBe(0);
    });

    it("should reject non-numeric, non-finite and negative input", () => {
      expect(parseCostValue("abc")).toBeNull();
      expect(parseCostValue("1,5")).toBeNull();
      expect(parseCostValue("Infinity")).toBeNull();
      expect(parseCostValue("NaN")).toBeNull();
      expect(parseCostValue("-0.1")).toBeNull();
    });
  });

  describe("addCostEntry", () => {
    it("should append a cost entry to the selected server without mutating the input", () => {
      const servers: LlamaServer[] = [
        { url: "http://a:1" },
        { url: "http://b:2", costs: { llama: { input: 1 } } },
      ];
      const next = addCostEntry(servers, 1, "llama-3", { input: 2 });

      expect(next).toEqual([
        { url: "http://a:1" },
        {
          url: "http://b:2",
          costs: { llama: { input: 1 }, "llama-3": { input: 2 } },
        },
      ]);
      expect(servers[1].costs).toEqual({ llama: { input: 1 } });
    });

    it("should default the cost to an empty (all-zero) object", () => {
      const servers: LlamaServer[] = [{ url: "http://a:1" }];
      expect(addCostEntry(servers, 0, "llama")).toEqual([
        { url: "http://a:1", costs: { llama: {} } },
      ]);
    });
  });

  describe("updateCostEntry", () => {
    it("should replace the pattern and cost in one mutation, keeping the position", () => {
      const servers: LlamaServer[] = [
        {
          url: "http://a:1",
          costs: {
            llama: { input: 1 },
            "llama-3": { input: 2, output: 4 },
          },
        },
      ];
      const next = updateCostEntry(servers, 0, 0, "llama-3-8b", { output: 9 });

      expect(Object.keys(next[0].costs ?? {})).toEqual([
        "llama-3-8b",
        "llama-3",
      ]);
      expect(next[0].costs?.["llama-3-8b"]).toEqual({ output: 9 });
      expect(next[0].costs?.["llama-3"]).toEqual({ input: 2, output: 4 });
      expect(servers[0].costs?.llama).toEqual({ input: 1 });
    });

    it("should leave other servers untouched", () => {
      const servers: LlamaServer[] = [
        { url: "http://a:1", costs: { llama: { input: 1 } } },
        { url: "http://b:2", costs: { other: { input: 5 } } },
      ];
      const next = updateCostEntry(servers, 0, 0, "llama", { input: 2 });

      expect(next[1]).toEqual(servers[1]);
      expect(next[0].costs?.llama).toEqual({ input: 2 });
    });
  });

  describe("removeCostEntry", () => {
    it("should remove the entry at the index, immutably", () => {
      const servers: LlamaServer[] = [
        {
          url: "http://a:1",
          costs: { llama: { input: 1 }, "llama-3": { input: 2 } },
        },
      ];
      const next = removeCostEntry(servers, 0, 0);

      expect(next[0].costs).toEqual({ "llama-3": { input: 2 } });
      expect(servers[0].costs).toEqual({
        llama: { input: 1 },
        "llama-3": { input: 2 },
      });
    });

    it("should allow removing the last entry", () => {
      const servers: LlamaServer[] = [
        { url: "http://a:1", costs: { llama: { input: 1 } } },
      ];
      expect(removeCostEntry(servers, 0, 0)).toEqual([
        { url: "http://a:1", costs: {} },
      ]);
    });
  });

  describe("formatCostSummary", () => {
    it("should show only the non-zero fields", () => {
      expect(
        formatCostSummary({ input: 0.2, output: 0.6, cacheRead: 0.01 }),
      ).toBe("in:0.2 out:0.6 cacheR:0.01");
    });

    it("should fall back to a dash when everything is zero", () => {
      expect(formatCostSummary({ output: 0 })).toBe("—");
    });
  });
});

describe("createCostsEditor", () => {
  describe("server list", () => {
    it("should render one row per server with an entry count", () => {
      const { editor } = setup();

      const out = render(editor);
      expect(out).toContain("http://a:1");
      expect(out).toContain("2 entries");
      expect(out).toContain("http://b:2");
      expect(out).toContain("0 entries");
    });

    it("should close on Escape", () => {
      const { editor, done } = setup();

      editor.handleInput(ESC);

      expect(done).toHaveBeenCalledTimes(1);
    });

    it("should open the entry list of the selected server on Enter", () => {
      const { editor } = setup();

      editor.handleInput(ENTER);

      const out = render(editor);
      expect(out).toContain("llama-3-8b");
      expect(out).toContain("in:0.2 out:0.6 cacheR:0.01");
      expect(out).not.toContain("http://a:1");
    });
  });

  describe("entry list", () => {
    it("should show an add hint for a server without costs", () => {
      const { editor } = setup();

      editor.handleInput(DOWN); // http://b:2 (0 entries)
      editor.handleInput(ENTER);

      const out = render(editor);
      expect(out).toContain("No cost entries");
      expect(out).toContain("press a to add one");
      expect(out).not.toContain("No settings available");
    });

    it("should not close the editor on Escape in a submenu", () => {
      const { editor, done } = setup();

      editor.handleInput(ENTER); // entry list
      editor.handleInput(ESC); // back to server list

      expect(done).not.toHaveBeenCalled();
      expect(render(editor)).toContain("http://a:1");
    });

    it("should add an entry with a unique default pattern on a", async () => {
      const { editor, persist } = setup();

      editor.handleInput(ENTER); // entry list of http://a:1
      editor.handleInput("a");
      await flush();

      const costs = persist.mock.calls[0][0][0].costs ?? {};
      expect(costs["new-pattern"]).toEqual({});
      expect(render(editor)).toContain("new-pattern");
    });

    it("should uniquify repeated default patterns", async () => {
      const { editor, persist } = setup();

      editor.handleInput(ENTER);
      editor.handleInput("a");
      await flush();
      editor.handleInput("a");
      await flush();

      const costs = persist.mock.calls[1][0][0].costs ?? {};
      expect(costs["new-pattern-2"]).toEqual({});
    });

    it("should ask for confirmation on d, without deleting", async () => {
      const { editor, persist } = setup();

      editor.handleInput(ENTER); // entry list, cursor on llama-3-8b
      editor.handleInput("d");
      await flush();

      expect(persist).not.toHaveBeenCalled();
      const lines = editor.render(RENDER_WIDTH);
      const about = lines.findIndex((line) =>
        line.includes('About to delete "llama-3-8b"'),
      );
      // "Are you sure? …" on its own line, directly below "About to delete …"
      expect(about).toBeGreaterThanOrEqual(0);
      expect(lines[about + 1]).toContain("Are you sure?");
      expect(lines[about + 1]).toContain("y delete · Esc/n cancel");
      // The row itself keeps its cost summary
      expect(
        lines.some((line) => line.includes("in:0.2 out:0.6 cacheR:0.01")),
      ).toBe(true);
    });

    it("should delete the entry on y", async () => {
      const { editor, persist } = setup();

      editor.handleInput(ENTER); // entry list, cursor on llama-3-8b
      editor.handleInput("d"); // confirm mode
      editor.handleInput("y"); // confirm
      await flush();

      const costs = persist.mock.calls[0][0][0].costs ?? {};
      expect(Object.keys(costs)).toEqual(["llama-3-70b"]);
      expect(render(editor)).not.toContain("llama-3-8b");
    });

    it("should ignore Enter so it cannot accidentally confirm", async () => {
      const { editor, persist } = setup();

      editor.handleInput(ENTER); // entry list, cursor on llama-3-8b
      editor.handleInput("d");
      editor.handleInput(ENTER); // must not confirm
      await flush();

      expect(persist).not.toHaveBeenCalled();
      expect(render(editor)).toContain("Are you sure?");
    });

    it("should cancel on Esc without deleting or closing", async () => {
      const { editor, persist, done } = setup();

      editor.handleInput(ENTER); // entry list
      editor.handleInput("d");
      editor.handleInput(ESC); // cancel confirmation
      await flush();

      expect(persist).not.toHaveBeenCalled();
      expect(done).not.toHaveBeenCalled();
      expect(render(editor)).toContain("llama-3-8b");
      expect(render(editor)).not.toContain("Are you sure?");
    });

    it("should cancel on n without deleting", async () => {
      const { editor, persist } = setup();

      editor.handleInput(ENTER); // entry list
      editor.handleInput("d");
      editor.handleInput("n");
      await flush();

      expect(persist).not.toHaveBeenCalled();
      expect(render(editor)).not.toContain("Are you sure?");
    });

    it("should ignore other keys while confirming", async () => {
      const { editor, persist } = setup();

      editor.handleInput(ENTER); // entry list, cursor on llama-3-8b
      editor.handleInput("d");
      editor.handleInput(DOWN); // navigation is ignored
      editor.handleInput("d"); // d is ignored too
      editor.handleInput("x");
      await flush();

      expect(persist).not.toHaveBeenCalled();
      const out = render(editor);
      expect(out).toContain("Are you sure?");
      expect(out).toContain("llama-3-70b"); // cursor never moved
    });

    it("should ignore a/d while an input submenu is open", async () => {
      const { editor, persist } = setup();

      editor.handleInput(ENTER); // entry list
      editor.handleInput(ENTER); // field list of llama-3-8b
      editor.handleInput(ENTER); // pattern Input (open submenu)
      type(editor, "a"); // typing, not adding
      type(editor, "d");

      expect(persist).not.toHaveBeenCalled();
    });
  });

  describe("entry field editing", () => {
    const openPatternInput = (editor: ReturnType<typeof createCostsEditor>) => {
      editor.handleInput(ENTER); // entry list
      editor.handleInput(ENTER); // field list, cursor on pattern
      editor.handleInput(ENTER); // pattern Input
    };

    const openCostInput = (
      editor: ReturnType<typeof createCostsEditor>,
      field: 1 | 2 | 3 | 4,
    ) => {
      editor.handleInput(ENTER); // entry list
      editor.handleInput(ENTER); // field list, cursor on pattern
      for (let i = 0; i < field; i++) editor.handleInput(DOWN);
      editor.handleInput(ENTER); // cost Input
    };

    it("should edit a cost field via the inline Input", async () => {
      const { editor, persist } = setup();

      openCostInput(editor, 1); // input
      // Clear the prefilled "0.2" and type the new value
      for (let i = 0; i < 3; i++) editor.handleInput(BACKSPACE);
      type(editor, "0.25");
      editor.handleInput(LF); // submit
      await flush();

      const costs = persist.mock.calls[0][0][0].costs ?? {};
      expect(costs["llama-3-8b"]).toEqual({
        input: 0.25,
        output: 0.6,
        cacheRead: 0.01,
      });
    });

    it("should treat an empty cost field as zero", async () => {
      const { editor, persist } = setup();

      openCostInput(editor, 2); // output
      for (let i = 0; i < 3; i++) editor.handleInput(BACKSPACE);
      editor.handleInput(LF); // empty -> 0
      await flush();

      const costs = persist.mock.calls[0][0][0].costs ?? {};
      expect(costs["llama-3-8b"]).toEqual({
        input: 0.2,
        output: 0,
        cacheRead: 0.01,
      });
    });

    it("should reject invalid cost values, notify and keep the input open", async () => {
      const { editor, persist, onError } = setup();

      openCostInput(editor, 1);
      for (let i = 0; i < 3; i++) editor.handleInput(BACKSPACE);
      type(editor, "abc");
      editor.handleInput(LF);
      await flush();

      expect(persist).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith('Invalid input "abc"');
      // The Input is still open (submenu still rendered)
      expect(render(editor)).toContain("> abc");
    });

    it("should rename the pattern via the pattern row", async () => {
      const { editor, persist } = setup();

      openPatternInput(editor);
      for (let i = 0; i < "llama-3-8b".length; i++) {
        editor.handleInput(BACKSPACE);
      }
      type(editor, "qwen-27b");
      editor.handleInput(LF);
      await flush();

      const server = persist.mock.calls[0][0][0];
      expect(Object.keys(server.costs ?? {})).toEqual([
        "qwen-27b",
        "llama-3-70b",
      ]);
      expect(server.costs?.["qwen-27b"]).toEqual({
        input: 0.2,
        output: 0.6,
        cacheRead: 0.01,
      });
    });

    it("should reject an empty pattern, notify and keep the input open", async () => {
      const { editor, persist, onError } = setup();

      openPatternInput(editor);
      for (let i = 0; i < "llama-3-8b".length; i++) {
        editor.handleInput(BACKSPACE);
      }
      editor.handleInput(LF);
      await flush();

      expect(persist).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith('Invalid pattern ""');
    });

    it("should close the Input without persisting on Escape", async () => {
      const { editor, persist } = setup();

      openCostInput(editor, 1);
      for (let i = 0; i < 3; i++) editor.handleInput(BACKSPACE);
      type(editor, "9");
      editor.handleInput(ESC); // close the Input
      await flush();

      expect(persist).not.toHaveBeenCalled();
      // Back on the field list, value unchanged
      expect(render(editor)).toContain("0.2");
    });

    it("should apply consecutive field edits without clobbering", async () => {
      const { editor, persist } = setup();

      openCostInput(editor, 1); // input
      for (let i = 0; i < 3; i++) editor.handleInput(BACKSPACE);
      type(editor, "1");
      editor.handleInput(LF);
      await flush();
      editor.handleInput(ESC); // back to entry list
      editor.handleInput(ENTER); // field list again
      editor.handleInput(DOWN); // input
      editor.handleInput(ENTER); // Input, prefilled "1"
      for (let i = 0; i < 1; i++) editor.handleInput(BACKSPACE);
      type(editor, "2");
      editor.handleInput(LF);
      await flush();

      const costs = persist.mock.calls[1][0][0].costs ?? {};
      expect(costs["llama-3-8b"]).toEqual({
        input: 2,
        output: 0.6,
        cacheRead: 0.01,
      });
    });

    it("should refresh the parent entry row after an edit", async () => {
      const { editor } = setup();

      openCostInput(editor, 1);
      for (let i = 0; i < 3; i++) editor.handleInput(BACKSPACE);
      type(editor, "9");
      editor.handleInput(LF);
      await flush();
      editor.handleInput(ESC); // back to entry list
      editor.handleInput(ESC); // back to server list

      const out = render(editor);
      expect(out).toContain("2 entries");
    });
  });

  describe("persistence integration", () => {
    it("should not mutate the caller's snapshot", async () => {
      const servers: LlamaServer[] = [
        { url: "http://a:1", costs: { llama: { input: 1 } } },
      ];
      const { editor, persist } = setup(servers);

      editor.handleInput(ENTER); // entry list
      editor.handleInput("d"); // confirm the only entry
      editor.handleInput("y"); // confirm
      await flush();

      expect(persist).toHaveBeenCalledWith([{ url: "http://a:1", costs: {} }]);
      expect(servers[0].costs?.llama).toEqual({ input: 1 });
    });

    it("should notify and keep the rows when the write fails", async () => {
      const { editor, persist, onError } = setup();
      persist.mockRejectedValueOnce(new Error("disk boom"));

      editor.handleInput(ENTER); // entry list
      editor.handleInput("d"); // confirm mode
      editor.handleInput("y"); // confirm
      await flush();

      expect(onError).toHaveBeenCalledWith("disk boom");
      // Pre-mutation rows unchanged
      expect(render(editor)).toContain("llama-3-8b");
    });

    it("should fire onChanged after every successful add/edit/delete", async () => {
      const { editor, persist, onChanged } = setup();

      editor.handleInput(ENTER); // entry list
      editor.handleInput("a"); // add
      await flush();
      expect(onChanged).toHaveBeenCalledTimes(1);

      editor.handleInput(ENTER); // field list of new-pattern
      editor.handleInput(ENTER); // pattern Input
      type(editor, "x"); // rename to new-patternx
      editor.handleInput(LF); // submit
      await flush();
      expect(onChanged).toHaveBeenCalledTimes(2);

      editor.handleInput(ESC); // back to entry list
      editor.handleInput("d"); // confirm mode
      editor.handleInput("y"); // confirm
      await flush();
      expect(onChanged).toHaveBeenCalledTimes(3);
      expect(persist).toHaveBeenCalledTimes(3);
    });

    it("should not fire onChanged when the write fails", async () => {
      const { editor, persist, onError, onChanged } = setup();
      persist.mockRejectedValueOnce(new Error("disk boom"));

      editor.handleInput(ENTER); // entry list
      editor.handleInput("d"); // confirm mode
      editor.handleInput("y"); // confirm
      await flush();

      expect(onError).toHaveBeenCalledWith("disk boom");
      expect(onChanged).not.toHaveBeenCalled();
    });

    it("should never embed newlines in rendered lines", () => {
      // pi-tui's diff renderer assumes one rendered line == one terminal
      // row; a raw \n inside a line leaves stale residue after the prompt
      // shrinks.
      const { editor } = setup();

      editor.handleInput(ENTER); // entry list
      for (const line of editor.render(RENDER_WIDTH)) {
        expect(line).not.toContain("\n");
      }

      editor.handleInput("d"); // confirm mode: description embeds a \n
      for (const line of editor.render(RENDER_WIDTH)) {
        expect(line).not.toContain("\n");
      }

      editor.handleInput(ESC); // cancel
      editor.handleInput(ENTER); // field list
      for (const line of editor.render(RENDER_WIDTH)) {
        expect(line).not.toContain("\n");
      }
    });
  });
});
