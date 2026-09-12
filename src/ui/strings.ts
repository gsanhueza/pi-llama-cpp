import { LLAMA_SERVER_URL } from "../constants";

/**
 * Shared user-facing wording for the UI editors. Centralizing these keeps
 * every concept named consistently across row labels, dialog titles,
 * prompts, descriptions and hints — e.g. `Pattern` always carries the
 * `'startsWith'` matching note, so the field is never ambiguous.
 */

/**
 * Field terms, as shown to the user. Used as `SettingItem` labels and
 * composed into dialog titles/prompts (`Edit ${TERMS.x}`).
 */
export const TERMS = {
  pattern: "Pattern",
  serverUrl: "Server URL",
  providerId: "Provider ID",
  displayName: "Display name",
  inputCost: "Input cost",
  outputCost: "Output cost",
  cacheReadCost: "Cache read cost",
  cacheWriteCost: "Cache write cost",
  capabilities: "Capabilities",
  reasoning: "Reasoning",
  contextSize: "Context size",
  maxTokens: "Max tokens",
} as const;

/** Matching semantics of the override `Pattern` (the word alone can be
 * interpreted in multiple ways — regex, glob, exact id…). Appended to
 * pattern prompts and hints.
 */
export const PATTERN_MATCH_NOTE = "(using 'startsWith')";

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

/** Message strings for input dialogs, composed with `TERMS` to keep
 * phrasing uniform across all field submenus.
 */
export const MESSAGES = {
  pattern: (term: string) => `${term} ${PATTERN_MATCH_NOTE}`,
  inputCost: (term: string) => `${term} (per 1M tokens)`,
  outputCost: (term: string) => `${term} (per 1M tokens)`,
  cacheReadCost: (term: string) => `${term} (per 1M tokens)`,
  cacheWriteCost: (term: string) => `${term} (per 1M tokens)`,
  maxTokens: (term: string) => `${term} (0 = context size)`,
  contextSize: (term: string) => `${term} (0 = autodetect)`,
} as const;

/** Example values shown dim as `e.g., <placeholder>` in input dialogs */
export const PLACEHOLDERS = {
  serverUrl: LLAMA_SERVER_URL,
  providerId: "llama-local",
  displayName: "Local workstation",
  pattern: "qwen-3",
  inputCost: "0.15",
  outputCost: "0.6",
  cacheReadCost: "0.01",
  cacheWriteCost: "0.02",
  maxTokens: "4096",
  contextSize: "32768",
} as const;

/** Keybinding hint lines shared by the editors' lists */
export const HINTS = {
  /** Row description for an editable server in the `/models servers` list */
  serverRow: "Enter: edit URL/id/name · a add · d delete · Esc: done",
  /** Row description for an override entry in the per-server entry list */
  overrideEntryRow: "Enter: edit fields · a add · d delete · Esc back",
  /** Hint line when the servers list is empty (no rows → no description) */
  emptyServers: "  a add · Esc done",
  /** Hint line when the override entry list is empty */
  emptyOverrideEntries: "  a add · Esc back",
} as const;
