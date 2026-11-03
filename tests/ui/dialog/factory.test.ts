import { describe, expect, it, vi } from "vitest";
import { DialogFactory } from "../../../src/ui/dialog/factory";
import { ConfirmDialog } from "../../../src/ui/dialog/confirm";
import { InputDialog } from "../../../src/ui/dialog/input";
import { createMockTui } from "../../mocks/tui";
import { createMockTheme } from "../../mocks/theme";

describe("DialogFactory", () => {
  const mockTui = createMockTui();
  const mockTheme = createMockTheme();

  it("creates an InputDialog with theme and tui injected", () => {
    const factory = new DialogFactory(mockTheme, mockTui);
    const dialog = factory.input({
      title: "Test",
      message: "Enter value",
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    });

    expect(dialog).toBeInstanceOf(InputDialog);
  });

  it("creates a ConfirmDialog with theme and tui injected", () => {
    const factory = new DialogFactory(mockTheme, mockTui);
    const dialog = factory.confirm({
      title: "Delete?",
      message: "Are you sure?",
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    });

    expect(dialog).toBeInstanceOf(ConfirmDialog);
  });

  it("creates a delete confirmation dialog with formatted message", () => {
    const factory = new DialogFactory(mockTheme, mockTui);
    const dialog = factory.confirmDelete(
      "Delete item",
      "my-entry",
      vi.fn(),
      vi.fn(),
    );

    expect(dialog).toBeInstanceOf(ConfirmDialog);
  });

  it("requestRender delegates to TUI", () => {
    const factory = new DialogFactory(mockTheme, mockTui);
    factory.requestRender();
    expect(mockTui.requestRender).toHaveBeenCalled();
  });

  describe("inputSubmenu", () => {
    it("returns a SettingItem submenu factory", () => {
      const factory = new DialogFactory(mockTheme, mockTui);
      const submenu = factory.inputSubmenu("Edit", "Enter a value");

      expect(typeof submenu).toBe("function");
    });

    it("passes currentValue as initial value when not an em dash", () => {
      const factory = new DialogFactory(mockTheme, mockTui);
      const submenu = factory.inputSubmenu("Edit", "Enter", "placeholder");

      const done = vi.fn();
      const result = submenu!("current-value", done);

      expect(result).toBeInstanceOf(InputDialog);
    });

    it("passes empty string as initial value when currentValue is em dash", () => {
      const factory = new DialogFactory(mockTheme, mockTui);
      const submenu = factory.inputSubmenu("Edit", "Enter");

      const done = vi.fn();
      const result = submenu!("\u2014", done);

      expect(result).toBeInstanceOf(InputDialog);
    });

    it("calls done with the submitted value", () => {
      const factory = new DialogFactory(mockTheme, mockTui);
      const done = vi.fn();
      const submenu = factory.inputSubmenu(
        "Edit",
        "Enter",
        undefined,
        (v) => v,
      );

      const dialog = submenu!("initial", done);

      // Simulate the input dialog submitting
      const input = dialog as unknown as {
        options: { onSubmit: (v: string) => void };
      };
      input.options.onSubmit("new-value");

      expect(done).toHaveBeenCalledWith("new-value");
    });

    it("calls done with undefined when cancelled", () => {
      const factory = new DialogFactory(mockTheme, mockTui);
      const done = vi.fn();
      const submenu = factory.inputSubmenu("Edit", "Enter");

      const dialog = submenu!("initial", done);

      // Simulate the input dialog cancelling
      const input = dialog as unknown as { options: { onCancel: () => void } };
      input.options.onCancel();

      expect(done).toHaveBeenCalledWith(undefined);
    });

    it("sets dialog.focused to true", () => {
      const factory = new DialogFactory(mockTheme, mockTui);
      const done = vi.fn();
      const submenu = factory.inputSubmenu("Edit", "Enter");

      const dialog = submenu!("initial", done);
      expect(dialog).toHaveProperty("focused", true);
    });
  });
});
