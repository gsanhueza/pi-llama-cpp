import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { access, constants, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  API_KEY_PLACEHOLDER,
  DEFAULT_LLAMA_SERVER_URL,
  PROVIDER_ID,
} from "./constants";
import { AuthFile } from "./interfaces/auth";

export class ConfigResolver {
  private cachedUrl: string | undefined;

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
   * Tries all possible ways to retrieve the llama-server URL
   */
  private async resolveUrlWithFallbacks(cwd: string): Promise<string> {
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
   * Resolves the URL where llama-server is running (cached)
   */
  async resolveUrl(cwd: string): Promise<string> {
    if (this.cachedUrl) return this.cachedUrl;
    const result = await this.resolveUrlWithFallbacks(cwd);
    this.cachedUrl = result.replace(/\/+$/, "");
    return this.cachedUrl;
  }

  /**
   * Resolves the API key from Pi's settings.json
   */
  async resolveApiKey(): Promise<string> {
    const authPath = join(getAgentDir(), "auth.json");
    if (!(await this.fileExists(authPath))) return API_KEY_PLACEHOLDER;

    const cfg = await this.readConfigValue<AuthFile>(authPath, PROVIDER_ID);
    return cfg?.key ?? API_KEY_PLACEHOLDER;
  }
}
