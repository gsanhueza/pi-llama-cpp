import { beforeEach, describe, expect, it, vi } from "vitest";
import { initTheme } from "@earendil-works/pi-coding-agent";
import type { LlamaServer } from "../../src/interfaces/settings";
import { ServerStatus } from "../../src/enums/serverStatus";
import { Server } from "../../src/servers/server";
import {
  ServerDisplay,
  SERVER_STATUS_ICONS,
} from "../../src/ui/editors/server/utils";
import { ServersTUIList } from "../../src/ui/lists/serversTUIList";
import type { ServersTUIListOptions } from "../../src/ui/editors/editorOptions";
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
  overrides: Partial<ServersTUIListOptions> = {},
): ServersTUIListOptions => ({
  tui: createMockTui(),
  theme: createMockTheme(),
  keybindings: {} as never,
  servers: [makeServer()],
  persist: vi.fn().mockResolvedValue(undefined),
  done: vi.fn(),
  onError: vi.fn(),
  serverTimeout: 1000,
  resolvePollingInterval: vi.fn().mockResolvedValue(500),
  ...overrides,
});

beforeEach(() => {
  initTheme();
  vi.spyOn(ServerDisplay, "healthEmoji").mockResolvedValue(
    SERVER_STATUS_ICONS[ServerStatus.READY],
  );
});

describe("ServersTUIList.handleFieldChange", () => {
  it("should update the server url via field apply", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const options = makeOptions({
      servers: [makeServer({ url: "http://old:9931" })],
      persist,
    });
    const editor = new ServersTUIList(options);
    await editor.ready;

    // Access the protected method via the subclass pattern used in listEditor.test.ts
    (
      editor as unknown as { handleFieldChange: (f: string, v: string) => void }
    ).handleFieldChange("url", "http://new:8080");

    expect(persist).toHaveBeenCalled();
  });
});

describe("ServersTUIList.warnIfAuthRequired", () => {
  it("should notify when server check returns UNAUTHORIZED", async () => {
    const notify = vi.fn();
    const checkSpy = vi
      .spyOn(Server, "check")
      .mockResolvedValue(ServerStatus.UNAUTHORIZED);

    const options = makeOptions({
      ui: { notify } as never,
      authResolver: vi.fn().mockResolvedValue(""),
    });
    const editor = new ServersTUIList(options);
    await editor.ready;

    // Access the private method via type assertion
    await (
      editor as unknown as {
        warnIfAuthRequired: (s: LlamaServer) => Promise<void>;
      }
    ).warnIfAuthRequired(makeServer({ url: "http://127.0.0.1:9931" }));

    expect(notify).toHaveBeenCalled();
    checkSpy.mockRestore();
  });

  it("should not notify when server check returns READY", async () => {
    const notify = vi.fn();
    const checkSpy = vi
      .spyOn(Server, "check")
      .mockResolvedValue(ServerStatus.READY);

    const options = makeOptions({
      ui: { notify } as never,
      authResolver: vi.fn().mockResolvedValue(""),
    });
    const editor = new ServersTUIList(options);
    await editor.ready;

    await (
      editor as unknown as {
        warnIfAuthRequired: (s: LlamaServer) => Promise<void>;
      }
    ).warnIfAuthRequired(makeServer({ url: "http://127.0.0.1:9931" }));

    expect(notify).not.toHaveBeenCalled();
    checkSpy.mockRestore();
  });
});
