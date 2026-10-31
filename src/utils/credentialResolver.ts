import { type ApiKeyCredential } from "@earendil-works/pi-ai";
import { readStoredCredential } from "@earendil-works/pi-coding-agent";
import { API_KEY_PLACEHOLDER } from "../constants";
import { ShellResolver } from "./shellResolver";

/**
 * Resolves credential API keys from `auth.json` entries.
 *
 * Delegates format parsing to a {@link ShellResolver} and wraps
 * results with the `API_KEY_PLACEHOLDER` sentinel on failure.
 *
 * @param shell - The shell resolver to delegate parsing to.
 */
export class CredentialResolver {
  constructor(private readonly shell: ShellResolver) {}

  /**
   * Resolves the API key for a provider ID from Pi's credential store.
   *
   * Reads the stored credential, then delegates to {@link resolve} for
   * key format handling. Falls back to the placeholder when no credential
   * is stored or it has no key.
   *
   * @param providerId - The provider ID the credential is stored under.
   * @returns The resolved API key, or the placeholder on failure.
   */
  resolveForProvider(providerId: string): string {
    const credential = readStoredCredential(providerId) as ApiKeyCredential;
    if (!credential?.key) return API_KEY_PLACEHOLDER;

    return this.resolve(credential.key, credential.env);
  }

  /**
   * Reads the `env` object stored with a provider's credential in
   * `auth.json`. `$VAR` references resolve against it before `process.env`,
   * so secrets can live in the credential store instead of the settings.
   *
   * @param providerId - The provider ID the credential is stored under.
   * @returns The stored `env` map, or `undefined` when there is none.
   */
  readEnv(providerId: string): Record<string, string> | undefined {
    const credential = readStoredCredential(providerId) as
      | ApiKeyCredential
      | undefined;
    return credential?.env;
  }

  /**
   * Resolves a credential key to its actual value.
   *
   * @param key - The raw key string from the credential.
   * @param env - Optional env map from `credential.env`. Checked before `process.env`.
   * @returns The resolved value, or the placeholder on failure.
   */
  resolve(key: string, env?: Record<string, string>): string {
    return this.shell.resolve(key, env) ?? API_KEY_PLACEHOLDER;
  }
}
