/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { IModelDecorationOptions, OverviewRulerLane, MinimapPosition } from '../../../../editor/common/model.js';
import { ISentinelService } from './sentinelService.js';
import { SentinelIssue, SentinelSeverity } from '../common/sentinelTypes.js';

export interface ISentinelDecorationService {
	readonly _serviceBrand: undefined;
}

export const ISentinelDecorationService = createDecorator<ISentinelDecorationService>('sentinelDecorationService');

const SEVERITY_RULER_COLORS: Record<SentinelSeverity, string> = {
	blocker: '#dc2626',
	critical: '#ef4444',
	warning: '#eab308',
	info: '#3b82f6',
};

class SentinelDecorationService extends Disposable implements ISentinelDecorationService {
	declare readonly _serviceBrand: undefined;

	private _decorationIds: Map<string, string[]> = new Map(); // model URI -> decoration IDs

	constructor(
		@ICodeEditorService private readonly _codeEditorService: ICodeEditorService,
		@ISentinelService private readonly _sentinelService: ISentinelService,
	) {
		super();

		// Add decorations as issues are found
		this._register(this._sentinelService.onDidFindIssue((issue) => {
			this._addDecorationForIssue(issue);
		}));

		// Clear decorations on new review
		this._register(this._sentinelService.onDidStartReview(() => {
			this._clearAllDecorations();
		}));

		// Remove decoration when issue is dismissed
		this._register(this._sentinelService.onDidDismissIssue(({ issueId }) => {
			this._removeDecorationForIssue(issueId);
		}));
	}

	private _addDecorationForIssue(issue: SentinelIssue): void {
		const editors = this._codeEditorService.listCodeEditors();

		for (const editor of editors) {
			const model = editor.getModel();
			if (!model) continue;
			if (model.uri.toString() !== issue.uri.toString()) continue;

			const decorationOptions = this._getDecorationOptions(issue);

			try {
				// Validate line bounds against actual model
				const lineCount = model.getLineCount();
				const startLine = Math.max(1, Math.min(issue.startLine, lineCount));
				const endLine = Math.max(startLine, Math.min(issue.endLine, lineCount));

				model.changeDecorations((accessor) => {
					const ids = accessor.addDecoration({
						startLineNumber: startLine,
						startColumn: 1,
						endLineNumber: endLine,
						endColumn: model.getLineMaxColumn(endLine),
					}, decorationOptions);

					const uriKey = model.uri.toString();
					const existing = this._decorationIds.get(uriKey) || [];
					existing.push(ids);
					this._decorationIds.set(uriKey, existing);
				});
			} catch {
				// Skip decorations that fail to apply (e.g., model disposed)
			}
		}
	}

	private _getDecorationOptions(issue: SentinelIssue): IModelDecorationOptions {
		const severityLabel = issue.severity.toUpperCase();
		const hoverContent = `**Sentinel ${severityLabel}**: ${issue.message}\n\n${issue.suggestion}${issue.cweId ? `\n\n*${issue.cweId}*` : ''}`;

		return {
			description: `sentinel-${issue.severity}`,
			isWholeLine: true,
			className: `sentinel-line-${issue.severity}`,
			glyphMarginClassName: `sentinel-gutter-${issue.severity}`,
			overviewRuler: {
				color: SEVERITY_RULER_COLORS[issue.severity],
				position: OverviewRulerLane.Right,
			},
			minimap: {
				color: SEVERITY_RULER_COLORS[issue.severity],
				position: MinimapPosition.Gutter,
			},
			hoverMessage: {
				value: hoverContent,
			},
			glyphMarginHoverMessage: {
				value: `Sentinel: ${issue.message}`,
			},
		};
	}

	private _removeDecorationForIssue(_issueId: string): void {
		// For simplicity, we refresh all decorations when an issue is dismissed
		this._clearAllDecorations();
		const issues = this._sentinelService.getAllIssues().filter(i => !i.dismissed);
		for (const issue of issues) {
			this._addDecorationForIssue(issue);
		}
	}

	private _clearAllDecorations(): void {
		const editors = this._codeEditorService.listCodeEditors();

		for (const editor of editors) {
			const model = editor.getModel();
			if (!model) continue;

			const uriKey = model.uri.toString();
			const ids = this._decorationIds.get(uriKey);
			if (ids && ids.length > 0) {
				model.changeDecorations((accessor) => {
					for (const id of ids) {
						accessor.removeDecoration(id);
					}
				});
			}
		}

		this._decorationIds.clear();
	}
}

registerSingleton(ISentinelDecorationService, SentinelDecorationService, InstantiationType.Delayed);
