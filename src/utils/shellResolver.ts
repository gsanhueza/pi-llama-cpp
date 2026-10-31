import { execSync } from "node:child_process";

/**
 * Resolves shell-prefixed values: `!command`, `$VAR`, `${VAR}`, `$$`/`$!`.
 *
 * Pure parsing — no auth.json, no API key placeholders. Returns
 * `undefined` when a value can't be resolved (e.g. missing env var).
 *
 * Callers decide what to do with `undefined`.
 */
export class ShellResolver {
  /**
   * Resolves a raw value string to its actual value.
   *
   * @param raw - The raw value string (may start with `!`, `$`, `$$`, `$!`).
   * @param env - Optional env map checked before `process.env`.
   * @returns The resolved value, or `undefined` if it can't be resolved.
   */
  resolve(raw: string, env?: Record<string, string>): string | undefined {
    if (!raw) return undefined;

    if (raw.startsWith("!")) return this.resolveShellCommand(raw);
    if (raw.startsWith("$$")) return this.resolveEscape(raw);
    if (raw.startsWith("$!")) return this.resolveEscape(raw);
    if (!raw.startsWith("$")) return raw;

    return this.resolveEnvRef(raw, env);
  }

  /**
   * Executes a shell command and returns its trimmed stdout.
   *
   * @param command - The full string starting with `!`.
   * @returns The trimmed stdout, or `undefined` on failure.
   */
  private resolveShellCommand(command: string): string | undefined {
    try {
      return (
        execSync(command.slice(1), {
          encoding: "utf-8",
          timeout: 10_000,
        }).trim() || undefined
      );
    } catch {
      return undefined;
    }
  }

  /**
   * Resolves escape sequences: `$$` → literal `$`, `$!` → literal `!`.
   *
   * @param key - A string starting with `$$` or `$!`.
   * @returns The literal character followed by the rest of the string.
   */
  private resolveEscape(key: string): string {
    return key.charAt(1) + key.slice(2);
  }

  /**
   * Resolves `$VAR` or `${VAR}` syntax to the corresponding environment value.
   *
   * @param key - The string containing a `$VAR` or `${VAR}` reference.
   * @param env - Optional env map (checked before `process.env`).
   * @returns The resolved value, or `undefined` if not found or invalid syntax.
   */
  private resolveEnvRef(
    key: string,
    env?: Record<string, string>,
  ): string | undefined {
    const match =
      key.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/) ??
      key.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/);
    const varName = match?.[1];
    if (!varName) return undefined;
    return env?.[varName] ?? process.env[varName];
  }
}
