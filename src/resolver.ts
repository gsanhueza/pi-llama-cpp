import { AuthStorage, getAgentDir } from "@earendil-works/pi-coding-agent";
import { access, constants, readFile } from "node:fs/promises";
import { join } from "node:path";
import { API_KEY_PLACEHOLDER, DEFAULT_LLAMA_SERVER_URL } from "./constants";

export class ConfigResolver {
  private cachedUrls: string[] = [];
  private authStorage = AuthStorage.create(join(getAgentDir(), "auth.json"));

  /**
   * Detects if a particular file is present
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Reads and parses the contents of a file as JSON
   */
  private async readJson<T>(filePath: string): Promise<T | null> {
    const raw = await readFile(filePath, "utf-8");
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  /**
   * Reads a value from a JSON config file by key
   */
  private async readConfigValue<T>(
    filePath: string,
    key: keyof T,
  ): Promise<T[keyof T] | null> {
    const cfg = await this.readJson<T>(filePath);
    return cfg?.[key] ?? null;
  }

  /**
   * Resolves the llama-server URL by searching in the global settings.json
   */
  private async resolveGlobalUrl(): Promise<string | null> {
    const globalPath = join(getAgentDir(), "settings.json");
    if (!(await this.fileExists(globalPath))) return null;
    return this.readConfigValue<Record<string, string>>(
      globalPath,
      "llamaServerUrl",
    );
  }

  /**
   * Resolves the llama-server URL by searching in the project's .pi/llama-server.json
   */
  private async resolveProjectUrl(cwd: string): Promise<string | null> {
    const projectPath = join(cwd, ".pi", "llama-server.json");
    if (!(await this.fileExists(projectPath))) return null;
    return this.readConfigValue<Record<string, string>>(projectPath, "url");
  }

  /**
   * Resolves the llama-server URL from the environment
   */
  private async resolveEnvUrl(): Promise<string | null> {
    return process.env.LLAMA_SERVER_URL ?? null;
  }

  /**
   * Tries all possible ways to retrieve the llama-server URL(s)
   */
  private async extractJoinedUrls(cwd: string): Promise<string> {
    // 1. per-project config
    let response = await this.resolveProjectUrl(cwd);
    if (response) return response;

    // 2. env
    response = await this.resolveEnvUrl();
    if (response) return response;

    // 3. global settings
    response = await this.resolveGlobalUrl();
    if (response) return response;

    // 4. default
    return DEFAULT_LLAMA_SERVER_URL;
  }

  /**
   * Resolves URLs where llama-servers are running (cached)
   */
  async resolveUrls(cwd: string): Promise<string[]> {
    if (this.cachedUrls.length > 0) return this.cachedUrls;

    const raw = await this.extractJoinedUrls(cwd);
    const urls = raw
      .split(";")
      .map((u) => u.trim())
      .filter((u) => u.length > 0)
      .map((u) => u.replace(/\/+$/, ""));

    this.cachedUrls = urls;
    return this.cachedUrls;
  }

  /**
   * Resolves API key for the provider ID using Pi's AuthStorage
   */
  async resolveApiKey(providerId: string): Promise<string> {
    this.authStorage.reload();
    const apiKey = await this.authStorage.getApiKey(providerId);

    return apiKey ?? API_KEY_PLACEHOLDER;
  }
}
