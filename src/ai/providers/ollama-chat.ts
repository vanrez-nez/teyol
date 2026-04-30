import type {
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  ImageContent,
  Message,
  Model,
  SimpleStreamOptions,
  StopReason,
  StreamFunction,
  TextContent,
  ThinkingContent,
  Tool,
  ToolCall,
  ToolResultMessage,
} from "../types.js";
import { AssistantMessageEventStream as EventStream } from "../utils/event-stream.js";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.js";

type OllamaMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
};

type OllamaTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
};

export const streamOllamaChat: StreamFunction<"ollama-chat", SimpleStreamOptions> = (
  model: Model<"ollama-chat">,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
  const stream = new EventStream();

  void (async () => {
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    };

    try {
      const response = await fetch(joinUrl(model.baseUrl, "chat"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(options?.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
          ...model.headers,
          ...options?.headers,
        },
        body: JSON.stringify({
          model: model.id,
          messages: convertMessages(context),
          stream: true,
          ...(options?.maxTokens ? { options: { num_predict: options.maxTokens } } : {}),
          ...(context.tools && context.tools.length > 0 ? { tools: convertTools(context.tools) } : {}),
        }),
        signal: options?.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Ollama request failed: ${response.status} ${await response.text()}`);
      }

      stream.push({ type: "start", partial: output });

      let currentText: TextContent | null = null;
      let currentThinking: ThinkingContent | null = null;

      for await (const line of readJsonLines(response.body)) {
        if (options?.signal?.aborted) throw new Error("Request was aborted");
        if (line.error) throw new Error(String(line.error));

        const message = line.message as
          | {
              content?: string;
              thinking?: string;
              tool_calls?: Array<{ function?: { name?: string; arguments?: unknown } }>;
            }
          | undefined;

        if (message?.thinking) {
          if (!currentThinking) {
            currentThinking = { type: "thinking", thinking: "" };
            output.content.push(currentThinking);
            stream.push({
              type: "thinking_start",
              contentIndex: output.content.indexOf(currentThinking),
              partial: output,
            });
          }
          currentThinking.thinking += message.thinking;
          stream.push({
            type: "thinking_delta",
            contentIndex: output.content.indexOf(currentThinking),
            delta: message.thinking,
            partial: output,
          });
        }

        if (message?.content) {
          if (!currentText) {
            currentText = { type: "text", text: "" };
            output.content.push(currentText);
            stream.push({ type: "text_start", contentIndex: output.content.indexOf(currentText), partial: output });
          }
          currentText.text += message.content;
          stream.push({
            type: "text_delta",
            contentIndex: output.content.indexOf(currentText),
            delta: message.content,
            partial: output,
          });
        }

        if (message?.tool_calls) {
          for (const rawToolCall of message.tool_calls) {
            const fn = rawToolCall.function;
            if (!fn?.name) continue;
            const toolCall: ToolCall = {
              type: "toolCall",
              id: `${fn.name}-${output.content.length}`,
              name: fn.name,
              arguments:
                typeof fn.arguments === "object" && fn.arguments !== null
                  ? (fn.arguments as Record<string, unknown>)
                  : {},
            };
            output.content.push(toolCall);
            stream.push({
              type: "toolcall_start",
              contentIndex: output.content.indexOf(toolCall),
              partial: output,
            });
            stream.push({
              type: "toolcall_end",
              contentIndex: output.content.indexOf(toolCall),
              toolCall,
              partial: output,
            });
          }
        }

        if (line.done) {
          output.usage.input = Number(line.prompt_eval_count ?? 0);
          output.usage.output = Number(line.eval_count ?? 0);
          output.usage.totalTokens = output.usage.input + output.usage.output;
          output.stopReason = mapDoneReason(line.done_reason);
        }
      }

      if (currentThinking) {
        stream.push({
          type: "thinking_end",
          contentIndex: output.content.indexOf(currentThinking),
          content: currentThinking.thinking,
          partial: output,
        });
      }
      if (currentText) {
        stream.push({
          type: "text_end",
          contentIndex: output.content.indexOf(currentText),
          content: currentText.text,
          partial: output,
        });
      }

      stream.push({ type: "done", reason: output.stopReason as "stop" | "length" | "toolUse", message: output });
      stream.end();
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
};

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

async function* readJsonLines(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, any>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) yield JSON.parse(line);
      newlineIndex = buffer.indexOf("\n");
    }
  }

  const tail = buffer.trim();
  if (tail) yield JSON.parse(tail);
}

function convertMessages(context: Context): OllamaMessage[] {
  const messages: OllamaMessage[] = [];
  if (context.systemPrompt) {
    messages.push({ role: "system", content: sanitizeSurrogates(context.systemPrompt) });
  }

  for (const message of context.messages) {
    const converted = convertMessage(message);
    if (converted) messages.push(converted);
  }

  return messages;
}

function convertMessage(message: Message): OllamaMessage | undefined {
  if (message.role === "user") {
    if (typeof message.content === "string") {
      return { role: "user", content: sanitizeSurrogates(message.content) };
    }
    return contentBlocksToMessage("user", message.content);
  }

  if (message.role === "assistant") {
    const text = message.content
      .filter((block): block is TextContent | ThinkingContent => block.type === "text" || block.type === "thinking")
      .map((block) => (block.type === "text" ? block.text : block.thinking))
      .join("\n");
    const toolCalls = message.content.filter((block): block is ToolCall => block.type === "toolCall");
    if (!text && toolCalls.length === 0) return undefined;
    return {
      role: "assistant",
      content: sanitizeSurrogates(text),
      ...(toolCalls.length > 0
        ? {
            tool_calls: toolCalls.map((toolCall) => ({
              function: { name: toolCall.name, arguments: toolCall.arguments },
            })),
          }
        : {}),
    };
  }

  return toolResultToMessage(message);
}

function contentBlocksToMessage(role: "user", content: (TextContent | ImageContent)[]): OllamaMessage | undefined {
  const text = content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  const images = content.filter((block): block is ImageContent => block.type === "image").map((block) => block.data);
  if (!text && images.length === 0) return undefined;
  return {
    role,
    content: sanitizeSurrogates(text || "(see attached image)"),
    ...(images.length > 0 ? { images } : {}),
  };
}

function toolResultToMessage(message: ToolResultMessage): OllamaMessage {
  const text = message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  return { role: "tool", content: sanitizeSurrogates(text || "(tool completed)") };
}

function convertTools(tools: Tool[]): OllamaTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function mapDoneReason(doneReason: unknown): StopReason {
  return doneReason === "length" ? "length" : "stop";
}
