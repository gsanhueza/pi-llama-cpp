import { beforeEach, describe, expect, it } from "vitest";
import { Mode } from "../src/enums/mode";
import { DataProperty } from "../src/interfaces/endpoints/models";
import { RouterModel } from "../src/models/routerModel";
import { createMockServer, mockRpc } from "./mocks";

// Helper to create a mock DataProperty
const createModel = (overrides: Partial<DataProperty> = {}): DataProperty => ({
  id: "test-model",
  aliases: ["test-alias"],
  tags: [],
  object: "model",
  owned_by: "test",
  created: Date.now(),
  status: { value: "loaded", args: [], preset: "default", failed: false },
  ...overrides,
});

beforeEach(() => {
  mockRpc.mockClear();
});

describe("RouterModel context size extraction", () => {
  it("should extract --ctx-size value", () => {
    const model = new RouterModel(
      createModel({
        status: {
          value: "loaded",
          args: [
            "--model",
            "gguf",
            "--ctx-size",
            "4096",
            "--batch-size",
            "512",
          ],
          preset: "default",
        },
      }),
      createMockServer(),
    );

    // Access the private method via any
    const extractFrom = (model as any).extractFrom.bind(model);
    expect(extractFrom("--ctx-size")).toBe(4096);
  });

  it("should extract --fit-ctx value when --ctx-size is not present", () => {
    const model = new RouterModel(
      createModel({
        status: {
          value: "loaded",
          args: ["--model", "gguf", "--fit-ctx", "8192"],
          preset: "default",
        },
      }),
      createMockServer(),
    );

    const extractFrom = (model as any).extractFrom.bind(model);
    expect(extractFrom("--fit-ctx")).toBe(8192);
  });

  it("should return null when argument is not found", () => {
    const model = new RouterModel(
      createModel({
        status: {
          value: "loaded",
          args: ["--model", "gguf", "--batch-size", "512"],
          preset: "default",
        },
      }),
      createMockServer(),
    );

    const extractFrom = (model as any).extractFrom.bind(model);
    expect(extractFrom("--ctx-size")).toBeNull();
    expect(extractFrom("--fit-ctx")).toBeNull();
  });

  it("should return null when argument has no following value", () => {
    const model = new RouterModel(
      createModel({
        status: {
          value: "loaded",
          args: ["--model", "gguf", "--ctx-size"],
          preset: "default",
        },
      }),
      createMockServer(),
    );

    const extractFrom = (model as any).extractFrom.bind(model);
    expect(extractFrom("--ctx-size")).toBeNull();
  });

  it("should return null when argument value is not a valid number", () => {
    const model = new RouterModel(
      createModel({
        status: {
          value: "loaded",
          args: ["--model", "gguf", "--ctx-size", "not-a-number"],
          preset: "default",
        },
      }),
      createMockServer(),
    );

    const extractFrom = (model as any).extractFrom.bind(model);
    expect(extractFrom("--ctx-size")).toBeNull();
  });

  it("should prefer --ctx-size over --fit-ctx when loaded", async () => {
    // First call: getStatus() -> fetchModelProps
    mockRpc.mockResolvedValueOnce({ is_sleeping: false });
    // Second call: super.getContextSize() -> fetchModels with meta.n_ctx
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          id: "test-model",
          meta: { n_ctx: 4096 },
        },
      ],
    });

    const model = new RouterModel(
      createModel({
        status: {
          value: "loaded",
          args: ["--model", "gguf", "--ctx-size", "4096", "--fit-ctx", "8192"],
          preset: "default",
        },
      }),
      createMockServer(),
    );

    const ctxSize = await model.getContextSize();
    expect(ctxSize).toBe(4096);
  });

  it("should return n_ctx from meta when loaded without context size args", async () => {
    // First call: getStatus() -> fetchModelProps
    mockRpc.mockResolvedValueOnce({ is_sleeping: false });
    // Second call: super.getContextSize() -> fetchModels with meta.n_ctx
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          id: "test-model",
          meta: { n_ctx: 4096 },
        },
      ],
    });

    const model = new RouterModel(
      createModel({
        status: {
          value: "loaded",
          args: ["--model", "gguf"],
          preset: "default",
        },
      }),
      createMockServer(),
    );

    const ctxSize = await model.getContextSize();
    expect(ctxSize).toBe(4096);
  });
});

describe("RouterModel capabilities detection", () => {
  it("should detect image capability when modalities.vision is true", async () => {
    mockRpc.mockResolvedValueOnce({ modalities: { vision: true } });

    const model = new RouterModel(createModel(), createMockServer());
    const capabilities = await model.getCapabilities();

    expect(capabilities).toEqual(["text", "image"]);
    expect(mockRpc).toHaveBeenCalledWith(
      "/props?model=test-model&autoload=false",
    );
  });

  it("should return text-only when fetchModelProps fails", async () => {
    // First call (fetchModelProps) throws to trigger fallback
    mockRpc.mockRejectedValueOnce(new Error("props not available"));
    // Second call (fetchModels) returns empty data so model is not found
    mockRpc.mockResolvedValueOnce({ data: [] });

    const model = new RouterModel(createModel(), createMockServer());
    const capabilities = await model.getCapabilities();

    expect(capabilities).toEqual(["text"]);
  });

  it("should detect text-only capability when only text in input_modalities", async () => {
    // First call (fetchModelProps) throws to trigger fallback
    mockRpc.mockRejectedValueOnce(new Error("props not available"));
    // Second call (fetchModels) returns the data
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          id: "test-model",
          status: {
            value: "loaded",
            args: [],
            preset: "default",
            failed: false,
          },
          architecture: {
            input_modalities: ["text"],
            output_modalities: ["text"],
          },
        },
      ],
    });

    const model = new RouterModel(createModel(), createMockServer());
    const capabilities = await model.getCapabilities();

    expect(capabilities).toEqual(["text"]);
  });

  it("should return text when model not found in /models response", async () => {
    // First call (fetchModelProps) throws to trigger fallback
    mockRpc.mockRejectedValueOnce(new Error("props not available"));
    // Second call (fetchModels) returns data without matching model
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          id: "other-model",
          status: {
            value: "loaded",
            args: [],
            preset: "default",
            failed: false,
          },
        },
      ],
    });

    const model = new RouterModel(createModel(), createMockServer());
    const capabilities = await model.getCapabilities();

    expect(capabilities).toEqual(["text"]);
  });
});

describe("RouterModel mode", () => {
  it("should always return ROUTER mode", () => {
    const model = new RouterModel(createModel(), createMockServer());
    expect(model.mode).toBe(Mode.ROUTER);
  });
});
