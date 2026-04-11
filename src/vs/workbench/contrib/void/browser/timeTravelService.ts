/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

import { CommitInfo } from '../common/timeTravelTypes.js';
import { IToolsService } from './toolsService.js';


export interface ITimeTravelService {
	readonly _serviceBrand: undefined;

	getFileHistory(filePath: string, maxCommits?: number): Promise<CommitInfo[]>;
	getFileAtCommit(filePath: string, commitSha: string): Promise<string | null>;
	searchHistory(query: string, options?: { since?: string; until?: string; author?: string }): Promise<CommitInfo[]>;
	getBlame(filePath: string, startLine?: number, endLine?: number): Promise<string>;
}

export const ITimeTravelService = createDecorator<ITimeTravelService>('voidTimeTravelService');


class TimeTravelService extends Disposable implements ITimeTravelService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IToolsService private readonly _toolsService: IToolsService,
	) {
		super();
	}

	async getFileHistory(filePath: string, maxCommits: number = 20): Promise<CommitInfo[]> {
		const cmd = await this._toolsService.callTool.git_log({
			maxCount: maxCommits,
			filePath,
			author: null,
			since: null,
			until: null,
			grep: null,
		});
		const result = await cmd.result;
		return this._parseGitLog(result.output);
	}

	async getFileAtCommit(filePath: string, commitSha: string): Promise<string | null> {
		try {
			const cmd = await this._toolsService.callTool.run_command({
				command: `git show ${commitSha}:${filePath}`,
				cwd: null,
				terminalId: '__void_timetravel',
			});
			const result = await cmd.result;
			return result.result;
		} catch {
			return null;
		}
	}

	async searchHistory(query: string, options?: { since?: string; until?: string; author?: string }): Promise<CommitInfo[]> {
		const cmd = await this._toolsService.callTool.git_log({
			maxCount: 30,
			filePath: null,
			author: options?.author ?? null,
			since: options?.since ?? null,
			until: options?.until ?? null,
			grep: query,
		});
		const result = await cmd.result;
		return this._parseGitLog(result.output);
	}

	async getBlame(filePath: string, startLine?: number, endLine?: number): Promise<string> {
		const cmd = await this._toolsService.callTool.git_blame({
			filePath,
			startLine: startLine ?? null,
			endLine: endLine ?? null,
		});
		const result = await cmd.result;
		return result.output;
	}

	private _parseGitLog(output: string): CommitInfo[] {
		if (!output?.trim()) return [];

		const commits: CommitInfo[] = [];
		for (const line of output.trim().split('\n')) {
			const match = line.match(/^([a-f0-9]+)\s+(.*)$/);
			if (!match) continue;
			commits.push({
				sha: match[1],
				shortSha: match[1].substring(0, 7),
				author: '',
				date: '',
				message: match[2],
				files: [],
			});
		}
		return commits;
	}
}

registerSingleton(ITimeTravelService, TimeTravelService, InstantiationType.Delayed);
