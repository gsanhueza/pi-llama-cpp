import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import {
  getKeybindings,
  type KeybindingsManager,
  type TUI,
} from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog, InputDialog } from "../src/ui/dialog";
import { ServerSettingsList } from "../src/ui/serverSettingsList";

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
