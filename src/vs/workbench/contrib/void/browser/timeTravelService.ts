/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ITerminalToolService } from './terminalToolService.js';
import { generateUuid } from '../../../../base/common/uuid.js';


export interface ITimeTravelService {
	readonly _serviceBrand: undefined;

	queryAtCommit(commit: string, question: string): Promise<string>;
	getFileAtCommit(commit: string, filePath: string): Promise<string>;
	diffBetweenCommits(commitA: string, commitB: string, filePath?: string): Promise<string>;
}

export const ITimeTravelService = createDecorator<ITimeTravelService>('voidTimeTravelService');


class TimeTravelService extends Disposable implements ITimeTravelService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@ITerminalToolService private readonly _terminalToolService: ITerminalToolService,
	) {
		super();
	}

	async queryAtCommit(commit: string, _question: string): Promise<string> {
		// Get the file listing at a specific commit
		const workspacePath = this._getWorkspacePath();
		if (!workspacePath) return 'No workspace found';

		const result = await this._runGit(`git log --oneline -5 ${commit}`, workspacePath);
		return result;
	}

	async getFileAtCommit(commit: string, filePath: string): Promise<string> {
		const workspacePath = this._getWorkspacePath();
		if (!workspacePath) return 'No workspace found';

		return this._runGit(`git show ${commit}:${filePath}`, workspacePath);
	}

	async diffBetweenCommits(commitA: string, commitB: string, filePath?: string): Promise<string> {
		const workspacePath = this._getWorkspacePath();
		if (!workspacePath) return 'No workspace found';

		const fileArg = filePath ? ` -- ${filePath}` : '';
		return this._runGit(`git diff ${commitA}..${commitB}${fileArg}`, workspacePath);
	}

	private async _runGit(command: string, cwd: string): Promise<string> {
		try {
			const terminalId = `timetravel-${generateUuid().substring(0, 8)}`;
			const { resPromise } = await this._terminalToolService.runCommand(
				command,
				{ type: 'temporary', cwd, terminalId }
			);
			const { result } = await resPromise;
			return result.trim();
		} catch (e) {
			return `Error: ${e}`;
		}
	}

	private _getWorkspacePath(): string | null {
		const folders = this._workspaceContextService.getWorkspace().folders;
		return folders.length > 0 ? folders[0].uri.fsPath : null;
	}
}

registerSingleton(ITimeTravelService, TimeTravelService, InstantiationType.Delayed);
