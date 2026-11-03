import { describe, expect, it, vi, beforeEach } from "vitest";
import { RushMenu } from "../../../src/managers/menus/rush";
import { CompletionTracker } from "../../../src/managers/completionTracker";
import { makeSettingsStub } from "../../mocks/settings";
import { createMockCtx } from "../../mocks/context";
import { ApiClient } from "../../../src/api/client";
import { RequestPolicy } from "../../../src/api/client";

describe("RushMenu", () => {
  let tracker: CompletionTracker;
  let settings: ReturnType<typeof makeSettingsStub>;
  let ctx: ReturnType<typeof createMockCtx>;

  beforeEach(() => {
    vi.clearAllMocks();
    tracker = new CompletionTracker();
    settings = makeSettingsStub();
    ctx = createMockCtx(() => null);
  });

  it("notifies when no completion is tracked", async () => {
    const menu = new RushMenu(settings, tracker);
    await menu.show(ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("No reasoning models"),
      "info",
    );
  });

  it("sends a control request when a completion is tracked", async () => {
    tracker.set({
      modelId: "model-a",
      serverUrl: "http://localhost:9931",
      completionId: "comp-123",
      providerId: "llama-server",
    });

    const postMock = vi.fn().mockResolvedValue({
      status: 200,
      text: () => Promise.resolve(""),
    });
    vi.spyOn(ApiClient.prototype, "post").mockImplementation(postMock as any);

    const menu = new RushMenu(settings, tracker);
    await menu.show(ctx);

    expect(postMock).toHaveBeenCalledWith(
      "/v1/chat/completions/control",
      expect.objectContaining({
        id: "comp-123",
        action: "reasoning_end",
        model: "model-a",
      }),
      expect.any(Number),
      RequestPolicy.Raw,
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Skipped thinking"),
      "info",
    );

    vi.restoreAllMocks();
  });

  it("notifies on 404 from the control endpoint", async () => {
    tracker.set({
      modelId: "model-a",
      serverUrl: "http://localhost:9931",
      completionId: "comp-123",
      providerId: "llama-server",
    });

    const postMock = vi.fn().mockResolvedValue({
      status: 404,
      text: () => Promise.resolve("not found"),
    });
    vi.spyOn(ApiClient.prototype, "post").mockImplementation(postMock as any);

    const menu = new RushMenu(settings, tracker);
    await menu.show(ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("does not support endpoint"),
      "info",
    );

    vi.restoreAllMocks();
  });

  it("notifies on network error", async () => {
    tracker.set({
      modelId: "model-a",
      serverUrl: "http://localhost:9931",
      completionId: "comp-123",
      providerId: "llama-server",
    });

    const postMock = vi.fn().mockRejectedValue(new Error("network fail"));
    vi.spyOn(ApiClient.prototype, "post").mockImplementation(postMock as any);

    const menu = new RushMenu(settings, tracker);
    await menu.show(ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("network fail"),
      "info",
    );

    vi.restoreAllMocks();
  });
});
