/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { DebugError, DebugAnalysis, DebugSourceConfig, defaultDebugSourceConfig } from '../common/debugTypes.js';
import { ITerminalToolService } from './terminalToolService.js';
import { IErrorClassificationService } from './errorClassificationService.js';
import { generateUuid } from '../../../../base/common/uuid.js';


export interface IDebugService {
	readonly _serviceBrand: undefined;

	collectErrors(config?: Partial<DebugSourceConfig>): DebugError[];
	gitBlame(file: string, line: number): Promise<string>;
	analyzeAndFix(threadId: string, errors: DebugError[]): Promise<DebugAnalysis>;
	autoFixLoop(threadId: string, maxAttempts?: number): Promise<{ fixed: boolean; attempts: number }>;
}

export const IDebugService = createDecorator<IDebugService>('voidDebugService');


class DebugService extends Disposable implements IDebugService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IMarkerService private readonly _markerService: IMarkerService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@ITerminalToolService private readonly _terminalToolService: ITerminalToolService,
		@IErrorClassificationService _errorClassificationService: IErrorClassificationService,
		@IInstantiationService _instantiationService: IInstantiationService,
	) {
		super();
	}

	collectErrors(config?: Partial<DebugSourceConfig>): DebugError[] {
		const cfg = { ...defaultDebugSourceConfig, ...config };
		const errors: DebugError[] = [];

		if (cfg.includeLSP) {
			errors.push(...this._collectFromLSPMarkers());
		}

		return errors;
	}

	private _collectFromLSPMarkers(): DebugError[] {
		const markers = this._markerService.read({});
		return markers
			.filter(m => m.severity === MarkerSeverity.Error || m.severity === MarkerSeverity.Warning)
			.slice(0, 50)
			.map(m => ({
				message: m.message,
				file: m.resource.fsPath,
				line: m.startLineNumber,
				column: m.startColumn,
				severity: m.severity === MarkerSeverity.Error ? 'error' as const : 'warning' as const,
				code: typeof m.code === 'string' ? m.code : m.code?.value || '',
				source: 'lsp',
			}));
	}

	async gitBlame(file: string, line: number): Promise<string> {
		const workspacePath = this._getWorkspacePath();
		if (!workspacePath) return 'No workspace found';

		try {
			const terminalId = `debug-blame-${generateUuid().substring(0, 8)}`;
			const { resPromise } = await this._terminalToolService.runCommand(
				`git blame -L ${line},${line} -- "${file}"`,
				{ type: 'temporary', cwd: workspacePath, terminalId }
			);
			const { result } = await resPromise;
			return result.trim();
		} catch (e) {
			return `Git blame failed: ${e}`;
		}
	}

	async analyzeAndFix(_threadId: string, errors: DebugError[]): Promise<DebugAnalysis> {
		// Collect blame info for error locations
		const blameInfo = [];
		for (const err of errors.slice(0, 5)) {
			if (err.file && err.line) {
				const blame = await this.gitBlame(err.file, err.line);
				blameInfo.push({
					file: err.file,
					line: err.line,
					author: '',
					commit: '',
					date: '',
					summary: blame,
				});
			}
		}

		return {
			errors,
			blameInfo,
			confidence: 0,
		};
	}

	async autoFixLoop(_threadId: string, maxAttempts: number = 3): Promise<{ fixed: boolean; attempts: number }> {
		let attempts = 0;
		while (attempts < maxAttempts) {
			attempts++;
			const errors = this.collectErrors();
			if (errors.filter(e => e.severity === 'error').length === 0) {
				return { fixed: true, attempts };
			}
			// Let the caller (chatThreadService) handle the actual fix via LLM
			break;
		}
		return { fixed: false, attempts };
	}

	private _getWorkspacePath(): string | null {
		const folders = this._workspaceContextService.getWorkspace().folders;
		return folders.length > 0 ? folders[0].uri.fsPath : null;
	}
}

registerSingleton(IDebugService, DebugService, InstantiationType.Delayed);
