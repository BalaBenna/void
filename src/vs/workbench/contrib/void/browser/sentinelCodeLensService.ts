/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { ICommandService, CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { CodeLens } from '../../../../editor/common/languages.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { Range } from '../../../../editor/common/core/range.js';
import { ISentinelService } from './sentinelService.js';

export interface ISentinelCodeLensService {
	readonly _serviceBrand: undefined;
}

export const ISentinelCodeLensService = createDecorator<ISentinelCodeLensService>('sentinelCodeLensService');

const SENTINEL_FIX_COMMAND = 'void.sentinel.fixIssue';
const SENTINEL_DISMISS_COMMAND = 'void.sentinel.dismissIssue';
const SENTINEL_EXPLAIN_COMMAND = 'void.sentinel.explainIssue';

class SentinelCodeLensService extends Disposable implements ISentinelCodeLensService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
		@ICodeEditorService private readonly _codeEditorService: ICodeEditorService,
		@ICommandService private readonly _commandService: ICommandService,
		@ISentinelService private readonly _sentinelService: ISentinelService,
	) {
		super();

		this._registerCommands();

		// Register CodeLens provider for all file types
		this._register(this._languageFeaturesService.codeLensProvider.register('*', {
			provideCodeLenses: (model: ITextModel, _token: CancellationToken) => {
				return this._provideCodeLenses(model);
			},
			resolveCodeLens: (_model: ITextModel, codeLens: CodeLens, _token: CancellationToken) => {
				return codeLens;
			}
		}));

		// Refresh CodeLens when issues change
		this._register(this._sentinelService.onDidFindIssue(() => {
			this._refreshCodeLenses();
		}));

		this._register(this._sentinelService.onDidDismissIssue(() => {
			this._refreshCodeLenses();
		}));

		this._register(this._sentinelService.onDidApplyFix(() => {
			this._refreshCodeLenses();
		}));

		this._register(this._sentinelService.onDidCompleteReview(() => {
			this._refreshCodeLenses();
		}));
	}

	private _registerCommands(): void {
		CommandsRegistry.registerCommand(SENTINEL_FIX_COMMAND, async (_accessor, args: { issueId: string }) => {
			await this._sentinelService.generateFix(args.issueId);
			await this._sentinelService.applyFix(args.issueId);
		});

		CommandsRegistry.registerCommand(SENTINEL_DISMISS_COMMAND, (_accessor, args: { issueId: string }) => {
			this._sentinelService.dismissIssue(args.issueId, 'Dismissed via CodeLens');
		});

		CommandsRegistry.registerCommand(SENTINEL_EXPLAIN_COMMAND, (_accessor, args: { issueId: string }) => {
			const issues = this._sentinelService.getAllIssues();
			const issue = issues.find(i => i.id === args.issueId);
			if (!issue) return;

			this._commandService.executeCommand('void.newChatAction', {
				message: `Explain this code issue found by Sentinel:\n\n**${issue.severity.toUpperCase()}** - ${issue.category}\n\n${issue.message}\n\nFile: ${issue.uri.fsPath}, lines ${issue.startLine}-${issue.endLine}\n\nSuggestion: ${issue.suggestion}${issue.cweId ? `\n\nCWE: ${issue.cweId}` : ''}`,
			});
		});
	}

	private _provideCodeLenses(model: ITextModel): { lenses: CodeLens[], dispose: () => void } {
		const uri = model.uri;
		const issues = this._sentinelService.getAllIssues().filter(i =>
			i.uri.toString() === uri.toString() && !i.dismissed && !i.fixApplied
		);

		const lenses: CodeLens[] = [];
		const seenLines = new Set<number>();

		for (const issue of issues) {
			if (seenLines.has(issue.startLine)) continue;
			seenLines.add(issue.startLine);

			const range = new Range(issue.startLine, 1, issue.startLine, 1);
			const severityIcon = issue.severity === 'blocker' || issue.severity === 'critical' ? '$(shield)' : '$(warning)';

			// Fix action
			lenses.push({
				range,
				command: {
					id: SENTINEL_FIX_COMMAND,
					title: `${severityIcon} Fix with Sentinel`,
					arguments: [{ issueId: issue.id }],
				}
			});

			// Dismiss action
			lenses.push({
				range,
				command: {
					id: SENTINEL_DISMISS_COMMAND,
					title: `$(eye-closed) Dismiss`,
					arguments: [{ issueId: issue.id }],
				}
			});

			// Explain action
			lenses.push({
				range,
				command: {
					id: SENTINEL_EXPLAIN_COMMAND,
					title: `$(question) Explain`,
					arguments: [{ issueId: issue.id }],
				}
			});
		}

		return { lenses, dispose: () => { } };
	}

	private _refreshCodeLenses(): void {
		// Use same refresh pattern as diagnosticCodeLensService.ts
		const editors = this._codeEditorService.listCodeEditors();
		for (const editor of editors) {
			const model = editor.getModel();
			if (model) {
				try {
					editor.setModel(model);
				} catch {
					// Editor may be disposed
				}
			}
		}
	}
}

registerSingleton(ISentinelCodeLensService, SentinelCodeLensService, InstantiationType.Delayed);
