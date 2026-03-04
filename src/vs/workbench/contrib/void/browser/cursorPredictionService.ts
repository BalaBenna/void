/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { URI } from '../../../../base/common/uri.js';
import { IVoidSettingsService } from '../common/voidSettingsService.js';


export interface PredictedLocation {
	uri: URI;
	line: number;
	confidence: number;
	reason: string;
}

export interface ICursorPredictionService {
	readonly _serviceBrand: undefined;

	predictNextEditLocation(currentUri: URI, currentLine: number): PredictedLocation[];
	recordEdit(uri: URI, line: number): void;
	isEnabled(): boolean;
}

export const ICursorPredictionService = createDecorator<ICursorPredictionService>('voidCursorPredictionService');


class CursorPredictionService extends Disposable implements ICursorPredictionService {
	declare readonly _serviceBrand: undefined;

	// Track recent edit locations for pattern detection
	private _editHistory: Array<{ uri: URI; line: number; timestamp: number }> = [];
	private _maxHistorySize = 100;

	constructor(
		@IVoidSettingsService private readonly _settingsService: IVoidSettingsService,
	) {
		super();
	}

	isEnabled(): boolean {
		return this._settingsService.state.globalSettings.cursorPredictionEnabled ?? false;
	}

	recordEdit(uri: URI, line: number): void {
		if (!this.isEnabled()) return;

		this._editHistory.push({ uri, line, timestamp: Date.now() });
		if (this._editHistory.length > this._maxHistorySize) {
			this._editHistory.shift();
		}
	}

	predictNextEditLocation(currentUri: URI, currentLine: number): PredictedLocation[] {
		if (!this.isEnabled()) return [];

		const predictions: PredictedLocation[] = [];

		// Pattern 1: Nearby edits in same file (co-location heuristic)
		const sameFileEdits = this._editHistory.filter(e =>
			e.uri.toString() === currentUri.toString() && e.line !== currentLine
		);
		if (sameFileEdits.length > 0) {
			// Find most common nearby line ranges
			const lineFrequency = new Map<number, number>();
			for (const edit of sameFileEdits) {
				const bucket = Math.round(edit.line / 10) * 10;
				lineFrequency.set(bucket, (lineFrequency.get(bucket) || 0) + 1);
			}
			const sorted = Array.from(lineFrequency.entries()).sort((a, b) => b[1] - a[1]);
			for (const [line, count] of sorted.slice(0, 3)) {
				predictions.push({
					uri: currentUri,
					line,
					confidence: Math.min(count / sameFileEdits.length, 0.9),
					reason: 'co-location pattern',
				});
			}
		}

		// Pattern 2: Files frequently edited together
		const recentFiles = new Map<string, number>();
		for (const edit of this._editHistory.slice(-20)) {
			const key = edit.uri.toString();
			if (key !== currentUri.toString()) {
				recentFiles.set(key, (recentFiles.get(key) || 0) + 1);
			}
		}
		const sortedFiles = Array.from(recentFiles.entries()).sort((a, b) => b[1] - a[1]);
		for (const [uriStr, count] of sortedFiles.slice(0, 3)) {
			predictions.push({
				uri: URI.parse(uriStr),
				line: 1,
				confidence: Math.min(count / 20, 0.7),
				reason: 'co-edit pattern',
			});
		}

		return predictions.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
	}
}

registerSingleton(ICursorPredictionService, CursorPredictionService, InstantiationType.Delayed);
