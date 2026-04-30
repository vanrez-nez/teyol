import type { KnownProvider, ProviderMetadata } from "./types.js";

export const BUILT_IN_PROVIDER_METADATA: Record<KnownProvider, ProviderMetadata> = {
  ollama: {
    id: "ollama",
    name: "Ollama",
    defaultBaseUrl: "https://api.ollama.com/api",
    baseUrlEnvVars: ["OLLAMA_HOST"],
    auth: {
      apiKeyEnvVars: ["OLLAMA_API_KEY"],
      authRequired: true,
      localHostnames: ["localhost", "127.0.0.1", "::1"],
      localApiKey: "ollama",
    },
    discovery: { type: "ollama" },
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    auth: {
      apiKeyEnvVars: ["OPENROUTER_API_KEY"],
      authRequired: true,
    },
    discovery: { type: "openrouter" },
  },
};

export function getProviderMetadata(provider: string): ProviderMetadata | undefined {
  return BUILT_IN_PROVIDER_METADATA[provider as KnownProvider];
}

export function resolveProviderBaseUrl(provider: string, configuredBaseUrl?: string): string | undefined {
	if (configuredBaseUrl) return normalizeProviderBaseUrl(provider, configuredBaseUrl);

	const metadata = getProviderMetadata(provider);
	for (const envVar of metadata?.baseUrlEnvVars ?? []) {
		const value = process.env[envVar]?.trim();
		if (value) return normalizeProviderBaseUrl(provider, value);
	}

	return metadata?.defaultBaseUrl ? normalizeProviderBaseUrl(provider, metadata.defaultBaseUrl) : undefined;
}

function normalizeProviderBaseUrl(provider: string, baseUrl: string): string {
	const metadata = getProviderMetadata(provider);
	if (metadata?.discovery?.type !== "ollama") return baseUrl;

	const trimmed = baseUrl.replace(/\/+$/, "");
	if (trimmed.endsWith("/api")) return trimmed;
	if (trimmed.endsWith("/v1")) return `${trimmed.slice(0, -3)}/api`;
	return `${trimmed}/api`;
}

export function isLocalProviderBaseUrl(provider: string, baseUrl: string): boolean {
  const localHostnames = getProviderMetadata(provider)?.auth?.localHostnames;
  if (!localHostnames || localHostnames.length === 0) return false;

  try {
    const hostname = new URL(baseUrl).hostname;
    return localHostnames.includes(hostname);
  } catch {
    return false;
  }
}
