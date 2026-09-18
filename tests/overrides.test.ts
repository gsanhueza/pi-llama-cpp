import { beforeEach, describe, expect, it } from "vitest";
import { FALLBACK_CTX } from "../src/constants";
import type { LlamaServer, ModelOverride } from "../src/interfaces/settings";
import { SingleModel } from "../src/models/singleModel";
import { Server } from "../src/server";
import { OverrideEntry } from "../src/ui/editors/override/entry";
import {
  OverrideFields,
  OverrideSummary,
} from "../src/ui/editors/override/fields";
import { OverrideEntryMutator } from "../src/ui/editors/override/handlers";
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

describe("BaseModel capabilities override (via toProviderConfig)", () => {
  it("should fully replace detection without contacting the server", async () => {
    mockRpc.mockImplementation(() => {
      throw new Error("override must not trigger a fetch");
    });

    const model = createModel({
      test: { capabilities: ["text", "image"], contextSize: 8192 },
    });
    const { input } = await model.toProviderConfig();

    expect(input).toEqual(["text", "image"]);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("should not intercept detection when no override matches", async () => {
    mockDetection(8192);

    const model = createModel({ other: { capabilities: ["text"] } });
    const { input } = await model.toProviderConfig();

    expect(input).toEqual(["text"]);
    expect(mockRpc).toHaveBeenCalled();
  });
});

// ─── contextSize override ─────────────────────────────────────────────────

describe("BaseModel contextSize override (via toProviderConfig)", () => {
  it("should return the overridden context size instead of the detected one", async () => {
    mockDetection(8192);

    const model = createModel({ test: { contextSize: 32768 } });
    const { contextWindow } = await model.toProviderConfig();

    expect(contextWindow).toBe(32768);
  });

  it("should treat a stored 0 as absent and autodetect", async () => {
    mockDetection(8192);

    const model = createModel({ test: { contextSize: 0 } });
    const { contextWindow } = await model.toProviderConfig();

    expect(contextWindow).toBe(8192);
  });

  it("should autodetect when no override matches", async () => {
    mockDetection(8192);

    const model = createModel({ other: { contextSize: 32768 } });
    const { contextWindow } = await model.toProviderConfig();

    expect(contextWindow).toBe(8192);
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

// ─── OverrideEntry.summary ────────────────────────────────────────────────────

describe("OverrideSummary.of", () => {
  const summary = (override: ModelOverride): string =>
    OverrideSummary.of(override);

  it("should render every configured field", () => {
    const rendered = summary({
      cost: { input: 0.2, output: 0.6, cacheRead: 0.01 },
      capabilities: ["text", "image"],
      reasoning: false,
      contextSize: 32768,
      maxTokens: 4096,
    });

    expect(rendered).toContain("input: $0.2");
    expect(rendered).toContain("output: $0.6");
    expect(rendered).toContain("cache read: $0.01");
    expect(rendered).toContain("capabilities: text,image");
    expect(rendered).toContain("reasoning: false");
    expect(rendered).toContain("contextSize: 32768");
    expect(rendered).toContain("maxTokens: 4096");
  });

  it("should omit zero, undefined and empty fields", () => {
    const rendered = summary({
      cost: { input: 0, output: 0.6 },
      reasoning: undefined,
    });

    expect(rendered).not.toContain("input:");
    expect(rendered).toContain("output: $0.6");
    expect(rendered).not.toContain("capabilities");
    expect(rendered).not.toContain("reasoning");
    expect(rendered).not.toContain("contextSize");
    expect(rendered).not.toContain("maxTokens");
  });

  it("should render an em dash for an empty override", () => {
    expect(summary({})).toBe("—");
  });
});

// ─── override entry list helpers (overrideEntryEditor) ────────────────────

describe("override entry list helpers", () => {
  const servers = [
    { url: "http://a", overrides: { "a-1": { reasoning: false } } },
    { url: "http://b" },
  ] as LlamaServer[];

  it("addEntry should append a pattern → override entry", () => {
    const next = new OverrideEntryMutator(servers, 0).addEntry("a-2", {
      contextSize: 4096,
    });
    expect(next[0].overrides).toEqual({
      "a-1": { reasoning: false },
      "a-2": { contextSize: 4096 },
    });
  });

  it("pattern renames should replace in place without reordering", () => {
    const mutator = new OverrideEntryMutator(servers, 0);
    const result = mutator.applyFieldChange(0, "pattern", "a-renamed");
    expect(result).not.toBeNull();
    expect(Object.keys(result!.next[0].overrides!)).toEqual(["a-renamed"]);
    expect(result!.next[0].overrides!["a-renamed"]).toEqual({
      reasoning: false,
    });
    expect(result!.next[1]).toBe(servers[1]);
  });

  it("removeEntry should drop only the targeted entry", () => {
    const withTwo = new OverrideEntryMutator(servers, 0).addEntry("a-2");
    const next = new OverrideEntryMutator(withTwo, 0).removeEntry(0);
    expect(Object.keys(next[0].overrides!)).toEqual(["a-2"]);
  });

  it("CostField.validate should accept blank, non-negative numbers; reject the rest", () => {
    const cost = OverrideFields.byId("cost.input");
    expect(cost.validate("")).toBe("0");
    expect(cost.validate("  0.5 ")).toBe("0.5");
    expect(cost.validate("-1")).toBeNull();
    expect(cost.validate("abc")).toBeNull();
    expect(cost.validate("Infinity")).toBeNull();
  });

  it("CostField.apply should set a positive value, keeping other fields", () => {
    const override: ModelOverride = { cost: { input: 0.2 } };
    OverrideFields.byId("cost.output").apply(override, "0.6");
    expect(override.cost).toEqual({ input: 0.2, output: 0.6 });
  });

  it("CostField.apply should remove the field on zero", () => {
    const override: ModelOverride = { cost: { input: 0.2, output: 0.6 } };
    OverrideFields.byId("cost.input").apply(override, "0");
    expect(override.cost).toEqual({ output: 0.6 });
  });

  it("CostField.apply should drop the whole cost object when the last field is zeroed", () => {
    const single: ModelOverride = { cost: { input: 0.2 } };
    OverrideFields.byId("cost.input").apply(single, "0");
    expect(single.cost).toBeUndefined();

    const empty: ModelOverride = {};
    OverrideFields.byId("cost.input").apply(empty, "0");
    expect(empty.cost).toBeUndefined();
  });

  it("CostField.apply should treat an empty override as unset cost", () => {
    const override: ModelOverride = {};
    OverrideFields.byId("cost.input").apply(override, "0.5");
    expect(override.cost).toEqual({ input: 0.5 });
  });
});

describe("OverrideField.displayValue", () => {
  const display = (id: string, override: ModelOverride): string =>
    OverrideFields.byId(id).displayValue(new OverrideEntry("gpt-*", override));

  it("formats cost fields, defaulting to 0", () => {
    expect(display("cost.input", {})).toBe("0");
    expect(display("cost.input", { cost: { input: 0.2 } })).toBe("0.2");
    expect(display("cost.cacheWrite", {})).toBe("0");
  });

  it("formats capabilities and reasoning labels", () => {
    expect(display("capabilities", {})).toBe("text");
    expect(display("capabilities", { capabilities: ["text", "image"] })).toBe(
      "text | image",
    );
    expect(display("reasoning", {})).toBe("true");
    expect(display("reasoning", { reasoning: false })).toBe("false");
  });

  it("formats maxTokens/contextSize, defaulting to 0", () => {
    expect(display("maxTokens", {})).toBe("0");
    expect(display("maxTokens", { maxTokens: 4096 })).toBe("4096");
    expect(display("contextSize", { contextSize: 8192 })).toBe("8192");
  });

  it("returns the entry's pattern for the pattern field", () => {
    expect(
      OverrideFields.byId("pattern").displayValue(
        new OverrideEntry("gpt-*", {}),
      ),
    ).toBe("gpt-*");
  });

  it("throws for unknown fields", () => {
    expect(() => OverrideFields.byId("other")).toThrow(
      "Unknown override field: other",
    );
  });
});
