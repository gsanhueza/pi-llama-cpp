import { beforeEach, describe, expect, it } from "vitest";
import { FALLBACK_CTX } from "../src/constants";
import type { LlamaServer, ModelOverride } from "../src/interfaces/settings";
import { SingleModel } from "../src/models/singleModel";
import { Server } from "../src/server";
import {
  addOverrideEntry,
  applyCostFieldValue,
  formatOverrideSummary,
  parseCostValue,
  removeOverrideEntry,
  updateOverrideEntry,
} from "../src/ui/overrideEntryEditor";
import { overrideFieldValue } from "../src/ui/overrideSettingsList";
import { createMockServer, mockRpc } from "./mocks";

beforeEach(() => {
  mockRpc.mockReset();
});

const createModel = (overrides?: Record<string, ModelOverride>): SingleModel =>
  new SingleModel(
    {
      id: "test",
      tags: [],
      object: "model",
      owned_by: "test",
      created: Date.now(),
    },
    createMockServer({ overrides }),
  );

/** Standard server responses: /props for capabilities, /v1/models for n_ctx */
const mockDetection = (nCtx: number | undefined) =>
  mockRpc.mockImplementation((endpoint: string) => {
    if (endpoint.startsWith("/props")) {
      return Promise.resolve({ modalities: { vision: false } });
    }
    return Promise.resolve({
      data: [{ id: "test", meta: nCtx === undefined ? {} : { n_ctx: nCtx } }],
    });
  });

// ─── Pattern matching (Server.findOverrideForModel) ───────────────────────

describe("Server.findOverrideForModel", () => {
  const makeServer = (overrides: Record<string, ModelOverride>): Server =>
    createMockServer({ overrides });

  it("should match a model by id prefix", () => {
    const server = makeServer({ lla: { reasoning: false } });
    expect(server.findOverrideForModel("llama-3")).toEqual({
      reasoning: false,
    });
  });

  it("should return undefined when no pattern matches", () => {
    const server = makeServer({ qwen: { reasoning: false } });
    expect(server.findOverrideForModel("llama-3")).toBeUndefined();
  });

  it("should prefer the longest (most specific) matching pattern", () => {
    const server = makeServer({
      llama: { reasoning: false },
      "llama-3-8b": { reasoning: true, contextSize: 128 },
    });
    expect(server.findOverrideForModel("llama-3-8b")).toEqual({
      reasoning: true,
      contextSize: 128,
    });
    expect(server.findOverrideForModel("llama-3-70b")).toEqual({
      reasoning: false,
    });
  });

  it("should ignore empty patterns", () => {
    const server = makeServer({ "": { reasoning: false } });
    expect(server.findOverrideForModel("llama-3")).toBeUndefined();
  });
});

// ─── reasoning override ────────────────────────────────────────────────────

describe("BaseModel reasoning override", () => {
  it("should default to true when no override matches", () => {
    expect(createModel().reasoning).toBe(true);
  });

  it("should let the override win over the default", () => {
    const model = createModel({ test: { reasoning: false } });
    expect(model.reasoning).toBe(false);
  });
});

// ─── capabilities override ────────────────────────────────────────────────

