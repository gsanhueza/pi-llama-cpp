import { describe, expect, it, vi, beforeEach } from "vitest";
import { ReloadMenu } from "../../../src/managers/menus/reload";
import { ServerManager } from "../../../src/managers/server";
import { EventManager } from "../../../src/managers/events";
import { InflightTracker } from "../../../src/managers/inflightTracker";
import { CompletionTracker } from "../../../src/managers/completionTracker";
import { makeSettingsStub } from "../../mocks/settings";
import { createMockCtx, createMockPi } from "../../mocks/context";
import { createMockServer } from "../../mocks/server";
import { createMockModel } from "../../mocks/model";
import { Status } from "../../../src/enums/status";

describe("ReloadMenu", () => {
  let ctx = createMockCtx(() => null);
  let pi = createMockPi();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createManager = (models: ReturnType<typeof createMockModel>[]) => {
    const server = createMockServer({ models });
    const manager = new ServerManager(makeSettingsStub(), {
      create: async () => ({ server, status: { ready: true } as any }),
    });
    const eventManager = new EventManager(
      manager,
      makeSettingsStub(),
      new InflightTracker(),
      new CompletionTracker(),
    );
    return { manager, eventManager, server };
  };

  it("notifies when no models are reloadable", async () => {
    const { manager, eventManager } = createManager([
      createMockModel("model-x", {
        getStatus: vi.fn().mockResolvedValue(Status.UNLOADED),
      }),
    ]);

    const updateSpy = vi.spyOn(manager, "update").mockResolvedValue(undefined);

    const menu = new ReloadMenu(manager, eventManager);
    await menu.show(ctx, pi);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("No loaded or sleeping models"),
      "info",
    );
    expect(updateSpy).toHaveBeenCalled();
  });

  it("notifies when some models are reloadable", async () => {
    const { manager, eventManager } = createManager([
      createMockModel("model-a", {
        getStatus: vi.fn().mockResolvedValue(Status.LOADED),
      }),
    ]);

    const updateSpy = vi.spyOn(manager, "update").mockResolvedValue(undefined);

    const menu = new ReloadMenu(manager, eventManager);
    await menu.show(ctx, pi);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Reloading"),
      "info",
    );
    expect(updateSpy).toHaveBeenCalled();
  });
});
