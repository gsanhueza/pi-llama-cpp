/**
 * Auth and stream plumbing for llama-server's SSE endpoint.
 *
 * llama-server validates the API key from the `Authorization` (or
 * `X-Api-Key`) header only — it no longer accepts it as a query parameter —
 * and `EventSource` cannot send custom headers. The stream is therefore
 * consumed with `fetch` and parsed manually by {@link SSEClient}.
 *
 * `buildAuthHeaders` is shared by {@link SSEClient} and
 * {@link SSEManager.probeSSE} so the two can't drift.
 */

/**
 * Builds the auth headers for a llama-server request, including the API key
 * as an `Authorization: Bearer` header when one is set.
 */
export const buildAuthHeaders = (apiKey?: string): Record<string, string> =>
  apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

/**
 * Opens the SSE stream at the given endpoint, authenticating via headers.
 *
 * @returns the response body as a stream of raw bytes
 * @throws if the request fails or the server responds with an error status
 */
export const openSSEStream = async (
  endpoint: string,
  apiKey?: string,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> => {
  const response = await fetch(endpoint, {
    method: "GET",
    headers: buildAuthHeaders(apiKey),
    signal,
  });

  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`SSE connection failed: HTTP ${response.status}`);
  }

  return response.body;
};
