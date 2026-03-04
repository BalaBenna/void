/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IVoidSettingsService } from '../common/voidSettingsService.js';


export interface SpeculativeResult {
	threadId: string;
	predictedResponse: string;
	confidence: number;
	contextHash: string;
	createdAt: number;
}

export interface ISpeculativeEditService {
	readonly _serviceBrand: undefined;

	precomputeNextStep(threadId: string, contextHash: string, predictedResponse: string, confidence: number): void;
	getPrecomputedResult(threadId: string, contextHash: string): SpeculativeResult | null;
	invalidate(threadId: string): void;
	isEnabled(): boolean;
}

export const ISpeculativeEditService = createDecorator<ISpeculativeEditService>('voidSpeculativeEditService');


class SpeculativeEditService extends Disposable implements ISpeculativeEditService {
	declare readonly _serviceBrand: undefined;

	private _cache: Map<string, SpeculativeResult> = new Map(); // key: `${threadId}:${contextHash}`

	constructor(
		@IVoidSettingsService private readonly _settingsService: IVoidSettingsService,
	) {
		super();
	}

	isEnabled(): boolean {
		return this._settingsService.state.globalSettings.speculativeEditsEnabled ?? false;
	}

	precomputeNextStep(threadId: string, contextHash: string, predictedResponse: string, confidence: number): void {
		if (!this.isEnabled()) return;

		const key = `${threadId}:${contextHash}`;
		this._cache.set(key, {
			threadId,
			predictedResponse,
			confidence,
			contextHash,
			createdAt: Date.now(),
		});

		// Evict old entries (keep max 20)
		if (this._cache.size > 20) {
			const oldest = Array.from(this._cache.entries())
				.sort(([, a], [, b]) => a.createdAt - b.createdAt)
				.slice(0, this._cache.size - 20);
			for (const [key] of oldest) {
				this._cache.delete(key);
			}
		}
	}

	getPrecomputedResult(threadId: string, contextHash: string): SpeculativeResult | null {
		if (!this.isEnabled()) return null;

		const key = `${threadId}:${contextHash}`;
		const result = this._cache.get(key);
		if (!result) return null;

		// Expire after 60 seconds
		if (Date.now() - result.createdAt > 60_000) {
			this._cache.delete(key);
			return null;
		}

		return result;
	}

	invalidate(threadId: string): void {
		for (const [key] of this._cache) {
			if (key.startsWith(`${threadId}:`)) {
				this._cache.delete(key);
			}
		}
	}
}

registerSingleton(ISpeculativeEditService, SpeculativeEditService, InstantiationType.Delayed);
