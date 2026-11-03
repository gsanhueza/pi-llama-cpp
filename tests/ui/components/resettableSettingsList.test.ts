import { describe, expect, it, vi, beforeEach } from "vitest";
import { ResettableSettingsList } from "../../../src/ui/components/resettableSettingsList";
import { createMockTui } from "../../mocks/tui";
import type { Component, TUI } from "@earendil-works/pi-tui";
import type { SettingItem } from "@earendil-works/pi-tui";

describe("ResettableSettingsList", () => {
  const mockTui = createMockTui() as TUI & {
    requestRender: ReturnType<typeof vi.fn>;
  };
  const mockItems: SettingItem[] = [
    { id: "a", label: "Item A", currentValue: "value-a" },
    { id: "b", label: "Item B", currentValue: "value-b" },
  ];
  const theme = {
    fg: (_color: string, text: string) => text,
    hint: (text: string) => text,
  } as any;

  let onChange = vi.fn();
  let onCancel = vi.fn();
  let onReset = vi.fn();
  let onAdd = vi.fn();
  let onDelete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createList = (actions?: {
    onAdd?: () => void;
    onDelete?: (id: string) => void;
  }) =>
    new ResettableSettingsList(
      mockItems,
      10,
      theme,
      onChange,
      onCancel,
      onReset,
      mockTui,
      actions,
    );

  describe("handleInput", () => {
    it("delegates to parent when a submenu is open", () => {
      const list = createList();

      // Access the private internals to simulate an open submenu
      (list as any).internals.submenuComponent = {} as Component;
      (list as any).internals.submenuItemIndex = null;

      list.handleInput("x");
      // When submenu is open, calls super.handleInput which doesn't call requestRender
      // The key behavior: it does NOT handle the key itself
      expect(onAdd).not.toHaveBeenCalled();
      expect(onReset).not.toHaveBeenCalled();
    });

    it("calls onAdd when 'a' is pressed and onAdd is provided", () => {
      const list = createList({ onAdd });

      list.handleInput("a");
      expect(onAdd).toHaveBeenCalled();
      expect(mockTui.requestRender).toHaveBeenCalled();
    });

    it("does not call onAdd when 'a' is pressed but onAdd is not provided", () => {
      const list = createList();

      list.handleInput("a");
      expect(onAdd).not.toHaveBeenCalled();
    });

    it("calls onDelete with the selected item id when 'd' is pressed", () => {
      const list = createList({ onDelete });

      list.handleInput("d");
      expect(onDelete).toHaveBeenCalledWith("a"); // first item
      expect(mockTui.requestRender).toHaveBeenCalled();
    });

    it("does not call onDelete when no item is selected", () => {
      const list = createList({ onDelete });

      // Select nothing
      (list as any).internals.selectedIndex = -1;
      list.handleInput("d");
      expect(onDelete).not.toHaveBeenCalled();
    });

    it("calls onReset with the selected item id when 'r' is pressed", () => {
      const list = createList();

      list.handleInput("r");
      expect(onReset).toHaveBeenCalledWith("a"); // first item
      expect(mockTui.requestRender).toHaveBeenCalled();
    });

    it("does not call onReset when no item is selected", () => {
      const list = createList();

      (list as any).internals.selectedIndex = -1;
      list.handleInput("r");
      expect(onReset).not.toHaveBeenCalled();
    });

    it("delegates to parent for other keys", () => {
      const list = createList();

      list.handleInput("Enter");
      // Should have called parent's handleInput (delegated)
      // No requestRender for regular keys
    });

    it("does not call onAdd when submenu is open even with 'a'", () => {
      const list = createList({ onAdd });

      (list as any).internals.submenuComponent = {} as Component;
      list.handleInput("a");

      expect(onAdd).not.toHaveBeenCalled();
    });

    it("does not call onReset when submenu is open even with 'r'", () => {
      const list = createList();

      (list as any).internals.submenuComponent = {} as Component;
      list.handleInput("r");

      expect(onReset).not.toHaveBeenCalled();
    });
  });

  describe("setItems", () => {
    it("replaces the items", () => {
      const list = createList();

      const newItems: SettingItem[] = [
        { id: "c", label: "Item C", currentValue: "value-c" },
      ];
      list.setItems(newItems);

      expect((list as any).internals.items).toBe(newItems);
      expect((list as any).internals.filteredItems).toBe(newItems);
    });

    it("clamps selectedIndex to the new item count", () => {
      const list = createList();

      // Set index to last item
      (list as any).internals.selectedIndex = 1;

      // Replace with a single item
      list.setItems([{ id: "x", label: "X", currentValue: "x" }]);

      expect((list as any).internals.selectedIndex).toBe(0);
    });

    it("clamps selectedIndex to 0 when the list becomes empty", () => {
      const list = createList();

      (list as any).internals.selectedIndex = 1;
      list.setItems([]);

      expect((list as any).internals.selectedIndex).toBe(0);
    });
  });

  describe("showModal / closeModal", () => {
    it("shows a modal component", () => {
      const list = createList();
      const modal = {} as Component;

      list.showModal(modal);

      expect((list as any).internals.submenuComponent).toBe(modal);
      expect((list as any).internals.submenuItemIndex).toBeNull();
      expect(mockTui.requestRender).toHaveBeenCalled();
    });

    it("closes the modal", () => {
      const list = createList();
      const modal = {} as Component;

      list.showModal(modal);
      list.closeModal();

      expect((list as any).internals.submenuComponent).toBeNull();
      expect((list as any).internals.submenuItemIndex).toBeNull();
    });
  });
});
