/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ReviewIssue, ReviewRequest, ReviewResult } from '../common/prReviewTypes.js';
import { IToolsService } from './toolsService.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { IvoidSettingsService } from '../common/voidSettingsService.js';
import { URI } from '../../../../base/common/uri.js';

export interface IPRReviewService {
	readonly _serviceBrand: undefined;
	onDidCompleteReview: Event<ReviewResult>;
	onDidStartReview: Event<void>;
	startReview(request: ReviewRequest): Promise<ReviewResult>;
	getLastReview(): ReviewResult | null;
	isReviewing(): boolean;
}

export const IPRReviewService = createDecorator<IPRReviewService>('voidPRReviewService');

class PRReviewService extends Disposable implements IPRReviewService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidCompleteReview = new Emitter<ReviewResult>();
	readonly onDidCompleteReview = this._onDidCompleteReview.event;

	private readonly _onDidStartReview = new Emitter<void>();
	readonly onDidStartReview = this._onDidStartReview.event;

	private _lastReview: ReviewResult | null = null;
	private _isReviewing = false;

	constructor(
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IToolsService private readonly _toolsService: IToolsService,
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
		@IvoidSettingsService private readonly _settingsService: IvoidSettingsService,
	) {
		super();
	}

	getLastReview(): ReviewResult | null {
		return this._lastReview;
	}

	isReviewing(): boolean {
		return this._isReviewing;
	}

	async startReview(request: ReviewRequest): Promise<ReviewResult> {
		this._isReviewing = true;
		this._onDidStartReview.fire();

		try {
			// Get diff content based on request mode
			const diffContent = await this._getDiffContent(request);
			if (!diffContent) {
				const emptyResult: ReviewResult = { issues: [], summary: 'No changes to review.', reviewedFiles: 0, timestamp: Date.now() };
				this._lastReview = emptyResult;
				return emptyResult;
			}

			// Use LLM to analyze the diff
			const issues = await this._analyzeWithLLM(diffContent);

			const result: ReviewResult = {
				issues,
				summary: this._generateSummary(issues),
				reviewedFiles: this._countReviewedFiles(diffContent),
				timestamp: Date.now(),
			};

			this._lastReview = result;
			this._onDidCompleteReview.fire(result);
			return result;
		} finally {
			this._isReviewing = false;
		}
	}

	private async _getDiffContent(request: ReviewRequest): Promise<string> {
		const folders = this._workspaceContextService.getWorkspace().folders;
		const cwd = folders[0]?.uri.fsPath;
		if (!cwd) return '';

		try {
			if (request.mode === 'branch_diff') {
				const cmd = await this._toolsService.callTool.run_command({
					command: 'git diff main...HEAD',
					cwd,
					terminalId: '__void_pr_review',
				});
				const result = await cmd.result;
				return result.result;
			} else if (request.mode === 'changed_files') {
				const cmd = await this._toolsService.callTool.run_command({
					command: 'git diff --cached && git diff',
					cwd,
					terminalId: '__void_pr_review',
				});
				const result = await cmd.result;
				return result.result;
			} else if (request.mode === 'specific_files' && request.fileUris) {
				const paths = request.fileUris.map(u => u.fsPath).join(' ');
				const cmd = await this._toolsService.callTool.run_command({
					command: `git diff -- ${paths}`,
					cwd,
					terminalId: '__void_pr_review',
				});
				const result = await cmd.result;
				return result.result;
			}
		} catch {
			return '';
		}
		return '';
	}

	private async _analyzeWithLLM(diffContent: string): Promise<ReviewIssue[]> {
		const issues: ReviewIssue[] = [];

		const systemMessage = `You are a code reviewer. Analyze the following git diff and identify potential issues.
For each issue found, output it in this exact format (one per issue):

ISSUE_START
FILE: <file path>
LINE: <start line>-<end line>
SEVERITY: <critical|warning|info>
CATEGORY: <null_pointer|race_condition|missing_error_handling|security|logic_error|performance|code_quality|type_safety>
MESSAGE: <brief description of the issue>
SUGGESTION: <how to fix it>
CODE: <the problematic code snippet>
ISSUE_END

Focus on:
- Null pointer/undefined access
- Race conditions
- Missing error handling
- Security vulnerabilities (injection, XSS, etc.)
- Logic errors
- Performance issues
- Type safety issues

Only report real issues, not style preferences. Be specific and actionable.`;

		const truncatedDiff = diffContent.slice(0, 50000); // truncate to avoid token limits

		return new Promise<ReviewIssue[]>((resolve) => {
			let fullText = '';

			const modelSelection = this._settingsService.state.modelSelectionOfFeature['Chat'];

			this._llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				messages: [
					{ role: 'user', content: `Review this diff:\n\n${truncatedDiff}` }
				],
				separateSystemMessage: systemMessage,
				chatMode: 'ask',
				onText: ({ fullText: text }: { fullText: string }) => {
					fullText = text;
				},
				onFinalMessage: () => {
					// Parse issues from the response
					const issueBlocks = fullText.split('ISSUE_START').slice(1);
					for (const block of issueBlocks) {
						const endIdx = block.indexOf('ISSUE_END');
						if (endIdx === -1) continue;
						const content = block.slice(0, endIdx).trim();

						const file = content.match(/FILE:\s*(.+)/)?.[1]?.trim();
						const lineRange = content.match(/LINE:\s*(\d+)-(\d+)/);
						const severity = content.match(/SEVERITY:\s*(critical|warning|info)/)?.[1] as ReviewIssue['severity'];
						const category = content.match(/CATEGORY:\s*(\w+)/)?.[1] as ReviewIssue['category'];
						const message = content.match(/MESSAGE:\s*(.+)/)?.[1]?.trim();
						const suggestion = content.match(/SUGGESTION:\s*(.+)/)?.[1]?.trim();
						const code = content.match(/CODE:\s*([\s\S]*?)(?=$)/)?.[1]?.trim();

						if (file && severity && message) {
							issues.push({
								id: generateUuid(),
								uri: URI.file(file),
								startLine: lineRange ? parseInt(lineRange[1]) : 1,
								endLine: lineRange ? parseInt(lineRange[2]) : 1,
								severity: severity || 'info',
								category: category || 'code_quality',
								message: message || '',
								suggestion: suggestion || '',
								codeSnippet: code || '',
							});
						}
					}
					resolve(issues);
				},
				onError: () => {
					resolve([]);
				},
				onAbort: () => {
					resolve([]);
				},
				logging: { loggingName: 'PR Review' },
				modelSelection,
				modelSelectionOptions: undefined,
				overridesOfModel: undefined,
			});
		});
	}

	private _generateSummary(issues: ReviewIssue[]): string {
		const critical = issues.filter(i => i.severity === 'critical').length;
		const warnings = issues.filter(i => i.severity === 'warning').length;
		const info = issues.filter(i => i.severity === 'info').length;

		if (issues.length === 0) return 'No issues found. Code looks good!';
		return `Found ${issues.length} issue(s): ${critical} critical, ${warnings} warnings, ${info} informational.`;
	}

	private _countReviewedFiles(diff: string): number {
		const files = new Set<string>();
		const matches = diff.matchAll(/^diff --git a\/(.+?) b\//gm);
		for (const match of matches) {
			files.add(match[1]);
		}
		return files.size;
	}
}

registerSingleton(IPRReviewService, PRReviewService, InstantiationType.Delayed);
