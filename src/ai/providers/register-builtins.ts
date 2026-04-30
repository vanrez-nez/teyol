import { clearApiProviders, registerApiProvider } from "../api-registry.js";
import type { SimpleStreamOptions, StreamFunction } from "../types.js";
import type { OpenAICompletionsOptions } from "./openai-completions.js";
import { streamOpenAICompletions, streamSimpleOpenAICompletions } from "./openai-completions.js";

export { streamOpenAICompletions, streamSimpleOpenAICompletions };

export function registerBuiltInApiProviders(): void {
	registerApiProvider({
		api: "openai-completions",
		stream: streamOpenAICompletions as StreamFunction<"openai-completions", OpenAICompletionsOptions>,
		streamSimple: streamSimpleOpenAICompletions as StreamFunction<"openai-completions", SimpleStreamOptions>,
	});
}

export function resetApiProviders(): void {
	clearApiProviders();
	registerBuiltInApiProviders();
}

registerBuiltInApiProviders();
