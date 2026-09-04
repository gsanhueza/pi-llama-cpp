import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Read/write access to pi's global settings.json on behalf of this extension.
 * Owns serialization of writes and atomicity; knows nothing about pi's
 * SettingsManager.
 */
export class SettingsStore {
  /** Serializes whole-file read-modify-write cycles (last write wins). */
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string = join(getAgentDir(), "settings.json"),
  ) {}

  /**
   * Reads and parses the whole settings file.
   * Missing file → `{}`. Invalid JSON / other IO errors → throws
   * (never swallow: the caller must not overwrite a file it couldn't read).
   */
  async read(): Promise<Record<string, unknown>> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf-8");
    } catch (err: any) {
      if (err?.code === "ENOENT") return {};
      throw err;
    }
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`Cannot parse ${this.path}: ${err}`);
    }
  }

  /** Serializes (2-space indent) and writes atomically via temp file + rename. */
  async write(root: Record<string, unknown>): Promise<void> {
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(root, null, 2), "utf-8");
    await rename(tmp, this.path);
  }

  /**
   * Read-modify-write of one top-level key, queued so concurrent calls
   * apply in order (last write wins) instead of racing on the whole file.
   * Rejects if read or write fails; the queue itself never gets poisoned.
   */
  updateKey(key: string, update: (current: unknown) => unknown): Promise<void> {
    const run = async () => {
      const root = await this.read();
      root[key] = update(root[key]);
      await this.write(root);
    };
    const result = this.writeQueue.then(run, run);
    this.writeQueue = result.catch(() => {});
    return result;
  }
}
