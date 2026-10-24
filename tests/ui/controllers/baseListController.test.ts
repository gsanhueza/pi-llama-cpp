import { describe, expect, it, vi, beforeEach } from "vitest";
import { BaseListController } from "../../../src/ui/controllers/baseListController";
import type {
  BaseListControllerHandle,
  BaseListControllerOptions,
} from "../../../src/ui/controllers/baseListController";
import type { DialogFactory } from "../../../src/ui/dialog/factory";
import type { BaseDialog } from "../../../src/ui/dialog/base";
import type {
  KeybindingsManager,
  SettingsList,
  TUI,
} from "@earendil-works/pi-tui";
import type { LlamaServer } from "../../../src/interfaces/settings";
import type { SettingsService } from "../../../src/settings/settings";

// Concrete implementation for testing
class TestController extends BaseListController {
  private items: LlamaServer[] = [];

  constructor(
    view: BaseListControllerHandle,
    options: BaseListControllerOptions,
    dialogs: DialogFactory,
    settings: SettingsService,
  ) {
    super(view, options, dialogs, settings);
    this.items = options.servers;
  }

  protected getCount(): number {
    return this.items.length;
  }

  async persistSnapshot(next: LlamaServer[]): Promise<boolean> {
    this.items = next;
    return super.persistSnapshot(next);
  }

  override rebuildList(targetIndex: number): Promise<void> {
    return super.rebuildList(targetIndex);
  }

  override delegateInput(data: string): boolean {
    return super.delegateInput(data);
  }
}

describe("BaseListController", () => {
  const mockTui = {
    requestRender: vi.fn(),
  } as unknown as TUI;

  const mockKeybindings = {
    matches: vi.fn(
      (_data: string, action: string) =>
        action === "tui.select.up" || action === "tui.select.down",
    ) as unknown as KeybindingsManager["matches"],
  } as unknown as KeybindingsManager;

  const mockDialogs = {} as DialogFactory;

  const mockSettings = {
    setLlamaSettings: vi.fn().mockResolvedValue(undefined),
    getLlamaSettings: vi.fn().mockResolvedValue({}),
    deleteLlamaSetting: vi.fn().mockResolvedValue(undefined),
  } as unknown as SettingsService;

  const mockHandle: BaseListControllerHandle = {
    buildSettingsList: vi.fn().mockResolvedValue({
      selectItem: vi.fn(),
      updateValue: vi.fn(),
    } as unknown as SettingsList),
    setList: vi.fn(),
    onClose: vi.fn(),
    tui: mockTui,
    isFocused: true,
    getRowId: vi.fn((i: number) => `row-${i}`),
    getRowLabel: vi.fn((i: number) => `label-${i}`),
  };

  const mockOptions: BaseListControllerOptions = {
    keybindings: mockKeybindings,
    tui: mockTui,
    servers: [{ url: "http://localhost:8080" }] as LlamaServer[],
    onError: vi.fn(),
  };

  let controller: TestController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new TestController(
      mockHandle,
      mockOptions,
      mockDialogs,
      mockSettings,
    );
  });

  describe("selected index", () => {
    it("starts at 0", () => {
      expect(controller.getSelectedIndex()).toBe(0);
    });
  });

  describe("requestRender", () => {
    it("delegates to the TUI", () => {
      controller.requestRender();
      expect(mockTui.requestRender).toHaveBeenCalled();
    });
  });

  describe("setFocus", () => {
    it("sets focus on the active dialog", () => {
      const mockDialog = { focused: false } as unknown as BaseDialog;
      controller.openDialog(mockDialog);
      controller.setFocus(false);
      expect(mockDialog.focused).toBe(false);
    });

    it("does nothing when no dialog is active", () => {
      controller.setFocus(true);
      // No error thrown
    });
  });

  describe("getActiveDialog", () => {
    it("returns undefined when no dialog is open", () => {
      expect(controller.getActiveDialog()).toBeUndefined();
    });

    it("returns the active dialog", () => {
      const mockDialog = {} as BaseDialog;
      controller.openDialog(mockDialog);
      expect(controller.getActiveDialog()).toBe(mockDialog);
    });
  });

  describe("openDialog / closeDialog", () => {
    it("opens a dialog and sets its focus", () => {
      const mockDialog = { focused: false } as unknown as BaseDialog;
      controller.openDialog(mockDialog);
      expect(mockDialog.focused).toBe(true);
      expect(mockTui.requestRender).toHaveBeenCalled();
    });

    it("closes the active dialog", () => {
      const mockDialog = { focused: true } as unknown as BaseDialog;
      controller.openDialog(mockDialog);
      controller.closeDialog();
      expect(controller.getActiveDialog()).toBeUndefined();
      expect(mockTui.requestRender).toHaveBeenCalled();
    });
  });

  describe("persistSnapshot", () => {
    it("persists via SettingsService and returns true on success", async () => {
      const next: LlamaServer[] = [{ url: "http://new-url" }];
      const result = await controller.persistSnapshot(next);
      expect(mockSettings.setLlamaSettings).toHaveBeenCalledWith({
        servers: next,
      });
      expect(result).toBe(true);
    });

    it("calls onError and returns false on failure", async () => {
      (
        mockSettings.setLlamaSettings as ReturnType<typeof vi.fn>
      ).mockRejectedValue(new Error("save failed"));
      const result = await controller.persistSnapshot([]);
      expect(mockOptions.onError).toHaveBeenCalledWith("Error: save failed");
      expect(result).toBe(false);
    });
  });

  describe("rebuildList", () => {
    it("rebuilds the list and selects the target index", async () => {
      await controller.rebuildList(1);
      expect(mockHandle.buildSettingsList).toHaveBeenCalled();
      expect(mockHandle.setList).toHaveBeenCalled();
      // selectedIndex should be clamped to count - 1
      expect(controller.getSelectedIndex()).toBe(0);
    });

    it("clamps the target index to the list length", async () => {
      controller["items"] = [{ url: "a" }, { url: "b" }];
      await controller.rebuildList(99);
      expect(controller.getSelectedIndex()).toBe(1);
    });

    it("handles an empty list", async () => {
      controller["items"] = [];
      await controller.rebuildList(0);
      expect(controller.getSelectedIndex()).toBe(0);
    });
  });

  describe("delegateInput", () => {
    it("delegates to the active dialog when one is open", () => {
      const mockDialog = { handleInput: vi.fn() } as unknown as BaseDialog;
      controller.openDialog(mockDialog);
      controller.delegateInput("x");
      expect(mockDialog.handleInput).toHaveBeenCalledWith("x");
    });

    it("handles cancel keybinding", () => {
      (mockKeybindings.matches as ReturnType<typeof vi.fn>).mockReturnValueOnce(
        true,
      );
      const result = controller.delegateInput("cancel-key");
      expect(result).toBe(true);
      expect(mockHandle.onClose).toHaveBeenCalled();
    });

    it("handles up keybinding", () => {
      controller["items"] = [{ url: "a" }, { url: "b" }, { url: "c" }];
      controller.delegateInput("up-key");
      expect(controller.getSelectedIndex()).toBe(2); // wraps to last
    });

    it("handles down keybinding", () => {
      controller["items"] = [{ url: "a" }, { url: "b" }];
      controller.delegateInput("down-key");
      expect(controller.getSelectedIndex()).toBe(1);
    });

    it("returns false when no input is consumed", () => {
      const result = controller.delegateInput("unknown");
      expect(result).toBe(false);
    });
  });
});
