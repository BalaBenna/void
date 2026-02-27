/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ChatMessage } from '../common/chatThreadServiceTypes.js';

const CHARS_PER_TOKEN = 4;
const WARNING_THRESHOLD = 0.85;
const SUMMARY_TURNS_KEEP = 5;
const SUMMARY_MAX_TOOL_RESULT_LENGTH = 500;

export interface ITokenBudgetService {
	readonly _serviceBrand: undefined;

	/**
	 * Estimate total token usage for a list of chat messages.
	 */
	estimateTokenUsage(messages: ChatMessage[]): number;

	/**
	 * Check if the message list is approaching the context window limit.
	 */
	isApproachingLimit(messages: ChatMessage[], contextWindowSize: number): boolean;

	/**
	 * Compact messages by summarizing old tool results and long assistant messages.
	 * Returns the compacted messages array (does NOT modify the original).
	 */
	compactMessages(messages: ChatMessage[], contextWindowSize: number): ChatMessage[];
}

export const ITokenBudgetService = createDecorator<ITokenBudgetService>('voidTokenBudgetService');

class TokenBudgetService extends Disposable implements ITokenBudgetService {
	declare readonly _serviceBrand: undefined;

	estimateTokenUsage(messages: ChatMessage[]): number {
		let totalChars = 0;
		for (const m of messages) {
			if (m.role === 'checkpoint') continue;
			if (m.role === 'user') totalChars += m.content.length;
			else if (m.role === 'assistant') totalChars += m.displayContent.length;
			else if (m.role === 'tool') totalChars += m.content.length;
			else if (m.role === 'plan') totalChars += m.content.length;
		}
		return Math.ceil(totalChars / CHARS_PER_TOKEN);
	}

	isApproachingLimit(messages: ChatMessage[], contextWindowSize: number): boolean {
		const usage = this.estimateTokenUsage(messages);
		return usage >= contextWindowSize * WARNING_THRESHOLD;
	}

	compactMessages(messages: ChatMessage[], contextWindowSize: number): ChatMessage[] {
		if (!this.isApproachingLimit(messages, contextWindowSize)) {
			return messages; // no compaction needed
		}

		// Count non-checkpoint messages to find which ones are "old"
		const nonCheckpointMessages: { msg: ChatMessage; idx: number }[] = [];
		for (let i = 0; i < messages.length; i++) {
			if (messages[i].role !== 'checkpoint') {
				nonCheckpointMessages.push({ msg: messages[i], idx: i });
			}
		}

		// Keep the last SUMMARY_TURNS_KEEP non-checkpoint messages untouched
		const keepFromIdx = nonCheckpointMessages.length - SUMMARY_TURNS_KEEP;
		const protectedIdxes = new Set<number>();
		for (let i = Math.max(0, keepFromIdx); i < nonCheckpointMessages.length; i++) {
			protectedIdxes.add(nonCheckpointMessages[i].idx);
		}

		// Also protect all user messages and the first system/user message
		for (let i = 0; i < messages.length; i++) {
			if (messages[i].role === 'user') protectedIdxes.add(i);
		}

		const compacted = messages.map((m, i) => {
			if (protectedIdxes.has(i)) return m;
			if (m.role === 'checkpoint') return m;

			// Summarize long tool results
			if (m.role === 'tool' && m.content.length > SUMMARY_MAX_TOOL_RESULT_LENGTH) {
				const brief = m.content.substring(0, SUMMARY_MAX_TOOL_RESULT_LENGTH);
				return {
					...m,
					content: `[Summarized: ${brief}...]`,
				};
			}

			// Summarize long assistant messages
			if (m.role === 'assistant' && m.displayContent.length > SUMMARY_MAX_TOOL_RESULT_LENGTH) {
				const brief = m.displayContent.substring(0, SUMMARY_MAX_TOOL_RESULT_LENGTH);
				return {
					...m,
					displayContent: `[Summarized: ${brief}...]`,
				};
			}

			return m;
		});

		return compacted;
	}
}

registerSingleton(ITokenBudgetService, TokenBudgetService, InstantiationType.Eager);
