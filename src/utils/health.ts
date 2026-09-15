import { ServerStatus } from "../enums/serverStatus";

/**
 * Probes a llama-server's `/health` endpoint and classifies the outcome.
 *
 * The single source of truth for health classification — both
 * `Server.isReady` and the UI health indicators delegate here.
 *
 * - HTTP success with `{ status: "ok" }`  → `READY`
 * - The request is still in flight when the deadline passes
 *   (`AbortSignal.timeout` aborts it)     → `TIMEOUT`
 * - Anything else (network error, non-JSON or non-ok payload)
 *                                         → `UNREACHABLE`
 *
 * The HTTP status code itself is not inspected: a llama-server answers
 * `/health` with the payload's `status` field, and both classification
 * branches key off it (matching the behavior of `ApiClient.get`, which
 * also ignores status codes and parses the body).
 *
 * @param url The bare origin of the llama-server (the endpoint is
 *   `<url>/health`, without the `/v1` prefix)
 * @param timeout Maximum time (ms) to wait for the health check
 * @param apiKey Optional API key, sent as a Bearer token — servers
 *   behind an API-key gate would otherwise report UNREACHABLE
 * @returns The classified server status
 */
export const checkServerHealth = async (
  url: string,
  timeout: number,
  apiKey?: string,
): Promise<ServerStatus> => {
  try {
    const response = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(timeout),
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    });
    const data = (await response.json()) as { status?: string };
    return data.status === "ok" ? ServerStatus.READY : ServerStatus.UNREACHABLE;
  } catch (error) {
    // `AbortSignal.timeout` rejects `fetch` with a `TimeoutError`
    // DOMException (some runtimes surface it as `AbortError` with a
    // timeout message).
    const isTimeout =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    return isTimeout ? ServerStatus.TIMEOUT : ServerStatus.UNREACHABLE;
  }
};
