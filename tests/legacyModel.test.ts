import { beforeEach, describe, expect, it } from "vitest";
import { Mode } from "../src/enums/mode";
import { Status } from "../src/enums/status";
import { DataProperty } from "../src/interfaces/endpoints/models";
import { LegacyModel } from "../src/models/legacyModel";
import { createMockServer, mockRpc } from "./mocks";

beforeEach(() => {
  mockRpc.mockReset();
});

const createModel = (extra: Partial<DataProperty> = {}): LegacyModel =>
  new LegacyModel(
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

describe("LegacyModel mode", () => {
  it("should always return LEGACY mode", () => {
    const model = createModel();
    expect(model.mode).toBe(Mode.LEGACY);
  });
});

describe("LegacyModel capabilities", () => {
  it("should detect image capability when multimodal is in capabilities", async () => {
    mockRpc.mockResolvedValueOnce({ modalities: { vision: true } });

    const model = createModel();
    const capabilities = await model.getCapabilities();

    expect(capabilities).toEqual(["text", "image"]);
  });

  it("should detect text-only capability when multimodal is not in capabilities", async () => {
    mockRpc.mockResolvedValueOnce({ modalities: { vision: false } });

    const model = createModel();
    const capabilities = await model.getCapabilities();

    expect(capabilities).toEqual(["text"]);
  });
});

describe("LegacyModel getStatus", () => {
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

describe("LegacyModel getContextSize", () => {
  it("should use max_model_len when it is non-zero", async () => {
    mockRpc.mockResolvedValueOnce({ n_ctx: 4096 });
    mockRpc.mockResolvedValueOnce({
      data: [{ max_model_len: 8192 }],
    });

    const model = createModel();
    const ctxSize = await model.getContextSize();

    expect(ctxSize).toBe(8192);
    expect(mockRpc).toHaveBeenCalledWith("/v1/models");
  });

  it("should fall back to n_ctx when max_model_len is 0", async () => {
    mockRpc.mockResolvedValueOnce({ n_ctx: 4096 });
    mockRpc.mockResolvedValueOnce({
      data: [{ max_model_len: 0 }],
    });

    const model = createModel();
    const ctxSize = await model.getContextSize();

    expect(ctxSize).toBe(4096);
  });

  it("should return DEFAULT_CTX when both values are missing/null", async () => {
    mockRpc.mockResolvedValueOnce({});
    mockRpc.mockResolvedValueOnce({
      data: [{ max_model_len: null }],
    });

    const model = createModel();
    const ctxSize = await model.getContextSize();

    expect(ctxSize).toBe(128000);
  });
});
