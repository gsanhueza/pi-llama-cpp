import type {
  ApiKeyCredential,
  AuthResult,
  ProviderAuthInteraction,
} from "@earendil-works/pi-ai";
import { CredentialResolver } from "./credentialResolver";
import { API_KEY_PLACEHOLDER } from "../constants";

/**
 * Resolves an API key from a stored credential or settings fallback.
 * Compatible with `ApiKeyAuth.resolve` input shape.
 */
export async function resolveApiKey({
  credential,
  settingsKey,
}: {
  credential?: ApiKeyCredential;
  settingsKey?: string;
}): Promise<AuthResult | undefined> {
  if (credential?.key) {
    const key = new CredentialResolver().resolve(
      credential.key,
      credential.env,
    );
    return { auth: { apiKey: key }, source: "stored credential" };
  }
  if (settingsKey && settingsKey !== API_KEY_PLACEHOLDER) {
    return { auth: { apiKey: settingsKey }, source: "settings" };
  }
  return undefined;
}

/**
 * Shared login prompt for llama.cpp provider authentication.
 */
export const createLoginPrompt = (): ((
  interaction: ProviderAuthInteraction,
) => Promise<ApiKeyCredential>) => {
  return async (interaction) => {
    interaction.signal.throwIfAborted();
    const key = await interaction.prompt({
      type: "secret",
      message: `Enter API key`,
    });
    interaction.signal.throwIfAborted();

    // Intentionally undefined for keyless servers — the resolver treats
    // "" and undefined the same, so this avoids storing a sentinel in auth.json.
    return { type: "api_key", key: key || undefined };
  };
};