describe("BaseModel capabilities override", () => {
  it("should fully replace detection without contacting the server", async () => {
    mockRpc.mockImplementation(() => {
      throw new Error("override must not trigger a fetch");
    });

    const model = createModel({ test: { capabilities: ["text", "image"] } });
    const capabilities = await model.getCapabilities();

    expect(capabilities).toEqual(["text", "image"]);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("should not intercept detection when no override matches", async () => {
    mockDetection(8192);

    const model = createModel({ other: { capabilities: ["text"] } });
    const capabilities = await model.getCapabilities();

    expect(capabilities).toEqual(["text"]);
    expect(mockRpc).toHaveBeenCalled();
  });
});

// ─── contextSize override ─────────────────────────────────────────────────

describe("BaseModel.getContextSize with contextSize override", () => {
  it("should return the overridden context size instead of the detected one", async () => {
    mockDetection(8192);

    const model = createModel({ test: { contextSize: 32768 } });
    const ctxSize = await model.getContextSize();

    expect(ctxSize).toBe(32768);
  });

  it("should treat a stored 0 as absent and autodetect", async () => {
    mockDetection(8192);

    const model = createModel({ test: { contextSize: 0 } });
    const ctxSize = await model.getContextSize();

    expect(ctxSize).toBe(8192);
  });

  it("should autodetect when no override matches", async () => {
    mockDetection(8192);

    const model = createModel({ other: { contextSize: 32768 } });
    const ctxSize = await model.getContextSize();

    expect(ctxSize).toBe(8192);
  });
});

// ─── toProviderConfig (cost, maxTokens, compat, precedence) ───────────────

describe("toProviderConfig overrides", () => {
  it("should merge a partial cost override with zero defaults", async () => {
    mockDetection(8192);

    const model = createModel({ test: { cost: { input: 0.2 } } });
    const config = await model.toProviderConfig();

    expect(config.cost).toEqual({
      input: 0.2,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });

  it("should default every cost field to zero without an override", async () => {
    mockDetection(8192);

    const model = createModel();
    const config = await model.toProviderConfig();

    expect(config.cost).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });

  it("should pass a compat override through to the provider config", async () => {
    mockDetection(8192);

    const compat = {
      supportsStore: false,
      maxTokensField: "max_tokens",
    } as const;
    const model = createModel({ test: { compat } });
    const config = await model.toProviderConfig();

    expect(config.compat).toEqual(compat);
  });

  it("should leave compat undefined without an override", async () => {
    mockDetection(8192);

    const model = createModel();
    const config = await model.toProviderConfig();

    expect(config.compat).toBeUndefined();
  });

  it("should use the overridden context size for contextWindow and as the maxTokens fallback", async () => {
    mockDetection(8192);

    const model = createModel({ test: { contextSize: 32768 } });
    const config = await model.toProviderConfig();

    expect(config.contextWindow).toBe(32768);
    expect(config.maxTokens).toBe(32768);
  });

  it("should prefer an explicit maxTokens override over the contextSize override", async () => {
    mockDetection(8192);

    const model = createModel({
      test: { contextSize: 32768, maxTokens: 4096 },
    });
    const config = await model.toProviderConfig();

    expect(config.contextWindow).toBe(32768);
    expect(config.maxTokens).toBe(4096);
  });

  it("should use the detected context size when no override matches", async () => {
    mockDetection(8192);

    const model = createModel();
    const config = await model.toProviderConfig();

    expect(config.contextWindow).toBe(8192);
    expect(config.maxTokens).toBe(8192);
  });

  it("should fall back to FALLBACK_CTX when the model is missing from detection", async () => {
    mockRpc.mockImplementation((endpoint: string) => {
      if (endpoint.startsWith("/props")) {
        return Promise.resolve({ modalities: { vision: false } });
      }
      // /v1/models: no entry for this model → getContextSize throws → fallback
      return Promise.resolve({ data: [] });
    });

    const model = createModel();
    const config = await model.toProviderConfig();

    expect(config.contextWindow).toBe(FALLBACK_CTX);
    expect(config.maxTokens).toBe(FALLBACK_CTX);
  });
});

// ─── formatOverrideSummary ────────────────────────────────────────────────

describe("formatOverrideSummary", () => {
  it("should render every configured field", () => {
    const summary = formatOverrideSummary({
      cost: { input: 0.2, output: 0.6, cacheRead: 0.01 },
      capabilities: ["text", "image"],
      reasoning: false,
      contextSize: 32768,
      maxTokens: 4096,
    });

    expect(summary).toContain("input: $0.2");
    expect(summary).toContain("output: $0.6");
    expect(summary).toContain("cache read: $0.01");
    expect(summary).toContain("capabilities: text,image");
    expect(summary).toContain("reasoning: false");
    expect(summary).toContain("contextSize: 32768");
    expect(summary).toContain("maxTokens: 4096");
  });

  it("should omit zero, undefined and empty fields", () => {
    const summary = formatOverrideSummary({
      cost: { input: 0, output: 0.6 },
      reasoning: undefined,
    });

    expect(summary).not.toContain("input:");
    expect(summary).toContain("output: $0.6");
    expect(summary).not.toContain("capabilities");
    expect(summary).not.toContain("reasoning");
    expect(summary).not.toContain("contextSize");
    expect(summary).not.toContain("maxTokens");
  });

  it("should render an em dash for an empty override", () => {
    expect(formatOverrideSummary({})).toBe("—");
  });
});

// ─── override entry list helpers (overrideEntryEditor) ────────────────────

describe("override entry list helpers", () => {
  const servers = [
    { url: "http://a", overrides: { "a-1": { reasoning: false } } },
    { url: "http://b" },
  ] as LlamaServer[];

  it("addOverrideEntry should append a pattern → override entry", () => {
    const next = addOverrideEntry(servers, 0, "a-2", { contextSize: 4096 });
    expect(next[0].overrides).toEqual({
      "a-1": { reasoning: false },
      "a-2": { contextSize: 4096 },
    });
  });

  it("updateOverrideEntry should replace in place without reordering", () => {
    const next = updateOverrideEntry(servers, 0, 0, "a-renamed", {
      reasoning: true,
    });
    expect(Object.keys(next[0].overrides!)).toEqual(["a-renamed"]);
    expect(next[0].overrides!["a-renamed"]).toEqual({ reasoning: true });
    expect(next[1]).toBe(servers[1]);
  });

  it("removeOverrideEntry should drop only the targeted entry", () => {
    const withTwo = addOverrideEntry(servers, 0, "a-2", {});
    const next = removeOverrideEntry(withTwo, 0, 0);
    expect(Object.keys(next[0].overrides!)).toEqual(["a-2"]);
  });

  it("parseCostValue should accept blank, non-negative numbers; reject the rest", () => {
    expect(parseCostValue("")).toBe(0);
    expect(parseCostValue("  0.5 ")).toBe(0.5);
    expect(parseCostValue("-1")).toBeNull();
    expect(parseCostValue("abc")).toBeNull();
    expect(parseCostValue("Infinity")).toBeNull();
  });

  it("applyCostFieldValue should set a positive value, keeping other fields", () => {
    const next = applyCostFieldValue({ input: 0.2 }, "output", 0.6);
    expect(next).toEqual({ input: 0.2, output: 0.6 });
  });

  it("applyCostFieldValue should remove the field on zero", () => {
    const next = applyCostFieldValue({ input: 0.2, output: 0.6 }, "input", 0);
    expect(next).toEqual({ output: 0.6 });
  });

  it("applyCostFieldValue should return undefined when the last field is zeroed", () => {
    expect(applyCostFieldValue({ input: 0.2 }, "input", 0)).toBeUndefined();
    expect(applyCostFieldValue(undefined, "input", 0)).toBeUndefined();
  });

  it("applyCostFieldValue should treat an empty override as unset cost", () => {
    expect(applyCostFieldValue(undefined, "input", 0.5)).toEqual({
      input: 0.5,
    });
  });
});

describe("overrideFieldValue", () => {
  it("formats cost fields, defaulting to 0", () => {
    expect(overrideFieldValue("cost.input", {})).toBe("0");
    expect(overrideFieldValue("cost.input", { cost: { input: 0.2 } })).toBe(
      "0.2",
    );
    expect(overrideFieldValue("cost.cacheWrite", {})).toBe("0");
  });

  it("formats capabilities and reasoning labels", () => {
    expect(overrideFieldValue("capabilities", {})).toBe("text");
    expect(
      overrideFieldValue("capabilities", { capabilities: ["text", "image"] }),
    ).toBe("text | image");
    expect(overrideFieldValue("reasoning", {})).toBe("true");
    expect(overrideFieldValue("reasoning", { reasoning: false })).toBe("false");
  });

  it("formats maxTokens/contextSize, defaulting to 0", () => {
    expect(overrideFieldValue("maxTokens", {})).toBe("0");
    expect(overrideFieldValue("maxTokens", { maxTokens: 4096 })).toBe("4096");
    expect(overrideFieldValue("contextSize", { contextSize: 8192 })).toBe(
      "8192",
    );
  });

  it("returns an empty label for unknown fields", () => {
    expect(overrideFieldValue("other", {})).toBe("");
  });
});
