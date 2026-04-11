/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { CodeLens } from '../../../../editor/common/languages.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { Range } from '../../../../editor/common/core/range.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';

export interface IDiagnosticCodeLensService {
	readonly _serviceBrand: undefined;
}

export const IDiagnosticCodeLensService = createDecorator<IDiagnosticCodeLensService>('diagnosticCodeLensService');

const FIX_WITH_VOID_COMMAND = 'void.fixDiagnosticError';
const EXPLAIN_ERROR_COMMAND = 'void.explainDiagnosticError';

class DiagnosticCodeLensService extends Disposable implements IDiagnosticCodeLensService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IMarkerService private readonly _markerService: IMarkerService,
		@ICodeEditorService private readonly _codeEditorService: ICodeEditorService,
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
		@ICommandService private readonly _commandService: ICommandService,
	) {
		super();

		// Register commands for CodeLens actions
		this._registerCommands();

		// Register CodeLens provider
		this._register(this._languageFeaturesService.codeLensProvider.register('*', {
			provideCodeLenses: (model: ITextModel, token: CancellationToken) => {
				return this._provideCodeLenses(model);
			},
			resolveCodeLens: (_model: ITextModel, codeLens: CodeLens, _token: CancellationToken) => {
				return codeLens;
			}
		}));

		// Refresh CodeLens when markers change
		this._register(this._markerService.onMarkerChanged(_uris => {
			const editors = this._codeEditorService.listCodeEditors();
			for (const editor of editors) {
				const model = editor.getModel();
				if (model) {
					// Trigger CodeLens refresh by touching the model
					editor.setModel(model);
				}
			}
		}));
	}

	private _registerCommands(): void {
		CommandsRegistry.registerCommand(FIX_WITH_VOID_COMMAND, (_accessor, args: { uri: string, message: string, startLine: number, endLine: number }) => {
			// This command triggers the sidebar chat with the error context
			// The actual implementation will be handled by the sidebar actions
			this._commandService.executeCommand('void.newChatAction', {
				message: `Fix this error:\n\n${args.message}\n\nFile: ${args.uri}, lines ${args.startLine}-${args.endLine}`,
			});
		});

		CommandsRegistry.registerCommand(EXPLAIN_ERROR_COMMAND, (_accessor, args: { uri: string, message: string, startLine: number, endLine: number }) => {
			this._commandService.executeCommand('void.newChatAction', {
				message: `Explain this error:\n\n${args.message}\n\nFile: ${args.uri}, lines ${args.startLine}-${args.endLine}`,
			});
		});
	}

	private _provideCodeLenses(model: ITextModel): { lenses: CodeLens[], dispose: () => void } {
		const uri = model.uri;
		const markers = this._markerService.read({ resource: uri });
		const lenses: CodeLens[] = [];

		// Only show for errors and warnings
		const relevantMarkers = markers.filter(m =>
			m.severity === MarkerSeverity.Error || m.severity === MarkerSeverity.Warning
		);

		// Deduplicate by line - only show one CodeLens per line
		const seenLines = new Set<number>();

		for (const marker of relevantMarkers) {
			if (seenLines.has(marker.startLineNumber)) continue;
			seenLines.add(marker.startLineNumber);

			const range = new Range(marker.startLineNumber, 1, marker.startLineNumber, 1);

			lenses.push({
				range,
				command: {
					id: FIX_WITH_VOID_COMMAND,
					title: `$(sparkle) Fix with Void`,
					arguments: [{
						uri: uri.fsPath,
						message: marker.message,
						startLine: marker.startLineNumber,
						endLine: marker.endLineNumber,
					}]
				}
			});

			lenses.push({
				range,
				command: {
					id: EXPLAIN_ERROR_COMMAND,
					title: `$(question) Explain`,
					arguments: [{
						uri: uri.fsPath,
						message: marker.message,
						startLine: marker.startLineNumber,
						endLine: marker.endLineNumber,
					}]
				}
			});
		}

		return { lenses, dispose: () => { } };
	}
}

registerSingleton(IDiagnosticCodeLensService, DiagnosticCodeLensService, InstantiationType.Eager);
