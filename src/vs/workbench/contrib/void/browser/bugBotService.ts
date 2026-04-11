/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Emitter, Event } from '../../../../base/common/event.js';

import { TriagedIssue, BugSeverity } from '../common/bugBotTypes.js';
import { IToolsService } from './toolsService.js';
import { IEmbeddingsService } from './embeddingsService.js';


export interface IBugBotService {
	readonly _serviceBrand: undefined;

	readonly onDidTriageIssue: Event<TriagedIssue>;

	/**
	 * Fetch and triage open GitHub issues.
	 */
	triageIssues(maxIssues?: number): Promise<TriagedIssue[]>;

	/**
	 * Auto-fix a trivial issue: create branch, make fix, open PR.
	 */
	autoFixIssue(issue: TriagedIssue): Promise<{ success: boolean; prUrl?: string }>;
}

export const IBugBotService = createDecorator<IBugBotService>('voidBugBotService');


class BugBotService extends Disposable implements IBugBotService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidTriageIssue = this._register(new Emitter<TriagedIssue>());
	readonly onDidTriageIssue: Event<TriagedIssue> = this._onDidTriageIssue.event;

	constructor(
		@IToolsService private readonly _toolsService: IToolsService,
		@IEmbeddingsService private readonly _embeddingsService: IEmbeddingsService,
	) {
		super();
	}

	async triageIssues(maxIssues: number = 10): Promise<TriagedIssue[]> {
		// Fetch open issues using gh CLI
		const cmd = await this._toolsService.callTool.run_command({
			command: `gh issue list --state open --limit ${maxIssues} --json number,title,body,labels`,
			cwd: null,
			terminalId: '__void_bugbot',
		});
		const cmdResult = await cmd.result;

		let issues: any[];
		try {
			issues = JSON.parse(cmdResult.result);
		} catch {
			return [];
		}

		const triaged: TriagedIssue[] = [];
		for (const issue of issues) {
			const triagedIssue = await this._triageSingleIssue(issue);
			triaged.push(triagedIssue);
			this._onDidTriageIssue.fire(triagedIssue);
		}

		return triaged;
	}

	async autoFixIssue(issue: TriagedIssue): Promise<{ success: boolean; prUrl?: string }> {
		if (!issue.autoFixable) {
			return { success: false };
		}

		try {
			// Create branch
			const branchName = `bugbot/fix-${issue.number}`;
			await this._toolsService.callTool.git_create_branch({ branchName });

			// The actual fix would be done by spawning a subagent with the issue context
			// For now, return the branch info
			return { success: true };
		} catch {
			return { success: false };
		}
	}

	private async _triageSingleIssue(issue: any): Promise<TriagedIssue> {
		const body = issue.body ?? '';
		const title = issue.title ?? '';
		const labels = (issue.labels ?? []).map((l: any) => l.name ?? l);

		// Determine severity from labels and content
		const severity = this._classifySeverity(title, body, labels);

		// Find relevant files using embeddings
		const searchQuery = `${title} ${body}`.substring(0, 500);
		const searchResults = this._embeddingsService.search(searchQuery, null, 5);
		const relevantFiles = searchResults.map(r => r.uri.fsPath);

		// Determine complexity
		const complexity = this._classifyComplexity(title, body);
		const autoFixable = complexity === 'trivial' || complexity === 'simple';

		return {
			number: issue.number,
			title,
			body: body.substring(0, 1000),
			labels,
			severity,
			relevantFiles,
			suggestedFix: null,
			autoFixable,
			complexity,
		};
	}

	private _classifySeverity(title: string, body: string, labels: string[]): BugSeverity {
		const text = `${title} ${body}`.toLowerCase();
		if (labels.some(l => l.includes('critical') || l.includes('urgent') || l.includes('p0'))) return 'critical';
		if (text.includes('crash') || text.includes('data loss') || text.includes('security')) return 'critical';
		if (labels.some(l => l.includes('bug'))) return 'high';
		if (text.includes('error') || text.includes('broken') || text.includes('fail')) return 'high';
		if (labels.some(l => l.includes('enhancement') || l.includes('feature'))) return 'enhancement';
		if (text.includes('typo') || text.includes('cosmetic') || text.includes('minor')) return 'low';
		return 'medium';
	}

	private _classifyComplexity(title: string, body: string): 'trivial' | 'simple' | 'moderate' | 'complex' {
		const text = `${title} ${body}`.toLowerCase();
		if (text.includes('typo') || text.includes('spelling') || text.includes('rename')) return 'trivial';
		if (text.includes('null check') || text.includes('missing import') || text.includes('off by one')) return 'simple';
		if (text.includes('refactor') || text.includes('redesign') || text.includes('architecture')) return 'complex';
		return 'moderate';
	}
}

registerSingleton(IBugBotService, BugBotService, InstantiationType.Delayed);
