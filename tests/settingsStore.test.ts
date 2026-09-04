import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsStore } from "../src/utils/settingsStore";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: vi.fn().mockReturnValue("/fake/agent/dir"),
}));

const mockReadFile = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());
const mockRename = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  rename: mockRename,
}));

const mockGetAgentDir = vi.mocked(getAgentDir);

const SETTINGS_PATH = "/fake/agent/dir/settings.json";

describe("SettingsStore.read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentDir.mockReturnValue("/fake/agent/dir");
  });

  it("should return {} when the file is missing (ENOENT)", async () => {
    mockReadFile.mockRejectedValue(
      Object.assign(new Error("nope"), { code: "ENOENT" }),
    );

    const store = new SettingsStore(SETTINGS_PATH);

    await expect(store.read()).resolves.toEqual({});
  });

  it("should reject with a message containing the path on invalid JSON", async () => {
    mockReadFile.mockResolvedValue("{ not valid json");

    const store = new SettingsStore(SETTINGS_PATH);

    await expect(store.read()).rejects.toThrow(/Cannot parse.*settings\.json/);
  });

  it("should propagate non-ENOENT IO errors", async () => {
    mockReadFile.mockRejectedValue(
      Object.assign(new Error("permission denied"), { code: "EACCES" }),
    );

    const store = new SettingsStore(SETTINGS_PATH);

    await expect(store.read()).rejects.toMatchObject({ code: "EACCES" });
  });

  it("should default the path to <agentDir>/settings.json", async () => {
    mockReadFile.mockResolvedValue('{"a":1}');

    const store = new SettingsStore();
    await store.read();

    expect(mockReadFile).toHaveBeenCalledWith(SETTINGS_PATH, "utf-8");
  });
});

describe("SettingsStore.updateKey — file content", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentDir.mockReturnValue("/fake/agent/dir");
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
  });

  it("should create the file with only the target key when the file was missing", async () => {
    mockReadFile.mockRejectedValue(
      Object.assign(new Error("nope"), { code: "ENOENT" }),
    );

    const store = new SettingsStore(SETTINGS_PATH);
    await store.updateKey("llamaSettings", () => ({ sortBy: "asc" }));

    const [, written] = mockWriteFile.mock.calls[0];
    expect(JSON.parse(written as string)).toEqual({
      llamaSettings: { sortBy: "asc" },
    });
  });

  it("should preserve unrelated keys, their order, and merge into an existing target key", async () => {
    mockReadFile.mockResolvedValue(
      '{"aaa":1,"llamaSettings":{"sortBy":"asc"},"zzz":9}',
    );

    const store = new SettingsStore(SETTINGS_PATH);
    await store.updateKey("llamaSettings", (current) => ({
      ...(current as Record<string, unknown>),
      sortBy: "desc",
    }));

    const [, written] = mockWriteFile.mock.calls[0];
    const parsed = JSON.parse(written as string);
    expect(Object.keys(parsed)).toEqual(["aaa", "llamaSettings", "zzz"]);
    expect(parsed.llamaSettings).toEqual({ sortBy: "desc" });
  });

  it("should start from {} when the target key holds a non-object (null)", async () => {
    mockReadFile.mockResolvedValue('{"llamaSettings":null}');

    const store = new SettingsStore(SETTINGS_PATH);
    await store.updateKey("llamaSettings", (current) => ({
      ...(typeof current === "object" && current !== null ? current : {}),
      autoloadOnMessage: true,
    }));

    const [, written] = mockWriteFile.mock.calls[0];
    expect(JSON.parse(written as string)).toEqual({
      llamaSettings: { autoloadOnMessage: true },
    });
  });
});

describe("SettingsStore.updateKey — write path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentDir.mockReturnValue("/fake/agent/dir");
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
  });

  it("should write to <path>.tmp with 2-space indent, then rename onto the real path", async () => {
    mockReadFile.mockResolvedValue('{"llamaSettings":{"sortBy":"asc"}}');

    const store = new SettingsStore(SETTINGS_PATH);
    await store.updateKey("llamaSettings", (current) => ({
      ...(current as Record<string, unknown>),
      sortBy: "desc",
    }));

    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockWriteFile).toHaveBeenCalledWith(
      `${SETTINGS_PATH}.tmp`,
      expect.stringContaining('\n  "llamaSettings"'),
      "utf-8",
    );
    expect(mockRename).toHaveBeenCalledTimes(1);
    expect(mockRename).toHaveBeenCalledWith(
      `${SETTINGS_PATH}.tmp`,
      SETTINGS_PATH,
    );
  });

  it("should apply queued concurrent writes in submission order (last write wins)", async () => {
    // Simulate a real file: reads return the last written content.
    let contents = "{}";
    mockReadFile.mockImplementation(async () => contents);
    mockWriteFile.mockImplementation(async (_path: unknown, data: string) => {
      contents = data;
    });

    const store = new SettingsStore(SETTINGS_PATH);
    const first = store.updateKey("llamaSettings", (current) => ({
      ...(current as Record<string, unknown>),
      first: 1,
    }));
    const second = store.updateKey("llamaSettings", (current) => ({
      ...(current as Record<string, unknown>),
      second: 2,
    }));

    await first;
    await second;

    // Without the queue both writes would read the same "{}" and the final
    // content would only hold the last caller's key.
    expect(mockReadFile).toHaveBeenCalledTimes(2);
    expect(mockWriteFile).toHaveBeenCalledTimes(2);
    const [, firstWrite] = mockWriteFile.mock.calls[0];
    const [, secondWrite] = mockWriteFile.mock.calls[1];
    expect(JSON.parse(firstWrite as string)).toEqual({
      llamaSettings: { first: 1 },
    });
    expect(JSON.parse(secondWrite as string)).toEqual({
      llamaSettings: { first: 1, second: 2 },
    });
  });

  it("should reject a failing write but let the next queued update still run", async () => {
    mockReadFile.mockResolvedValue('{"llamaSettings":{}}');
    mockWriteFile.mockRejectedValueOnce(new Error("ENOSPC: simulated"));

    const store = new SettingsStore(SETTINGS_PATH);
    const failing = store.updateKey("llamaSettings", (current) => ({
      ...(current as Record<string, unknown>),
      a: 1,
    }));
    const following = store.updateKey("llamaSettings", (current) => ({
      ...(current as Record<string, unknown>),
      b: 2,
    }));

    await expect(failing).rejects.toThrow("ENOSPC");
    await expect(following).resolves.toBeUndefined();

    const [, lastWrite] = mockWriteFile.mock.calls[1];
    expect(JSON.parse(lastWrite as string)).toEqual({
      llamaSettings: { b: 2 },
    });
  });
});
