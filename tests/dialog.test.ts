import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import {
  getKeybindings,
  type KeybindingsManager,
  type TUI,
} from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "../src/ui/dialog/confirm";
import { InputDialog } from "../src/ui/dialog/input";
import { OverrideSettingsList } from "../src/ui/editors/override/overrideList";
import { ServerSettingsList } from "../src/ui/editors/server/serverEditor";

beforeEach(() => {
  initTheme();
  vi.clearAllMocks();
});

const ESC = "\x1b";
const ENTER = "\r";

const createMockTheme = (): Theme =>
  ({
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  }) as unknown as Theme;

const createMockTui = (): TUI => ({ requestRender: vi.fn() }) as unknown as TUI;

const createKeybindings = (): KeybindingsManager => getKeybindings();

describe("InputDialog", () => {
  const build = (
    overrides: Partial<ConstructorParameters<typeof InputDialog>[0]> = {},
  ) => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const dialog = new InputDialog({
      theme: createMockTheme(),
      tui: createMockTui(),
      title: "Dialog title",
      message: "Server URL",
      placeholder: "http://127.0.0.1:8080",
      validate: (raw) => (raw.startsWith("http") ? raw : null),
      onSubmit,
      onCancel,
      ...overrides,
    });
    return { dialog, onSubmit, onCancel };
  };

  it("renders the framed title, message, placeholder and key hints", () => {
    const { dialog } = build();
    const rendered = dialog.render(60).join("\n");
    expect(rendered).toContain("Dialog title");
    expect(rendered).toContain("Server URL");
    expect(rendered).toContain("e.g., http://127.0.0.1:8080");
  });

  it("submits the validated value on Enter", () => {
    const { dialog, onSubmit, onCancel } = build({
      initialValue: "http://x:1",
    });
    dialog.handleInput(ENTER);
    expect(onSubmit).toHaveBeenCalledWith("http://x:1");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("keeps the dialog open with an error on invalid input", () => {
    const { dialog, onSubmit, onCancel } = build();
    for (const ch of "no-scheme") dialog.handleInput(ch);
    dialog.handleInput(ENTER);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(dialog.render(60).join("\n")).toContain('Invalid value "no-scheme"');

    // Esc still cancels after an error
    dialog.handleInput(ESC);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("cancels on Esc without submitting", () => {
    const { dialog, onSubmit, onCancel } = build({
      initialValue: "http://x:1",
    });
    dialog.handleInput(ESC);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("ConfirmDialog", () => {
  const build = () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const dialog = new ConfirmDialog({
      theme: createMockTheme(),
      tui: createMockTui(),
      title: "Delete server",
      message: 'Delete "http://x:1"?',
      onConfirm,
      onCancel,
    });
    return { dialog, onConfirm, onCancel };
  };

  it("renders the framed message and both options", () => {
    const { dialog } = build();
    const rendered = dialog.render(60).join("\n");
    expect(rendered).toContain("Delete server");
    expect(rendered).toContain('Delete "http://x:1"?');
    expect(rendered).toContain("Delete");
    expect(rendered).toContain("Cancel");
  });

  it("confirms with Enter on the default selection", () => {
    const { dialog, onConfirm, onCancel } = build();
    dialog.handleInput(ENTER);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels on Esc", () => {
    const { dialog, onConfirm, onCancel } = build();
    dialog.handleInput(ESC);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("ServerSettingsList add wizard", () => {
  const buildEditor = (servers: { url: string; id?: string }[] = []) => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const done = vi.fn();
    const onError = vi.fn();
    const editor = new ServerSettingsList({
      tui: createMockTui(),
      theme: createMockTheme(),
      keybindings: createKeybindings(),
      servers: servers as never[],
      persist,
      done,
      onError,
      authResolver: () => Promise.resolve("sk-placeholder"),
    });
    return { editor, persist, done, onError };
  };

  it("persists only the URL when the optional steps are skipped", async () => {
    const { editor, persist } = buildEditor();

    editor.handleInput("a");
    for (const ch of "http://x:1") editor.handleInput(ch);
    editor.handleInput(ENTER); // URL → ID
    editor.handleInput(ENTER); // skip ID → name
    editor.handleInput(ENTER); // skip name → persist
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(persist).toHaveBeenCalledWith([{ url: "http://x:1" }]);
  });

  it("persists the URL and ID when the ID step is filled", async () => {
    const { editor, persist } = buildEditor();

    editor.handleInput("a");
    for (const ch of "http://x:1") editor.handleInput(ch);
    editor.handleInput(ENTER);
    for (const ch of "my-id") editor.handleInput(ch);
    editor.handleInput(ENTER); // ID → name
    editor.handleInput(ENTER); // skip name → persist
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(persist).toHaveBeenCalledWith([{ url: "http://x:1", id: "my-id" }]);
  });

  it("rejects an invalid URL at step 1 and aborts cleanly on Esc", async () => {
    const { editor, persist } = buildEditor();

    editor.handleInput("a");
    for (const ch of "not-a-url") editor.handleInput(ch);
    editor.handleInput(ENTER);
    expect(persist).not.toHaveBeenCalled();
    expect(editor.render(80).join("\n")).toContain('Invalid value "not-a-url"');

    editor.handleInput(ESC);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(persist).not.toHaveBeenCalled();
    // Back at the (empty) list view
    expect(editor.render(80).join("\n")).toContain("(a) add server");
  });
});

describe("OverrideEntryListEditor cost re-prefill", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("re-entering a cost field prefills the just-saved value", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const list = new OverrideSettingsList({
      tui: createMockTui(),
      theme: createMockTheme(),
      keybindings: createKeybindings(),
      servers: [
        {
          url: "http://x:1",
          overrides: { "gpt-*": { cost: { input: 0.2 } } },
        },
      ] as never[],
      persist,
      done: vi.fn(),
      onError: vi.fn(),
      onChanged: vi.fn(),
    });

    const DOWN = "\x1b[B"; // tui.select.down
    const CLEAR = "\x15"; // tui.editor.deleteToLineStart

    list.handleInput(ENTER); // drill into the server row
    list.handleInput(ENTER); // open the field submenu (cursor: pattern)
    list.handleInput(DOWN); // cursor: cost.input
    list.handleInput(ENTER); // open the input dialog (prefilled "0.2")
    list.handleInput(CLEAR);
    for (const ch of "0.5") list.handleInput(ch);
    list.handleInput(ENTER); // commit
    await flush();

    // Re-enter the field: the prefill must be the saved value
    list.handleInput(ENTER);
    const rendered = list.render(80).join("\n");
    expect(rendered).toContain("0.5");
    expect(rendered).not.toContain("0.2");
  });
});

describe("OverrideSettingsList escape navigation", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  const build = () => {
    const done = vi.fn();
    const list = new OverrideSettingsList({
      tui: createMockTui(),
      theme: createMockTheme(),
      keybindings: createKeybindings(),
      servers: [
        {
          url: "http://x:1",
          overrides: { "gpt-*": { cost: { input: 0.2 } } },
        },
      ] as never[],
      persist: vi.fn().mockResolvedValue(undefined),
      done,
      onError: vi.fn(),
      onChanged: vi.fn(),
    });
    return { list, done };
  };

  it("Esc from the field submenu then the entry list lands on the server list", async () => {
    const { list, done } = build();

    list.handleInput(ENTER); // drill into the server row (entry list)
    list.handleInput(ENTER); // open the field submenu
    expect(list.render(80).join("\n")).not.toContain("http://x:1");

    list.handleInput(ESC); // field submenu → entry list
    await flush();
    expect(done).not.toHaveBeenCalled();
    expect(list.render(80).join("\n")).not.toContain("http://x:1");

    list.handleInput(ESC); // entry list → server list
    await flush();
    // The dialog must stay open, showing the server row again
    expect(done).not.toHaveBeenCalled();
    expect(list.render(80).join("\n")).toContain("http://x:1");
  });

  it("Esc from the server list closes the dialog", async () => {
    const { list, done } = build();

    list.handleInput(ESC);
    expect(done).toHaveBeenCalledTimes(1);
  });
});
