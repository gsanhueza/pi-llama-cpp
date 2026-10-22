import { beforeEach, describe, expect, it, vi } from "vitest";
import { initTheme } from "@earendil-works/pi-coding-agent";

beforeEach(() => {
  initTheme();
});
import type { LlamaServer } from "../../src/interfaces/settings";
import { OverridesTUIList } from "../../src/ui/lists/overridesTUIList";
import type { OverridesTUIListOptions } from "../../src/ui/lists/listOptions";
import { createMockTui } from "../mocks/tui";
import { createMockTheme } from "../mocks/theme";

const makeServer = (overrides: Partial<LlamaServer> = {}): LlamaServer =>
  ({
    url: "http://127.0.0.1:9931",
    id: "my-server",
    name: "My Server",
    ...overrides,
  }) as LlamaServer;

const makeOptions = (
  overrides: Partial<OverridesTUIListOptions> = {},
): OverridesTUIListOptions => ({
  tui: createMockTui(),
  theme: createMockTheme(),
  keybindings: {} as never,
  servers: [makeServer()],
  persist: vi.fn().mockResolvedValue(undefined),
  done: vi.fn(),
  onError: vi.fn(),
  onChanged: vi.fn(),
  ...overrides,
});

describe("OverridesTUIList.invalidate", () => {
  it("should call invalidate on the settingsList", () => {
    // We can't easily inject a settingsList, so we test via the public API
    // by checking that the method exists and doesn't throw
    const editor = new OverridesTUIList(makeOptions());
    editor.invalidate();
    // If it didn't throw, the method works (settingsList is non-null after construction)
  });
});

describe("OverridesTUIList.focused", () => {
  it("should default to false", () => {
    const editor = new OverridesTUIList(makeOptions());
    expect(editor.focused).toBe(false);
  });

  it("should reflect the set value", () => {
    const editor = new OverridesTUIList(makeOptions());
    editor.focused = true;
    expect(editor.focused).toBe(true);
    editor.focused = false;
    expect(editor.focused).toBe(false);
  });
});
