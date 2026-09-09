import { LLAMA_SERVER_URL, PROVIDER_PREFIX } from "../constants";
import type { LlamaServer } from "../interfaces/settings";
import { normalizeUrl } from "../utils/urls";
import {
  createPersister,
  ListEditorBase,
  type EditorField,
  type ListEditorOptions,
} from "./baseEditor";

/**
 * Validates and normalizes a user-entered server URL: trims whitespace and
 * strips trailing slashes (shared core in `utils/urls` — the same treatment
 * the settings parser applies), then rejects empty strings, semicolons (the
 * settings parser splits on them — use separate entries) and values without
 * an http(s) scheme.
 *
 * @returns The normalized URL, or `null` when the input is invalid
 */
export const normalizeServerUrl = (raw: string): string | null => {
  const url = normalizeUrl(raw);
  if (url.length === 0 || url.includes(";") || !/^https?:\/\//i.test(url)) {
    return null;
  }
  return url;
};

/**
 * Returns a new list with a `{ url }` entry appended. Immutable.
 */
export const addServer = (
  servers: LlamaServer[],
  url: string,
): LlamaServer[] => [...servers, { url }];

/**
 * Fields of a `LlamaServer` editable through the inline Input.
 */
type EditableField = "url" | "id" | "name";

/**
 * Returns a new list with `field` at `index` set to `value` (trimmed).
 * An empty `value` removes the `id`/`name` key instead of storing an empty
 * string, so the settings JSON stays clean. Only the edited field is
 * touched — the other override is preserved. Immutable.
 */
export const updateServerField = (
  servers: LlamaServer[],
  index: number,
  field: EditableField,
  value: string,
): LlamaServer[] => {
  const v = value.trim();
  return servers.map((server, i) => {
    if (i !== index) return server;
    if (field === "url") return { ...server, url: v }; // validated upstream
    if (field === "id") {
      const { id, ...rest } = server; // drop the old id override…
      return v.length === 0 ? rest : { ...rest, id: v }; // …clear or replace
    }
    const { name, ...rest } = server; // drop the old name override…
    return v.length === 0 ? rest : { ...rest, name: v }; // …clear or replace
  });
};

/**
 * Formats the dim `(...)` suffix shown after a server's URL:
 * `(<id> - <name>)`, with the auto-detected URL-based id used when no
 * custom id override exists (mirrors `Server.providerId`). Returns the
 * empty string when there is nothing to show.
 */
export const formatServerSuffix = (server: LlamaServer): string => {
  if (!server.id && !server.name) return "";
  const id = server.id ?? `${PROVIDER_PREFIX}=${server.url}`;
  return server.name ? `(${id} - ${server.name})` : `(${server.id})`;
};

/**
 * Returns a new list without the entry at `index`. Immutable.
 */
export const removeServer = (
  servers: LlamaServer[],
  index: number,
): LlamaServer[] => servers.filter((_, i) => i !== index);

/** The url field (Enter/e): validated and normalized before saving */
const URL_FIELD: EditorField<LlamaServer> = {
  keys: ["e"],
  label: "URL",
  getValue: (server) => server.url,
  validate: (raw) => normalizeServerUrl(raw),
  invalidError: () => "Invalid URL — use http://host:port (one URL per entry)",
  apply: (servers, index, value) =>
    updateServerField(servers, index, "url", value),
};

/** The id override (i): free-form; empty clears the override */
const ID_FIELD: EditorField<LlamaServer> = {
  keys: ["i"],
  label: "ID",
  getValue: (server) => server.id ?? "",
  validate: (raw) => raw,
  apply: (servers, index, value) =>
    updateServerField(servers, index, "id", value),
};

/** The name override (n): free-form; empty clears the override */
const NAME_FIELD: EditorField<LlamaServer> = {
  keys: ["n"],
  label: "Name",
  getValue: (server) => server.name ?? "",
  validate: (raw) => raw,
  apply: (servers, index, value) =>
    updateServerField(servers, index, "name", value),
};

export interface ServerListEditorOptions extends ListEditorOptions {
  /** Snapshot of the merged `llamaSettings.servers` to edit */
  servers: LlamaServer[];
  /** Persists a new server list; a rejection keeps the current list */
  persist: (next: LlamaServer[]) => Promise<void>;
}

/**
 * Editor for `llamaSettings.servers`, shown by `/models servers`.
 *
 * A {@link ListEditorBase} with one row per server: Enter/e edits the
 * URL, i the id override, n the name override, a adds a new entry
 * (inline Input), d asks for confirmation before deleting, Esc closes.
 *
 * Each mutation is persisted immediately through `persist()` (which maps to
 * `LlamaSettingsManager.setLlamaSetting()`); the in-memory list only updates
 * after the write succeeds, so a failed write leaves everything unchanged
 * and the editor open.
 */
export class ServerListEditor extends ListEditorBase<LlamaServer> {
  private readonly envOverride: boolean;

  constructor(options: ServerListEditorOptions) {
    super(options, createPersister(options, options.servers));
    this.envOverride = Boolean(process.env.LLAMA_SERVER_URL);
  }

  protected title(): string {
    return "Manage llama.cpp servers";
  }

  protected primaryField(): EditorField<LlamaServer> {
    return URL_FIELD;
  }

  protected fields(): EditorField<LlamaServer>[] {
    return [URL_FIELD, ID_FIELD, NAME_FIELD];
  }

  protected getItems(): LlamaServer[] {
    return this.store.items;
  }

  protected itemLabel(server: LlamaServer): string {
    return server.url;
  }

  protected itemSuffix(server: LlamaServer): string {
    return formatServerSuffix(server);
  }

  protected emptyStateLines(): string[] {
    return [
      "No servers configured — press a to add one.",
      `With an empty list the default ${LLAMA_SERVER_URL} is used.`,
    ];
  }

  protected listHint(): string {
    return "Enter/e url · i id · n name · a add · d delete · Esc done";
  }

  protected describeForConfirm(index: number): string {
    return this.getItems()[index]?.url ?? "";
  }

  protected editBuild(
    field: EditorField<LlamaServer>,
    index: number,
    value: string,
    isAdd: boolean,
  ): (servers: LlamaServer[]) => LlamaServer[] {
    return (servers) =>
      isAdd ? addServer(servers, value) : field.apply(servers, index, value);
  }

  protected deleteBuild(
    index: number,
  ): (servers: LlamaServer[]) => LlamaServer[] {
    return (servers) => removeServer(servers, index);
  }

  protected footerNotes(): string[] {
    return this.envOverride
      ? ["LLAMA_SERVER_URL env var overrides these servers."]
      : [];
  }
}
