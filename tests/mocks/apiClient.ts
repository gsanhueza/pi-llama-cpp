import { ApiClient } from "../../src/api/client";
import { API_KEY_PLACEHOLDER } from "../../src/constants";
import { PollingIntervalSettingsItem } from "../../src/settings/items/pollingInterval";

/**
 * Build a no-op ApiClient for tests that never hit the network.
 *
 * @param baseUrl — Base URL for the API client (used for key resolution).
 * @param fetchFn — Optional custom fetch (default: a no-op that throws).
 */
export const createMockApiClient = (
  baseUrl: string,
  fetchFn?: typeof globalThis.fetch,
): ApiClient =>
  new ApiClient(
    baseUrl,
    () => API_KEY_PLACEHOLDER,
    async () => PollingIntervalSettingsItem.defaultValue,
    fetchFn,
  );
