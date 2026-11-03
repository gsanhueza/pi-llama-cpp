import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { PROVIDER_NAME } from "../constants";
import { join } from "node:path";

/**
 * Wraps one or more lines in the standard warning header.
 */
export const warnUser = (...lines: string[]): string =>
  ["[pi-llama-cpp]", ...lines].join("\n");

/**
 * Extracts a human-readable message from an unknown error value.
 *
 * @param err The error value to extract a message from.
 */
export const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

// -- Warning messages --------------------------------------------------------

/**
 * Generates a warning message for servers that require an API key.
 * Centralized so both the runtime manager and the editor wizard use
 * identical wording.
 *
 * @param baseUrl The server URL that requires authentication.
 * @param providerId The provider ID for the login command.
 */
export const authRequiredMessage = (
  baseUrl: string,
  providerId: string,
): string =>
  warnUser(
    `Server at '${baseUrl}' requires a valid API key.`,
    `Configure the key via '/login ${providerId}' or in '${join(
      getAgentDir(),
      "auth.json",
    )}'.`,
  );

/**
 * Generates a warning message for a server that timed out during initialization.
 *
 * @param baseUrl The server URL that timed out.
 * @param timeout The timeout in milliseconds.
 */
export const timeoutMessage = (baseUrl: string, timeout: number): string =>
  warnUser(
    `Server initialization for '${baseUrl}' took more than ${timeout} ms, so it has been skipped.`,
    `Run '/models' to retry without timeout and see all models.`,
  );

/**
 * Generates a warning message when a session changes during a model load.
 *
 * @param modelName The name of the model that was loading.
 */
export const sessionSwitchWarning = (modelName: string): string =>
  warnUser(
    `Session change detected while '${modelName}' was still loading.`,
    "Model load will continue in the background, but UI might not update.",
    "",
    "Verify that your new model is loaded, or use /models to re-select it afterwards.",
  );

/**
 * Generates a warning message when a duplicate server URL is found at initialization.
 *
 * @param url The duplicate URL.
 */
export const duplicateUrlWarning = (url: string): string =>
  warnUser(`Duplicate server URL '${url}' — skipping`);

/**
 * Generates a warning when a subcommand requires TUI mode.
 *
 * @param label The label of the subcommand (e.g. "settings", "servers").
 */
export const tuiRequired = (label: string): string =>
  warnUser(`/models ${label} requires an interactive session (TUI)`);

/**
 * Generates a warning message for a provider that failed to initialize.
 *
 * @param url The provider URL.
 */
export const providerUnreachable = (url: string): string =>
  warnUser(`Server at '${url}' is unreachable.`);

// -- Info messages -----------------------------------------------------------

/**
 * Generates an info message for ctx.ui.notify with "info" level.
 * No prefix — these are status updates, not warnings.
 */
export const logInfo = (...lines: string[]): string => lines.join("\n");

/**
 * Generates an info message when a model starts unloading.
 *
 * @param name The name of the model being unloaded.
 */
export const unloadingModel = (name: string): string =>
  logInfo(`Unloading ${name}...`);

/**
 * Generates an info message when a model has finished unloading.
 *
 * @param name The name of the unloaded model.
 */
export const unloadedModel = (name: string): string =>
  logInfo(`Unloaded ${name}`);

/**
 * Generates an info message when a model starts loading or during polling.
 *
 * @param name The name of the model being loaded.
 * @param elapsed Seconds elapsed since the load started.
 */
export const loadingModelPolling = (name: string, elapsed: number): string =>
  logInfo(`Loading ${name}... (${elapsed}s elapsed)`);

/**
 * Generates an info message for model load progress.
 *
 * @param name The name of the model being loaded.
 * @param percentage The loading progress percentage.
 * @param stage Optional stage description (e.g. "loading", "ready").
 */
export const loadingModelProgress = (
  name: string,
  percentage: number,
  stage?: string,
): string =>
  logInfo(`Loading ${name}... [${percentage}%${stage ? ` (${stage})` : ""}]`);

/**
 * Generates an info message when a model is ready.
 *
 * @param name The name of the ready model.
 */
export const modelReady = (name: string): string =>
  logInfo(`Model ${name} ready`);

/**
 * Generates an info message when all provider models start unloading.
 */
export const unloadingAllModels = (): string =>
  logInfo(`Unloading ${PROVIDER_NAME} models...`);

/**
 * Generates an info message when all provider models have finished unloading.
 */
export const unloadedAllModels = (): string =>
  logInfo(`Unloaded all ${PROVIDER_NAME} models`);

/**
 * Generates an info message when all provider models start reloading.
 */
export const reloadingAllModels = (): string =>
  logInfo(`Reloading currently-loaded ${PROVIDER_NAME} models...`);

/**
 * Generates an info message when all provider models have finished reloading.
 */
export const reloadedAllModels = (): string =>
  logInfo(`Reloaded all previously-loaded ${PROVIDER_NAME} models`);

/**
 * Generates an info message when there are no loaded or sleeping models to reload.
 */
export const noModelsToReload = (): string =>
  logInfo(`No loaded or sleeping models to reload`);

/**
 * Generates an info message when there are no reasoning models with active completions.
 */
export const skipThinkingUnavailable = (): string =>
  logInfo(`No reasoning models with active completions`);

/**
 * Generates an info message when a reasoning end is forced.
 */
export const skipThinkingSuccess = (): string =>
  logInfo(`Skipped thinking process`);

/**
 * Generates an info message when a reasoning end fails.
 */
export const skipThinkingFail = (message: string): string =>
  logInfo(`Thinking couldn't be skipped: ${message}`);
