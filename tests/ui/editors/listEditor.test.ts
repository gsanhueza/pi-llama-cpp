import { describe, expect, it, vi } from "vitest";
import type { LlamaServer } from "../../../src/interfaces/settings";
import { ListEditor } from "../../../src/ui/editors/listEditor";
import type { BaseTUIListOptions } from "../../../src/ui/lists/listOptions";
import { createMockTui } from "../../mocks/tui";
import { createMockTheme } from "../../mocks/theme";

const makeServer = (overrides: Partial<LlamaServer> = {}): LlamaServer =>
  ({
    url: "http://127.0.0.1:9931",
    id: "my-server",
    name: "My Server",
    ...overrides,
  }) as LlamaServer;

const makeOptions = (
  overrides: Partial<BaseTUIListOptions> = {},
): BaseTUIListOptions => ({
  tui: createMockTui(),
  theme: createMockTheme(),
  keybindings: {} as never,
  servers: [makeServer()],
  persist: vi.fn().mockResolvedValue(undefined),
  done: vi.fn(),
  onError: vi.fn(),
  ...overrides,
});

// Concrete subclass to make ListEditor instantiable for testing
class TestListEditor extends ListEditor {
  buildSettingsList(): never {
    throw new Error("Not implemented");
  }
  beginAdd(): never {
    throw new Error("Not implemented");
  }
  deleteSelected(): never {
    throw new Error("Not implemented");
  }
  getRowLabel(): string {
    return "test";
  }
  protected readonly emptyHintKey = "emptyServers" as const;
  protected getRowId(_index: number): string {
    return "test-row";
  }
  protected get deleteTitle(): string {
    return "Delete";
  }
  // Test helpers to expose protected members
  testPersistSnapshot(next: LlamaServer[], onSuccess: () => void) {
    return this.persistSnapshot(next, onSuccess);
  }
  testCommitFieldChange(
    next: LlamaServer[],
    deferIndex: number | null,
    refresh: () => void,
  ) {
    return this.commitFieldChange(next, deferIndex, refresh);
  }
  get testSubmenuOpen() {
    return this.submenuOpen;
  }
  set testSubmenuOpen(val: boolean) {
    this.submenuOpen = val;
  }
  get testOptions() {
    return this.options;
  }
  get testDeferredRebuild() {
    return (this as unknown as { deferredRebuild: number | null })
      .deferredRebuild;
  }
  get testSelectedIndex() {
    return this.selectedIndex;
  }
  set testSelectedIndex(val: number) {
    this.selectedIndex = val;
  }
}

describe("ListEditor.persistSnapshot", () => {
  it("should call onError and requestRender when persist rejects", async () => {
    const onError = vi.fn();
    const tui = createMockTui();
    const editor = new TestListEditor(
      makeOptions({
        persist: vi.fn().mockRejectedValue("save failed"),
        onError,
        tui,
      }),
    );

    await editor.testPersistSnapshot([makeServer()], () => {});

    expect(onError).toHaveBeenCalledWith("save failed");
    expect(tui.requestRender).toHaveBeenCalled();
  });

  it("should adopt next and call onSuccess on success", async () => {
    const onSuccess = vi.fn();
    const next = [makeServer({ url: "http://new:8080" })];
    const editor = new TestListEditor(
      makeOptions({
        servers: [makeServer({ url: "http://old:9931" })],
        persist: vi.fn().mockResolvedValue(undefined),
      }),
    );

    await editor.testPersistSnapshot(next, onSuccess);

    expect(editor.testOptions.servers).toBe(next);
    expect(onSuccess).toHaveBeenCalled();
  });
});

describe("ListEditor.commitFieldChange", () => {
  it("should set deferredRebuild when submenu is open and deferIndex is provided", async () => {
    const editor = new TestListEditor(makeOptions());
    editor.testSubmenuOpen = true;

    editor.testCommitFieldChange(
      [makeServer({ url: "http://new:8080" })],
      5,
      () => {},
    );

    // persistSnapshot is async — wait for the microtask to settle
    await vi.waitFor(() => {
      expect(editor.testDeferredRebuild).toBe(5);
    });
  });

  it("should not set deferredRebuild when submenu is not open", () => {
    const editor = new TestListEditor(makeOptions());
    editor.testSubmenuOpen = false;

    editor.testCommitFieldChange(
      [makeServer({ url: "http://new:8080" })],
      5,
      () => {},
    );

    expect(editor.testDeferredRebuild).toBeNull();
  });

  it("should be a no-op when next is the same reference", () => {
    const onError = vi.fn();
    const persist = vi.fn();
    const servers = [makeServer()];
    const editor = new TestListEditor(
      makeOptions({
        servers,
        persist,
        onError,
      }),
    );
    editor.testSubmenuOpen = true;

    editor.testCommitFieldChange(servers, 5, () => {});

    expect(persist).not.toHaveBeenCalled();
    expect(editor.testDeferredRebuild).toBeNull();
  });
});

describe("ListEditor.invalidate with active dialog", () => {
  it("should also invalidate the active dialog", () => {
    const dialog = { invalidate: vi.fn() };
    const editor = new TestListEditor(makeOptions());
    (editor as any).activeDialog = dialog;

    editor.invalidate();

    expect(dialog.invalidate).toHaveBeenCalled();
  });
});

describe("ListEditor.handleInput up keywrap", () => {
  it("should wrap selectedIndex from 0 to last when pressing up", () => {
    const kb = {
      matches: vi.fn(
        (data: string, key: string) => key === "tui.select.up" && data === "up",
      ),
    };
    const servers = [makeServer(), makeServer()];
    const editor = new TestListEditor(
      makeOptions({
        servers,
        keybindings: kb as never,
      }),
    );
    editor.testSelectedIndex = 0;

    // Access the protected handleInput
    (editor as any).handleInput("up");

    expect(kb.matches).toHaveBeenCalledWith("up", "tui.select.up");
    expect(editor.testSelectedIndex).toBe(1);
  });
});

describe("ListEditor.rebuildList empty list", () => {
  it("should reset selectedIndex to 0 and requestRender when list is empty", async () => {
    const tui = createMockTui();
    const settingsList = {
      invalidate: vi.fn(),
      render: vi.fn().mockReturnValue(["test"]),
    };
    const options = makeOptions({
      servers: [],
      tui,
    });
    const editor = new TestListEditor(options);
    // Mock buildSettingsList to return a valid settingsList
    (editor as any).buildSettingsList = () =>
      Promise.resolve(settingsList as never);

    // Access the protected rebuildList
    await (editor as any).rebuildList(0);

    expect(editor.testSelectedIndex).toBe(0);
    expect(tui.requestRender).toHaveBeenCalled();
  });
});
