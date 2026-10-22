import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { LLAMA_SERVER_URL } from "../constants";

/**
 * Shared user-facing wording for the UI editors. Centralizing these keeps
 * every concept named consistently across row labels, dialog titles,
 * prompts, descriptions and hints — e.g. `Pattern` always carries the
 * `'startsWith'` matching note, so the field is never ambiguous.
 */

/** Definition of one editable field, as shown to the user. */
export interface Field {
  /** Term for the field, used as `SettingItem` label and composed into
   * dialog titles (`Edit ${field.label}`). */
  label: string;
  /** Parenthetical appended to the field's dialog prompt. */
  note?: string;
  /** Row description in the containing `SettingsList`. */
  description: string;
  /** Example value shown dim as `e.g., <placeholder>` in input dialogs. */
  placeholder?: string;
}

/** Every editable field, as shown to the user. The single source of
 * truth for a field's label, row description, dialog prompt and
 * placeholder.
 */
export const FIELDS = {
  pattern: {
    label: "Pattern",
    note: "(using 'startsWith')",
    description: "Model id prefix (longest match wins - uses 'startsWith')",
    placeholder: "qwen-3",
  },
  serverUrl: {
    label: "Server URL",
    description: "Server URL (http://host or http://host:port)",
    placeholder: LLAMA_SERVER_URL,
  },
  providerId: {
    label: "Provider ID",
    note: "(empty uses auto-detected)",
    description: "Provider ID (empty uses auto-detected)",
    placeholder: "llama-local",
  },
  displayName: {
    label: "Display name",
    description: "Custom display name",
    placeholder: "Local workstation",
  },
  inputCost: {
    label: "Input cost",
    note: "(per 1M tokens)",
    description: "Token cost per 1M input tokens",
    placeholder: "0.15",
  },
  outputCost: {
    label: "Output cost",
    note: "(per 1M tokens)",
    description: "Token cost per 1M output tokens",
    placeholder: "0.6",
  },
  cacheReadCost: {
    label: "Cache read cost",
    note: "(per 1M tokens)",
    description: "Token cost per 1M cached tokens (read)",
    placeholder: "0.01",
  },
  cacheWriteCost: {
    label: "Cache write cost",
    note: "(per 1M tokens)",
    description: "Token cost per 1M cached tokens (write)",
    placeholder: "0.02",
  },
  capabilities: {
    label: "Capabilities",
    description: "Model capabilities (replaces detected)",
  },
  reasoning: {
    label: "Reasoning",
    description: "Is this a reasoning model? (true = default)",
  },
  contextSize: {
    label: "Context size",
    note: "(0 = autodetect)",
    description: "Override detected context size (0 = autodetect)",
    placeholder: "32768",
  },
  maxTokens: {
    label: "Max tokens",
    note: "(0 = autodetect)",
    description: "Override max generation tokens (0 = autodetect)",
    placeholder: "4096",
  },
  samplingParams: {
    label: "Sampling params",
    description: "Temperature, top_k, top_p, min_p, penalties, seed",
  },
  samplingParamsTemperature: {
    label: "Temperature",
    description: "Sampling temperature",
    placeholder: "—",
  },
  samplingParamsTopK: {
    label: "Top-k",
    description: "Top-k sampling (integer)",
    placeholder: "—",
  },
  samplingParamsTopP: {
    label: "Top-p",
    description: "Top-p sampling",
    placeholder: "—",
  },
  samplingParamsMinP: {
    label: "Min-p",
    description: "Min-p sampling",
    placeholder: "—",
  },
  samplingParamsRepeatPenalty: {
    label: "Repeat penalty",
    description: "Repeat penalty",
    placeholder: "—",
  },
  samplingParamsPresencePenalty: {
    label: "Presence penalty",
    description: "Presence penalty",
    placeholder: "—",
  },
  samplingParamsFrequencyPenalty: {
    label: "Frequency penalty",
    description: "Frequency penalty",
    placeholder: "—",
  },
  samplingParamsSeed: {
    label: "Seed",
    description: "Random seed for reproducible sampling (-1 = random)",
    placeholder: "—",
  },
} as const satisfies Record<string, Field>;

/** Dialog prompt for a field: the `label` plus its parenthetical `note`
 * (or an overriding note, e.g. the add-server wizard's "(optional)"). */
export class FieldMessages {
  static of(field: Field, note = field.note): string {
    return note ? `${field.label} ${note}` : field.label;
  }
}

/**
 * Dialog titles. `edit` composes the shared `Edit <term>` title so the
 * phrasing stays uniform across all field submenus; `addServerStep`
 * formats the add-server wizard's step counter.
 */
export const TITLES = {
  edit: (term: string) => `Edit ${term}`,
  addServerStep: (step: 1 | 2 | 3) => `Add server · ${step}/3`,
  addOverride: "Add override",
  deleteServer: "Delete server",
  deleteOverride: "Delete override",
} as const;

/** Keybinding hint lines shared by the editors' lists */
export const HINTS = {
  /** Row description for an editable server in the `/models servers` list */
  serverRow:
    "Enter: edit URL/id/name · (a) add server · (d) delete · Esc: done",
  /** Row description for an override entry in the per-server entry list */
  overrideEntryRow:
    "Enter: edit fields · (a) add override · (d) delete · Esc back",
  /** Hint line when the servers list is empty (no rows → no description) */
  emptyServers: "  (a) add server · Esc done",
  /** Hint line when the override entry list is empty */
  emptyOverrideEntries: "  (a) add override · Esc back",
  /** Row description for a server in the overrides editor */
  overrideServerRow: "Enter: edit this server's override entries",
} as const;

/**
 * Wraps one or more lines in the standard warning header.
 */
export const warnUser = (...lines: string[]): string =>
  ["[pi-llama-cpp]", ...lines].join("\n");

/**
 * Generates a warning message for servers that require an API key.
 * Centralized so both the runtime manager and the editor wizard use
 * identical wording.
 */
export const authRequiredMessage = (
  baseUrl: string,
  providerId: string,
): string =>
  warnUser(
    `Server at '${baseUrl}' requires a valid API key.`,
    `Configure the key via '/login ${providerId}' or in '${getAgentDir()}/auth.json'.`,
  );

/**
 * Generates a warning message for a server that timed out during initialization.
 */
export const timeoutMessage = (baseUrl: string, timeout: number): string =>
  warnUser(
    `Server initialization for '${baseUrl}' took more than ${timeout} ms, so it has been skipped.`,
    `Run '/models' to retry without timeout and see all models.`,
  );

/**
 * Generates a warning message for a server that is unreachable.
 */
export const unreachableMessage = (baseUrl: string): string =>
  warnUser(
    `Server at '${baseUrl}' is unreachable.`,
    `Check the URL and try again. Run '/models' to retry.`,
  );

/**
 * Generates a warning message when a session changes during a model load.
 */
export const sessionSwitchWarning = (modelName: string): string =>
  warnUser(
    `Session change detected while model '${modelName}' was still loading.`,
    "Model load will continue in the background, but UI might not update.",
    "",
    "Verify that your new model is loaded, or use /models to re-select it afterwards.",
  );
