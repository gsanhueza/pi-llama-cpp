import { describe, expect, it, vi } from "vitest";
import { Status } from "../../src/enums/status";
import { DataProperty } from "../../src/interfaces/endpoints/models";
import { Model } from "../../src/models/model";
import { createMockServer } from "../mocks/server";

const createModel = (extra: Partial<DataProperty> = {}) =>
  new Model(
    {
      id: "test-model",
      aliases: ["test-alias"],
      tags: [],
      object: "model",
      owned_by: "test",
      created: Date.now(),
      ...extra,
    },
    createMockServer({
      overrides: {
        findOverrideForModel: vi.fn(),
        getCapabilities: vi
          .fn()
          .mockResolvedValue(["text"] as ("text" | "image")[]),
        getContextSize: vi.fn().mockResolvedValue(4096),
        getModelStatus: vi.fn().mockResolvedValue(Status.LOADED),
        getMaxTokens: vi.fn().mockReturnValue(4096),
      },
    }),
  );

describe("Model (facade)", () => {
  describe("id", () => {
    it("returns the model id", () => {
      const model = createModel({ id: "my-model" });
      expect(model.id).toBe("my-model");
    });
  });

  describe("name", () => {
    it("returns the first alias", () => {
      expect(createModel().name).toBe("test-alias");
    });

    it("falls back to id when no aliases", () => {
      expect(createModel({ aliases: undefined }).name).toBe("test-model");
    });
  });

  describe("serverUrl", () => {
    it("returns the server base URL", () => {
      expect(createModel().serverUrl).toBe("http://127.0.0.1:9931");
    });
  });

  describe("serverId", () => {
    it("returns the server provider ID", () => {
      expect(createModel().serverId).toBe("llama-server=http://127.0.0.1:9931");
    });
  });

  describe("reasoning", () => {
    it("defaults to true", () => {
      const model = createModel();
      expect(model.reasoning).toBe(true);
    });

    it("uses override when set", () => {
      const server = createMockServer({
        overrides: { findOverrideForModel: () => ({ reasoning: false }) },
      });
      const model = new Model(
        {
          id: "test-model",
          aliases: ["test-alias"],
          tags: [],
          object: "model",
          owned_by: "test",
          created: Date.now(),
        },
        server,
      );
      expect(model.reasoning).toBe(false);
    });
  });

  describe("getLabel", () => {
    it("returns icon + name for loaded status", async () => {
      const model = createModel();
      const label = await model.getLabel();
      expect(label).toBe("🟢 test-alias");
    });

    it("returns correct icon for unloaded status", async () => {
      const server = createMockServer({
        overrides: { getModelStatus: () => Promise.resolve(Status.UNLOADED) },
      });
      const model = new Model(
        {
          id: "test-model",
          aliases: ["my-alias"],
          tags: [],
          object: "model",
          owned_by: "test",
          created: Date.now(),
        },
        server,
      );
      const label = await model.getLabel();
      expect(label).toBe("⚪ my-alias");
    });
  });

  describe("getInfo", () => {
    it("returns formatted model info", async () => {
      const info = await createModel().getInfo();
      expect(info).toContain("test-model");
      expect(info).toContain("test-alias");
    });
  });

  describe("load", () => {
    it("delegates to server.loadModel", async () => {
      const model = createModel();
      await model.load();
      expect(model.server.loadModel).toHaveBeenCalledWith("test-model");
    });
  });

  describe("unload", () => {
    it("delegates to server.unloadModel", async () => {
      const model = createModel();
      await model.unload();
      expect(model.server.unloadModel).toHaveBeenCalledWith("test-model");
    });
  });

  describe("samplingParams passthrough (via toProviderConfig)", () => {
    it("should pass samplingParams through to the provider config", async () => {
      const server = createMockServer({
        overrides: {
          findOverrideForModel: () => ({
            samplingParams: { temperature: 0.7, mirostat: 1 },
          }),
          getCapabilities: vi
            .fn()
            .mockResolvedValue(["text"] as ("text" | "image")[]),
          getContextSize: vi.fn().mockResolvedValue(4096),
          getModelStatus: vi.fn().mockResolvedValue(Status.LOADED),
          getMaxTokens: vi.fn().mockReturnValue(4096),
        },
      });
      const model = new Model(
        {
          id: "test-model",
          aliases: ["test-alias"],
          tags: [],
          object: "model",
          owned_by: "test",
          created: Date.now(),
        },
        server,
      );
      const config = await model.toProviderConfig();
      expect(config.samplingParams).toEqual({ temperature: 0.7, mirostat: 1 });
    });

    it("should pass samplingParamsByThinkingLevel through to the provider config", async () => {
      const server = createMockServer({
        overrides: {
          findOverrideForModel: () => ({
            samplingParamsByThinkingLevel: {
              off: { temperature: 0.3 },
              high: { temperature: 0.7 },
            },
          }),
          getCapabilities: vi
            .fn()
            .mockResolvedValue(["text"] as ("text" | "image")[]),
          getContextSize: vi.fn().mockResolvedValue(4096),
          getModelStatus: vi.fn().mockResolvedValue(Status.LOADED),
          getMaxTokens: vi.fn().mockReturnValue(4096),
        },
      });
      const model = new Model(
        {
          id: "test-model",
          aliases: ["test-alias"],
          tags: [],
          object: "model",
          owned_by: "test",
          created: Date.now(),
        },
        server,
      );
      const config = await model.toProviderConfig();
      expect(config.samplingParamsByThinkingLevel).toEqual({
        off: { temperature: 0.3 },
        high: { temperature: 0.7 },
      });
    });

    it("should leave both undefined when no override is set", async () => {
      const server = createMockServer({
        overrides: {
          findOverrideForModel: () => undefined,
          getCapabilities: vi
            .fn()
            .mockResolvedValue(["text"] as ("text" | "image")[]),
          getContextSize: vi.fn().mockResolvedValue(4096),
          getModelStatus: vi.fn().mockResolvedValue(Status.LOADED),
          getMaxTokens: vi.fn().mockReturnValue(4096),
        },
      });
      const model = new Model(
        {
          id: "test-model",
          aliases: ["test-alias"],
          tags: [],
          object: "model",
          owned_by: "test",
          created: Date.now(),
        },
        server,
      );
      const config = await model.toProviderConfig();
      expect(config.samplingParams).toBeUndefined();
      expect(config.samplingParamsByThinkingLevel).toBeUndefined();
    });
  });
});
