import type { ServerFactory } from "../../src/servers/serverFactory";
import { ServerStatus } from "../../src/enums/serverStatus";
import type { Model } from "../../src/models/model";
import { createMockServer } from "./server";

/**
 * Creates a default `ServerFactory` that produces unseeded mock servers.
 */
export const createServerFactory = (): ServerFactory => ({
  create: async (resolver) => ({
    server: createMockServer({ resolver }),
    status: ServerStatus.READY,
  }),
});

/**
 * Creates a `ServerFactory` that seeds models and optional disconnect stubs
 * into each constructed server, keyed by baseUrl.
 */
export const createSeededServerFactory = (
  models: Record<string, Model[]>,
  disconnects?: Record<string, () => void>,
): ServerFactory => ({
  create: async (resolver, options) => {
    const serverOpts: Parameters<typeof createMockServer>[0] = {
      resolver,
      options: {
        baseUrl: options.baseUrl,
        customId: options.customId,
        customName: options.customName,
        overrides: options.overrides,
      },
      models: models[options.baseUrl],
    };
    if (disconnects?.[options.baseUrl]) {
      serverOpts.sse = { disconnect: disconnects[options.baseUrl] };
    }
    const server = createMockServer(serverOpts);
    return { server, status: ServerStatus.READY };
  },
});
