import { describe, expect, it, vi } from "vitest";
import { ServerItemBuilder } from "../../../../src/ui/editors/server/itemBuilder";
import { DialogFactory } from "../../../../src/ui/dialog/factory";
import { createMockTui } from "../../../mocks/tui";
import { createMockTheme } from "../../../mocks/theme";
import type { LlamaServer } from "../../../../src/interfaces/settings";

describe("ServerItemBuilder", () => {
  const mockTui = createMockTui();
  const mockTheme = createMockTheme();
  const dialogs = new DialogFactory(mockTheme, mockTui);
  const builder = new ServerItemBuilder(dialogs);

  describe("buildRow", () => {
    const mockServer: LlamaServer = {
      url: "http://localhost:9931",
      id: "test-server",
      name: "Test Server",
    };

    it("returns a SettingItem with server url label", () => {
      const onChange = vi.fn();
      const onSubmenuChange = vi.fn();
      const result = builder.buildRow(
        mockServer,
        0,
        onChange,
        "✅",
        onSubmenuChange,
      );

      expect(result.id).toBe("server-0");
      expect(result.label).toContain("http://localhost:9931");
      expect(result.submenu).toBeDefined();
    });

    it("includes health emoji in label", () => {
      const onChange = vi.fn();
      const onSubmenuChange = vi.fn();
      const result = builder.buildRow(
        mockServer,
        0,
        onChange,
        "❌",
        onSubmenuChange,
      );

      expect(result.label).toContain("❌");
    });

    it("includes description hint", () => {
      const onChange = vi.fn();
      const onSubmenuChange = vi.fn();
      const result = builder.buildRow(
        mockServer,
        0,
        onChange,
        "✅",
        onSubmenuChange,
      );

      expect(result.description).toBeDefined();
    });

    it("includes the server's health suffix in currentValue", () => {
      const onChange = vi.fn();
      const onSubmenuChange = vi.fn();
      const result = builder.buildRow(
        mockServer,
        0,
        onChange,
        "✅",
        onSubmenuChange,
      );

      expect(result.currentValue).toContain("Test Server");
    });
  });
});
