import { beforeEach, describe, expect, it } from "vitest";
import { Mode } from "../src/enums/mode";
import { Status } from "../src/enums/status";
import { DataProperty } from "../src/interfaces/endpoints/models";
import { SingleModel } from "../src/models/singleModel";
import { createMockServer, mockRpc } from "./mocks";

beforeEach(() => {
  mockRpc.mockClear();
});

const createModel = (extra: Partial<DataProperty> = {}): SingleModel =>
  new SingleModel(
    {
      id: "test",
      tags: [],
      object: "model",
      owned_by: "test",
      created: Date.now(),
      ...extra,
    },
    createMockServer(),
  );

describe("SingleModel mode", () => {
  it("should always return SINGLE mode", () => {
    const model = createModel();
    expect(model.mode).toBe(Mode.SINGLE);
  });
});

describe("SingleModel capabilities", () => {
  it("should detect image capability when multimodal is in capabilities", async () => {
    mockRpc.mockResolvedValueOnce({
      models: [{ id: "test", capabilities: ["multimodal"] }],
    });

    const model = createModel();
    const capabilities = await model.getCapabilities();

    expect(capabilities).toEqual(["text", "image"]);
    expect(mockRpc).toHaveBeenCalledWith("/models");
  });

  it("should detect text-only capability when multimodal is not in capabilities", async () => {
    mockRpc.mockResolvedValueOnce({
      models: [{ id: "test", capabilities: [] }],
    });

    const model = createModel();
    const capabilities = await model.getCapabilities();

    expect(capabilities).toEqual(["text"]);
  });
});

describe("SingleModel getStatus", () => {
  it("should return LOADED when not sleeping", async () => {
    mockRpc.mockResolvedValueOnce({ is_sleeping: false });

    const model = createModel();
    const status = await model.getStatus();

    expect(status).toBe(Status.LOADED);
    expect(mockRpc).toHaveBeenCalledWith(
      `/props?model=${model.id}&autoload=false`,
    );
  });

  it("should return SLEEPING when is_sleeping is true", async () => {
    mockRpc.mockResolvedValueOnce({ is_sleeping: true });

    const model = createModel();
    const status = await model.getStatus();

    expect(status).toBe(Status.SLEEPING);
  });
});

describe("SingleModel getContextSize", () => {
  it("should return n_ctx from /models endpoint meta", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ id: "test", meta: { n_ctx: 8192 } }],
    });

    const model = createModel();
    const ctxSize = await model.getContextSize();

    expect(ctxSize).toBe(8192);
    expect(mockRpc).toHaveBeenCalledWith("/models");
  });
});
