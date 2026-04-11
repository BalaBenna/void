/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

import { ComplexityLevel } from '../common/modelRouterTypes.js';
import { ModelSelection } from '../common/voidSettingsTypes.js';
import { IvoidSettingsService } from '../common/voidSettingsService.js';
import { ChatMessage } from '../common/chatThreadServiceTypes.js';


export interface IModelRouterService {
	readonly _serviceBrand: undefined;

	assessComplexity(messages: ChatMessage[]): ComplexityLevel;
	selectModel(messages: ChatMessage[], defaultModelSelection: ModelSelection | null): ModelSelection | null;

	/**
	 * Get the next fallback model after a failure.
	 * @param failedModel The model that just failed
	 * @param triedModels Set of model keys already tried this cycle
	 * @returns The next model to try, or null if no fallbacks remain
	 */
	getNextFallback(failedModel: ModelSelection, triedModels: Set<string>): ModelSelection | null;

	/**
	 * Record latency for a model call (success or failure).
	 */
	recordLatency(model: ModelSelection, durationMs: number, success: boolean): void;

	/**
	 * Get a unique key for a model selection (for tracking).
	 */
	modelKey(model: ModelSelection): string;
}

export const IModelRouterService = createDecorator<IModelRouterService>('voidModelRouterService');

class ModelRouterService extends Disposable implements IModelRouterService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IvoidSettingsService private readonly _settingsService: IvoidSettingsService,
	) {
		super();
	}

	modelKey(model: ModelSelection): string {
		return `${model.providerName}/${model.modelName}`
	}

	assessComplexity(messages: ChatMessage[]): ComplexityLevel {
		let score = 0

		// Find the latest user message
		const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')
		if (!lastUserMsg) return 'simple'

		const userText = lastUserMsg.content ?? ''

		// Message length > 500 chars: +1
		if (userText.length > 500) score += 1

		// References > 3 files (look for file path patterns): +1
		const fileRefPattern = /(?:[\w./\\-]+\.\w{1,6})/g
		const fileRefs = userText.match(fileRefPattern)
		if (fileRefs && fileRefs.length > 3) score += 1

		// Mentions editing/refactoring: +1
		if (/\b(edit|refactor|rewrite|restructure|rename|move|extract|inline|split)\b/i.test(userText)) score += 1

		// Mentions debugging: +1
		if (/\b(debug|fix|bug|error|crash|issue|broken|failing|trace)\b/i.test(userText)) score += 1

		// Conversation > 10 turns (user messages): +1
		const userMsgCount = messages.filter(m => m.role === 'user').length
		if (userMsgCount > 10) score += 1

		// Mentions architecture/design: +2
		if (/\b(architect|design|system|infrastructure|migration|integration|implement|feature)\b/i.test(userText)) score += 2

		// Map score to complexity level
		if (score <= 1) return 'simple'
		if (score <= 3) return 'moderate'
		return 'complex'
	}

	selectModel(messages: ChatMessage[], defaultModelSelection: ModelSelection | null): ModelSelection | null {
		const routerConfig = this._settingsService.state.globalSettings.routerConfig

		// If router is manual, just return the default
		if (routerConfig.mode === 'manual') return defaultModelSelection

		const complexity = this.assessComplexity(messages)
		const mappedModel = routerConfig.modelMapping[complexity]

		// If no model is mapped for this complexity, fall back to default
		return mappedModel ?? defaultModelSelection
	}

	getNextFallback(failedModel: ModelSelection, triedModels: Set<string>): ModelSelection | null {
		const routerConfig = this._settingsService.state.globalSettings.routerConfig
		const failedKey = this.modelKey(failedModel)

		// Add the failed model to tried set
		triedModels.add(failedKey)

		// Try fallback chain first
		for (const fallback of routerConfig.fallbackChain ?? []) {
			const key = this.modelKey(fallback)
			if (!triedModels.has(key)) {
				return fallback
			}
		}

		// Try models from the complexity mapping that haven't been tried
		for (const level of ['simple', 'moderate', 'complex'] as const) {
			const mapped = routerConfig.modelMapping[level]
			if (mapped) {
				const key = this.modelKey(mapped)
				if (!triedModels.has(key)) {
					return mapped
				}
			}
		}

		return null
	}

	recordLatency(model: ModelSelection, durationMs: number, success: boolean): void {
		const routerConfig = this._settingsService.state.globalSettings.routerConfig
		if (!routerConfig.latencyTracking) {
			routerConfig.latencyTracking = {}
		}
		const key = this.modelKey(model)
		const existing = routerConfig.latencyTracking[key]

		if (existing) {
			const newSamples = existing.samples + 1
			existing.avgMs = (existing.avgMs * existing.samples + durationMs) / newSamples
			existing.errorRate = (existing.errorRate * existing.samples + (success ? 0 : 1)) / newSamples
			existing.samples = newSamples
		} else {
			routerConfig.latencyTracking[key] = {
				avgMs: durationMs,
				errorRate: success ? 0 : 1,
				samples: 1,
			}
		}
	}
}

registerSingleton(IModelRouterService, ModelRouterService, InstantiationType.Delayed);
