import { beforeEach, describe, expect, it } from "vitest";
import { ServerStatus } from "../src/enums/serverStatus";
import { Server } from "../src/server";
import { createMockServer, mockRpc } from "./mocks";

beforeEach(() => {
  mockRpc.mockClear();
});

describe("Server providerId", () => {
  it("should generate a unique provider ID from baseUrl", () => {
    const server = new Server("http://127.0.0.1:8080");
    expect(server.providerId).toBe("llama-server=http://127.0.0.1:8080");
  });

  it("should generate different IDs for different baseUrls", () => {
    const server1 = new Server("http://127.0.0.1:8080");
    const server2 = new Server("http://127.0.0.1:8081");
    expect(server1.providerId).not.toBe(server2.providerId);
  });
});

describe("Server providerName", () => {
  it("should generate a human-readable provider name", () => {
    const server = new Server("http://127.0.0.1:8080");
    expect(server.providerName).toBe("Llama.cpp (http://127.0.0.1:8080)");
  });
});

describe("Server fetchModels", () => {
  it("should call the /models endpoint", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ id: "model1" }],
      models: [{ id: "model1" }],
      object: "list",
    });

    const server = createMockServer();
    const result = await server.fetchModels();

    expect(result).toEqual({
      data: [{ id: "model1" }],
      models: [{ id: "model1" }],
      object: "list",
    });
    expect(mockRpc).toHaveBeenCalledWith("/v1/models");
  });
});

describe("Server fetchModelProps", () => {
  it("should call the /props endpoint with model id", async () => {
    mockRpc.mockResolvedValueOnce({
      is_sleeping: false,
      default_generation_settings: {},
      total_slots: 1,
      model_alias: "test",
      model_path: "/path/to/model.gguf",
      modalities: { vision: false, audio: false },
      media_marker: "",
      endpoint_slots: false,
      endpoint_props: false,
      endpoint_metrics: false,
      webui: false,
      webui_settings: {},
      chat_template: "",
      chat_template_caps: {},
      bos_token: "",
      eos_token: "",
      build_info: "",
    });

    const server = createMockServer();
    const result = await server.fetchModelProps("test-model");

    expect(result.is_sleeping).toBe(false);
    expect(mockRpc).toHaveBeenCalledWith(
      "/props?model=test-model&autoload=false",
    );
  });
});

describe("Server fetchServerHealth", () => {
  it("should call the /health endpoint", async () => {
    mockRpc.mockResolvedValueOnce({ status: "ok" });

    const server = createMockServer();
    const result = await server.fetchServerHealth();

    expect(result).toEqual({ status: "ok" });
    expect(mockRpc).toHaveBeenCalledWith("/health");
  });
});

describe("Server fetchServerProps", () => {
  it("should call the /props endpoint without model", async () => {
    mockRpc.mockResolvedValueOnce({
      role: "router",
      default_generation_settings: {},
      total_slots: 2,
      model_alias: "",
      model_path: "",
      modalities: { vision: false, audio: false },
      media_marker: "",
      endpoint_slots: false,
      endpoint_props: false,
      endpoint_metrics: false,
      webui: false,
      webui_settings: {},
      chat_template: "",
      chat_template_caps: {},
      bos_token: "",
      eos_token: "",
      build_info: "",
      is_sleeping: false,
    });

    const server = createMockServer();
    const result = await server.fetchServerProps();

    expect(result.role).toBe("router");
    expect(mockRpc).toHaveBeenCalledWith("/props?autoload=false");
  });
});

describe("Server postRequest", () => {
  it("should call /models/load with model in body", async () => {
    mockRpc.mockResolvedValueOnce({});

    const server = createMockServer();
    await server.postRequest("load", "test-model");

    expect(mockRpc).toHaveBeenCalledWith("/models/load", {
      model: "test-model",
    });
  });

  it("should call /models/unload with model in body", async () => {
    mockRpc.mockResolvedValueOnce({});

    const server = createMockServer();
    await server.postRequest("unload", "test-model");

    expect(mockRpc).toHaveBeenCalledWith("/models/unload", {
      model: "test-model",
    });
  });
});

describe("Server isReady", () => {
  it("should return READY when health status is ok", async () => {
    mockRpc.mockResolvedValueOnce({ status: "ok" });

    const server = createMockServer();
    const status = await server.isReady(1000);

    expect(status).toBe(ServerStatus.READY);
  });

  it("should return UNREACHABLE when health check fails", async () => {
    mockRpc.mockRejectedValueOnce(new Error("connection refused"));

    const server = createMockServer();
    const status = await server.isReady(1000);

    expect(status).toBe(ServerStatus.UNREACHABLE);
  });

  it("should return UNREACHABLE when health status is not ok", async () => {
    mockRpc.mockResolvedValueOnce({ status: "error" });

    const server = createMockServer();
    const status = await server.isReady(1000);

    expect(status).toBe(ServerStatus.UNREACHABLE);
  });
});
