/**
 * A description of a server in the "llamaSettings" key
 */
interface LlamaServer {
  url: string;
  id?: string;
  name?: string;
}

/**
 * The main configuration interface for this extension
 *
 * E.g.:
 *
 * {
 *   "servers": [{
 *     "id": "server-a",
 *     "name": "Server A",
 *     "url": "http://localhost:8080"
 *   }],
 *   "reactToModelSelect": true
 *   "autoloadOnMessage": false
 * }
}
 */
export interface LlamaSettings {
  servers: LlamaServer[];
  reactToModelSelect?: boolean;
  autoloadOnMessage?: boolean;
}
