import "./providers/register-builtins.js";

import { getApiProvider } from "./api-registry.js";
import { getLogger } from "#llm-agent/core/logger.js";
import type {
	Api,
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Model,
	ProviderStreamOptions,
	SimpleStreamOptions,
	StreamOptions,
} from "./types.js";

export { getEnvApiKey } from "./env-api-keys.js";

function logRequest(model: Model<Api>, context: Context, options?: StreamOptions): void {
	getLogger().debug("llm.request.context", {
		api: model.api,
		provider: model.provider,
		model: model.id,
		context,
		options: {
			temperature: options?.temperature,
			maxTokens: options?.maxTokens,
			transport: options?.transport,
			cacheRetention: options?.cacheRetention,
			sessionId: options?.sessionId,
			timeoutMs: options?.timeoutMs,
			maxRetries: options?.maxRetries,
			maxRetryDelayMs: options?.maxRetryDelayMs,
			metadata: options?.metadata,
		},
	});
}

function logFinalResponse(model: Model<Api>, stream: AssistantMessageEventStream): void {
	stream
		.result()
		.then((message) => {
			getLogger().debug("llm.response.full", {
				api: model.api,
				provider: model.provider,
				model: model.id,
				message,
			});
		})
		.catch((error) => {
			getLogger().error("llm.response.log_error", {
				api: model.api,
				provider: model.provider,
				model: model.id,
				error,
			});
		});
}

function resolveApiProvider(api: Api) {
	const provider = getApiProvider(api);
	if (!provider) {
		throw new Error(`No API provider registered for api: ${api}`);
	}
	return provider;
}

export function stream<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: ProviderStreamOptions,
): AssistantMessageEventStream {
	const provider = resolveApiProvider(model.api);
	logRequest(model, context, options as StreamOptions | undefined);
	const s = provider.stream(model, context, options as StreamOptions);
	logFinalResponse(model, s);
	return s;
}

export async function complete<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: ProviderStreamOptions,
): Promise<AssistantMessage> {
	const s = stream(model, context, options);
	return s.result();
}

export function streamSimple<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const provider = resolveApiProvider(model.api);
	logRequest(model, context, options);
	const s = provider.streamSimple(model, context, options);
	logFinalResponse(model, s);
	return s;
}

export async function completeSimple<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: SimpleStreamOptions,
): Promise<AssistantMessage> {
	const s = streamSimple(model, context, options);
	return s.result();
}
