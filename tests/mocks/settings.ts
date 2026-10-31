import { vi } from "vitest";
import { API_KEY_PLACEHOLDER, THINKING_BUDGETS } from "../../src/constants";
import { AutoloadOnMessageSettingsItem } from "../../src/settings/items/autoloadOnMessage";
import { PollingIntervalSettingsItem } from "../../src/settings/items/pollingInterval";
import { PollingTimeoutSettingsItem } from "../../src/settings/items/pollingTimeout";
import { ReactToModelSelectSettingsItem } from "../../src/settings/items/reactToModelSelect";
import { ServerTimeoutSettingsItem } from "../../src/settings/items/serverTimeout";
import { ShowServerUrlsSettingsItem } from "../../src/settings/items/showServerUrls";
import { SortBySettingsItem } from "../../src/settings/items/sortBy";
import type { ServerSettingsResolver } from "../../src/interfaces/server";
import type { SettingsService } from "../../src/settings/settings";

/**
 * Hand-made stub of `SettingsService` for constructor injection —
 * replaces whole-module `vi.mock` blocks and per-case `vi.spyOn` on the
 * real singleton. Defaults give every consumer-used member a benign value;
 * a case that cares passes just that member as an override. The single
 * `as unknown as` cast lives here so test bodies stay cast-free.
 */
export const makeSettingsStub = (
  overrides: Partial<SettingsService> = {},
): SettingsService =>
  ({
    getLlamaSettings: vi.fn(async () => ({})),
    getLlamaServers: vi.fn(async () => []),
    resolveTimeouts: vi.fn(async () => ({
      pollingInterval: PollingIntervalSettingsItem.defaultValue,
      pollingTimeout: PollingTimeoutSettingsItem.defaultValue,
      serverTimeout: ServerTimeoutSettingsItem.defaultValue,
    })),
    resolveServerTimeout: vi.fn(
      async () => ServerTimeoutSettingsItem.defaultValue,
    ),
    resolvePollingInterval: vi.fn(async () => 10),
    resolvePollingTimeout: vi.fn(async () => 5000),
    resolveEnableSSE: vi.fn(async () => true),
    resolveServerConfigs: vi.fn(async () => []),
    resolveSortBy: vi.fn(async () => SortBySettingsItem.defaultValue),
    resolveShowServerUrls: vi.fn(
      async () => ShowServerUrlsSettingsItem.defaultValue,
    ),
    resolveApiKey: vi.fn(() => API_KEY_PLACEHOLDER),
    resolveHeaders: vi.fn(() => ({})),
    resolveReactToModelSelect: vi.fn(
      async () => ReactToModelSelectSettingsItem.defaultValue,
    ),
    resolveAutoloadOnMessage: vi.fn(
      async () => AutoloadOnMessageSettingsItem.defaultValue,
    ),
    resolveThinkingLevel: vi.fn(() => undefined),
    resolveThinkingBudgets: vi.fn(() => ({ ...THINKING_BUDGETS })),
    takeWarnings: vi.fn((): string[] => []),
    setLlamaSettings: vi.fn(() => Promise.resolve()),
    ...overrides,
  }) as unknown as SettingsService;

/**
 * Stub of the {@link ServerSettingsResolver} interface `Server`,
 * `SSEManager`, and `Model` depend on. Defaults give every method a
 * benign value; a case that cares passes just that method as an override.
 */
export const makeResolverStub = (
  overrides: Partial<ServerSettingsResolver> = {},
): ServerSettingsResolver =>
  ({
    resolveServerTimeout: vi.fn(
      async () => ServerTimeoutSettingsItem.defaultValue,
    ),
    resolvePollingInterval: vi.fn(async () => 10),
    resolvePollingTimeout: vi.fn(async () => 5000),
    resolveApiKey: vi.fn(() => API_KEY_PLACEHOLDER),
    resolveHeaders: vi.fn(() => ({})),
    resolveEnableSSE: vi.fn(async () => true),
    ...overrides,
  }) as ServerSettingsResolver;
