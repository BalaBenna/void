/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ResolvedMention, MentionType, mentionPatterns } from '../common/mentionTypes.js';
import { ITerminalToolService } from './terminalToolService.js';
import { generateUuid } from '../../../../base/common/uuid.js';


export interface IMentionResolverService {
	readonly _serviceBrand: undefined;

	resolve(mentionStr: string): Promise<ResolvedMention | null>;
	parseUserMessage(message: string): Promise<{ cleanMessage: string; mentions: ResolvedMention[] }>;
}

export const IMentionResolverService = createDecorator<IMentionResolverService>('voidMentionResolverService');


class MentionResolverService extends Disposable implements IMentionResolverService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@ITerminalToolService private readonly _terminalToolService: ITerminalToolService,
	) {
		super();
	}

	async resolve(mentionStr: string): Promise<ResolvedMention | null> {
		for (const pattern of mentionPatterns) {
			const regex = new RegExp(pattern.regex.source);
			const match = regex.exec(mentionStr);
			if (match) {
				return this._resolveMention(pattern.type, match[1], mentionStr);
			}
		}
		return null;
	}

	async parseUserMessage(message: string): Promise<{ cleanMessage: string; mentions: ResolvedMention[] }> {
		const mentions: ResolvedMention[] = [];
		let cleanMessage = message;

		for (const pattern of mentionPatterns) {
			const regex = new RegExp(pattern.regex.source, 'g');
			let match;
			while ((match = regex.exec(message)) !== null) {
				const resolved = await this._resolveMention(pattern.type, match[1], match[0]);
				if (resolved) {
					mentions.push(resolved);
				}
			}
		}

		return { cleanMessage, mentions };
	}

	private async _resolveMention(type: MentionType, value: string, raw: string): Promise<ResolvedMention | null> {
		switch (type) {
			case 'git':
				return this._resolveGitMention(value, raw);
			case 'pr':
				return this._resolvePRMention(value, raw);
			case 'docs':
				return this._resolveDocsMention(value, raw);
			case 'web':
				return this._resolveWebMention(value, raw);
			case 'issue':
				return this._resolveIssueMention(value, raw);
			default:
				return null;
		}
	}

	private async _resolveGitMention(ref: string, raw: string): Promise<ResolvedMention | null> {
		const workspacePath = this._getWorkspacePath();
		if (!workspacePath) return null;

		try {
			// Uses the existing terminalToolService which handles safe command execution
			const terminalId = `mention-git-${generateUuid().substring(0, 8)}`;
			const { resPromise } = await this._terminalToolService.runCommand(
				`git log --oneline -10 ${ref}`,
				{ type: 'temporary', cwd: workspacePath, terminalId }
			);
			const { result } = await resPromise;
			return {
				type: 'git',
				raw,
				resolved: `Git history for ${ref}:\n${result.trim()}`,
				label: `git:${ref}`,
			};
		} catch {
			return { type: 'git', raw, resolved: `Failed to resolve git ref: ${ref}`, label: `git:${ref}` };
		}
	}

	private async _resolvePRMention(prNumber: string, raw: string): Promise<ResolvedMention | null> {
		const workspacePath = this._getWorkspacePath();
		if (!workspacePath) return null;

		try {
			const terminalId = `mention-pr-${generateUuid().substring(0, 8)}`;
			const { resPromise } = await this._terminalToolService.runCommand(
				`gh pr view ${prNumber} --json title,body,state,additions,deletions,files`,
				{ type: 'temporary', cwd: workspacePath, terminalId }
			);
			const { result } = await resPromise;
			return {
				type: 'pr',
				raw,
				resolved: `PR #${prNumber}:\n${result.trim()}`,
				label: `PR #${prNumber}`,
			};
		} catch {
			return { type: 'pr', raw, resolved: `Failed to resolve PR #${prNumber}`, label: `PR #${prNumber}` };
		}
	}

	private async _resolveDocsMention(packageName: string, raw: string): Promise<ResolvedMention | null> {
		return {
			type: 'docs',
			raw,
			resolved: `[Documentation for ${packageName} - query the docs index service for detailed results]`,
			label: `docs:${packageName}`,
		};
	}

	private async _resolveWebMention(url: string, raw: string): Promise<ResolvedMention | null> {
		return {
			type: 'web',
			raw,
			resolved: `[Web content from ${url} - use web_search tool for detailed results]`,
			label: `web:${url}`,
		};
	}

	private async _resolveIssueMention(issueId: string, raw: string): Promise<ResolvedMention | null> {
		const workspacePath = this._getWorkspacePath();
		if (!workspacePath) return null;

		try {
			const terminalId = `mention-issue-${generateUuid().substring(0, 8)}`;
			const { resPromise } = await this._terminalToolService.runCommand(
				`gh issue view ${issueId} --json title,body,state,labels,comments`,
				{ type: 'temporary', cwd: workspacePath, terminalId }
			);
			const { result } = await resPromise;
			return {
				type: 'issue',
				raw,
				resolved: `Issue #${issueId}:\n${result.trim()}`,
				label: `Issue #${issueId}`,
			};
		} catch {
			return { type: 'issue', raw, resolved: `Failed to resolve issue #${issueId}`, label: `#${issueId}` };
		}
	}

	private _getWorkspacePath(): string | null {
		const folders = this._workspaceContextService.getWorkspace().folders;
		return folders.length > 0 ? folders[0].uri.fsPath : null;
	}
}

registerSingleton(IMentionResolverService, MentionResolverService, InstantiationType.Delayed);
