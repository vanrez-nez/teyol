import { BUILT_IN_PROVIDER_METADATA } from "#ai/index.js";

export const BUILT_IN_PROVIDER_DISPLAY_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(BUILT_IN_PROVIDER_METADATA).map(([id, metadata]) => [id, metadata.name]),
);
