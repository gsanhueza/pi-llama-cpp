import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandManager } from "../src/managers/command";
import { ServerManager } from "../src/managers/server";
import { mockRpc } from "./mocks";

const mockPi = {
  registerProvider: vi.fn(),
  registerCommand: vi.fn(),
  setModel: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockResolvedValue({});
});

describe("CommandManager", () => {
  let serverManager: ServerManager;
  let commandManager: CommandManager;

  beforeEach(() => {
    serverManager = new ServerManager(mockPi as any, []);
    commandManager = new CommandManager(serverManager);
  });

  it("should provide argument completions for /models", () => {
    const completions = commandManager.getArgumentCompletions("");
    expect(completions).toHaveLength(2);
    expect(completions?.map((c) => c.value)).toEqual(["info", "unload"]);
  });

  it("should filter completions by prefix", () => {
    const completions = commandManager.getArgumentCompletions("u");
    expect(completions).toHaveLength(1);
    expect(completions?.[0].value).toBe("unload");
  });

  it("should return null when no completions match", () => {
    const completions = commandManager.getArgumentCompletions("zzz");
    expect(completions).toBeNull();
  });
});
