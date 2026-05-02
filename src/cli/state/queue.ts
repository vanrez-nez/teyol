import { createEvent, createStore } from "effector";

export type QueueMode = "steer" | "followUp";

export interface QueuedMessage {
	text: string;
	mode: QueueMode;
}

export interface QueueGroups {
	steering: string[];
	followUp: string[];
}

export function createQueueState() {
	const queueCompactionMessage = createEvent<QueuedMessage>();
	const clearCompactionQueue = createEvent<void>();
	const restoreCompactionQueue = createEvent<QueuedMessage[]>();

	const $compactionQueuedMessages = createStore<QueuedMessage[]>([])
		.on(queueCompactionMessage, (messages, message) => [...messages, message])
		.on(clearCompactionQueue, () => [])
		.on(restoreCompactionQueue, (_, messages) => [...messages]);

	const getAllQueuedMessages = (sessionQueues: QueueGroups): QueueGroups => {
		const compactionMessages = $compactionQueuedMessages.getState();
		return {
			steering: [
				...sessionQueues.steering,
				...compactionMessages.filter((message) => message.mode === "steer").map((message) => message.text),
			],
			followUp: [
				...sessionQueues.followUp,
				...compactionMessages.filter((message) => message.mode === "followUp").map((message) => message.text),
			],
		};
	};

	const takeCompactionQueue = (): QueuedMessage[] => {
		const messages = [...$compactionQueuedMessages.getState()];
		clearCompactionQueue();
		return messages;
	};

	const clearAllQueues = (sessionQueues: QueueGroups): QueueGroups => {
		const allQueues = getAllQueuedMessages(sessionQueues);
		clearCompactionQueue();
		return allQueues;
	};

	return {
		$compactionQueuedMessages,
		queueCompactionMessage,
		clearCompactionQueue,
		restoreCompactionQueue,
		getAllQueuedMessages,
		takeCompactionQueue,
		clearAllQueues,
	};
}
