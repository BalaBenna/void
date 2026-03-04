/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { NLGitTranslation, GitRiskLevel } from '../common/nlGitTypes.js';
import { ITerminalToolService } from './terminalToolService.js';
import { generateUuid } from '../../../../base/common/uuid.js';


export interface INLGitService {
	readonly _serviceBrand: undefined;

	translateToGitCommand(naturalLanguage: string): NLGitTranslation;
	executeWithConfirmation(translation: NLGitTranslation): Promise<{ success: boolean; output: string }>;
	assessRisk(gitCommand: string): GitRiskLevel;
}

export const INLGitService = createDecorator<INLGitService>('voidNLGitService');


// Known dangerous git commands/flags
const DANGEROUS_PATTERNS = [
	'--force', '-f',
	'reset --hard',
	'clean -f',
	'push --force',
	'branch -D',
	'checkout --',
	'stash drop',
	'reflog expire',
	'gc --prune',
];

const MODERATE_PATTERNS = [
	'merge',
	'rebase',
	'cherry-pick',
	'reset',
	'stash',
	'push',
	'tag -d',
];


class NLGitService extends Disposable implements INLGitService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@ITerminalToolService private readonly _terminalToolService: ITerminalToolService,
	) {
		super();
	}

	translateToGitCommand(naturalLanguage: string): NLGitTranslation {
		// This is a rule-based fallback. In production, this would call the LLM.
		// The actual LLM call happens via the nl_git tool in chatThreadService.
		const lower = naturalLanguage.toLowerCase();
		let gitCommand = '';
		let explanation = '';

		if (lower.includes('undo last commit') || lower.includes('uncommit')) {
			gitCommand = 'git reset --soft HEAD~1';
			explanation = 'Undoes the last commit but keeps changes staged';
		} else if (lower.includes('show changes') || lower.includes('what changed')) {
			gitCommand = 'git diff';
			explanation = 'Shows unstaged changes in the working directory';
		} else if (lower.includes('create branch') || lower.includes('new branch')) {
			const branchName = lower.replace(/.*(?:create|new)\s+branch\s+/i, '').trim() || 'new-branch';
			gitCommand = `git checkout -b ${branchName}`;
			explanation = `Creates and switches to a new branch named "${branchName}"`;
		} else if (lower.includes('switch') || lower.includes('checkout')) {
			const branchName = lower.replace(/.*(?:switch|checkout)\s+(?:to\s+)?/i, '').trim() || 'main';
			gitCommand = `git checkout ${branchName}`;
			explanation = `Switches to branch "${branchName}"`;
		} else if (lower.includes('stage all') || lower.includes('add all')) {
			gitCommand = 'git add -A';
			explanation = 'Stages all changes (new, modified, deleted files)';
		} else if (lower.includes('status')) {
			gitCommand = 'git status';
			explanation = 'Shows the working tree status';
		} else if (lower.includes('log') || lower.includes('history')) {
			gitCommand = 'git log --oneline -20';
			explanation = 'Shows the last 20 commits in one-line format';
		} else {
			// Fallback: pass through as-is if it looks like git command
			gitCommand = naturalLanguage.startsWith('git ') ? naturalLanguage : `git ${naturalLanguage}`;
			explanation = 'Direct git command (review carefully before executing)';
		}

		const riskLevel = this.assessRisk(gitCommand);

		return {
			naturalLanguage,
			gitCommand,
			explanation,
			riskLevel,
			requiresConfirmation: riskLevel !== 'safe',
		};
	}

	async executeWithConfirmation(translation: NLGitTranslation): Promise<{ success: boolean; output: string }> {
		const workspacePath = this._getWorkspacePath();
		if (!workspacePath) return { success: false, output: 'No workspace found' };

		try {
			const terminalId = `nlgit-${generateUuid().substring(0, 8)}`;
			const { resPromise } = await this._terminalToolService.runCommand(
				translation.gitCommand,
				{ type: 'temporary', cwd: workspacePath, terminalId }
			);
			const { result, resolveReason } = await resPromise;
			const success = resolveReason.type === 'done' && resolveReason.exitCode === 0;
			return { success, output: result };
		} catch (e) {
			return { success: false, output: `${e}` };
		}
	}

	assessRisk(gitCommand: string): GitRiskLevel {
		const lower = gitCommand.toLowerCase();

		for (const pattern of DANGEROUS_PATTERNS) {
			if (lower.includes(pattern)) return 'dangerous';
		}

		for (const pattern of MODERATE_PATTERNS) {
			if (lower.includes(pattern)) return 'moderate';
		}

		return 'safe';
	}

	private _getWorkspacePath(): string | null {
		const folders = this._workspaceContextService.getWorkspace().folders;
		return folders.length > 0 ? folders[0].uri.fsPath : null;
	}
}

registerSingleton(INLGitService, NLGitService, InstantiationType.Delayed);
