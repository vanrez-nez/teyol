import { clearApiProviders, registerApiProvider } from "../api-registry.js";
import type { SimpleStreamOptions, StreamFunction } from "../types.js";
import { streamOllamaChat } from "./ollama-chat.js";
import type { OpenAICompletionsOptions } from "./openai-completions.js";
import { streamOpenAICompletions, streamSimpleOpenAICompletions } from "./openai-completions.js";

export { streamOllamaChat, streamOpenAICompletions, streamSimpleOpenAICompletions };

export function registerBuiltInApiProviders(): void {
  registerApiProvider({
    api: "openai-completions",
    stream: streamOpenAICompletions as StreamFunction<"openai-completions", OpenAICompletionsOptions>,
    streamSimple: streamSimpleOpenAICompletions as StreamFunction<"openai-completions", SimpleStreamOptions>,
  });
  registerApiProvider({
    api: "ollama-chat",
    stream: streamOllamaChat as StreamFunction<"ollama-chat", SimpleStreamOptions>,
    streamSimple: streamOllamaChat as StreamFunction<"ollama-chat", SimpleStreamOptions>,
  });
}

export function resetApiProviders(): void {
  clearApiProviders();
  registerBuiltInApiProviders();
}

registerBuiltInApiProviders();
