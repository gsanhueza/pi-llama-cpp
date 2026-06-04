import { HealthEndpoint } from "../interfaces/endpoints/health";
import { ModelsEndpoint } from "../interfaces/endpoints/models";
import { BaseModel } from "../models/baseModel";
import { RouterModel } from "../models/routerModel";
import { SingleModel } from "../models/singleModel";
import { resolveApiKey, resolveUrl } from "./resolver";

/**
 * Detects if the server is ready
 * @returns True if it's ready to work
 */
export const isServerReady = async (): Promise<boolean> => {
  try {
    const { status } = await rpc<HealthEndpoint>("/health");
    return status === "ok";
  } catch {
    return false;
  }
};

/**
 * Makes an HTTP request to the llama-server and returns the parsed JSON response
 *
 * @param endpoint The endpoint path to fetch (e.g. "/health")
 * @param body The optional request body for POST requests
 * @returns The parsed JSON response from the server
 */
const doFetch = async (
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<any> => {
  const base = await resolveUrl(process.cwd());
  const url = `${base}${endpoint}`;

  const data = {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  };

  const apiKey = await resolveApiKey();
  const res = await fetch(url, {
    ...data,
    headers: {
      ...data.headers,
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
  });

  return res.json();
};

/**
 * Compatibility shim for servers that don't implement llama.cpp's /models
 * router endpoint (e.g. ik_llama.cpp), which only expose OpenAI /v1/models.
 * Synthesizes the router-shaped response the rest of the extension expects,
 * pulling context size + vision modality from /props.
 */
const synthesizeModelsEndpoint = async (): Promise<ModelsEndpoint> => {
  const v1 = await doFetch("/v1/models");
  const props = await doFetch("/props").catch(() => ({}));
  const vision = !!props?.modalities?.vision;
  const nCtx = props?.n_ctx;

  const data = (v1?.data ?? []).map((m: any) => ({
    id: m.id,
    object: m.object ?? "model",
    created: m.created ?? 0,
    owned_by: m.owned_by ?? "llamacpp",
    tags: [],
    aliases: [String(m.id).split("/").pop() ?? m.id],
    status: { value: "loaded", args: [], preset: "" },
    architecture: {
      input_modalities: vision ? ["text", "image"] : ["text"],
      output_modalities: ["text"],
    },
    meta: {
      ...(m.meta ?? {}),
      n_ctx: nCtx ?? m.meta?.n_ctx_train ?? m.max_model_len,
    },
  }));

  return {
    object: v1?.object ?? "list",
    models: data.map(() => ({ capabilities: vision ? ["multimodal"] : [] })),
    data,
  } as unknown as ModelsEndpoint;
};

export const rpc = async <T>(
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<T> => {
  const response = await doFetch(endpoint, body);

  // Fall back to /v1/models when the server lacks the /models router endpoint.
  if (endpoint === "/models" && !Array.isArray(response?.data)) {
    return (await synthesizeModelsEndpoint()) as T;
  }

  return response as T;
};

/**
 * Retrieves a list of available models from llama-server
 * @param base Base URL to use
 * @returns The list of models
 */
export const listModels = async (): Promise<BaseModel[]> => {
  const { models, data } = await rpc<ModelsEndpoint>("/models");

  if (models) {
    return data.map((m) => new SingleModel(m));
  }

  const response = data
    .map((m) => new RouterModel(m))
    .sort((a, b) => (a.id > b.id ? 1 : a.id === b.id ? 0 : -1));

  return response;
};
