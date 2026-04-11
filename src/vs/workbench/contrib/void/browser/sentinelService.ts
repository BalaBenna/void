/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IToolsService } from './toolsService.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { IvoidSettingsService } from '../common/voidSettingsService.js';
import {
	SentinelIssue,
	SentinelReviewSession,
	SentinelReviewRequest,
	SentinelReviewResult,
	SentinelProgress,
	SentinelHistoryEntry,
	SentinelAutofix,
	SentinelCategory,
	SentinelSeverity,
} from '../common/sentinelTypes.js';
import {
	parseDiffFiles,
	extractImports,
	tryParseJSON,
	computeSecurityScore,
	computeQualityScore,
	resolveImportPath,
	deduplicateIssues,
	buildValidationPrompt,
	type ParsedDiffFile,
} from '../common/sentinelUtils.js';


export interface ISentinelService {
	readonly _serviceBrand: undefined;

	// Streaming events
	onDidStartReview: Event<SentinelReviewSession>;
	onDidUpdateProgress: Event<SentinelProgress>;
	onDidFindIssue: Event<SentinelIssue>;
	onDidCompleteReview: Event<SentinelReviewResult>;
	onDidDismissIssue: Event<{ issueId: string }>;
	onDidApplyFix: Event<{ issueId: string }>;

	// Core actions
	startReview(request: SentinelReviewRequest): Promise<SentinelReviewSession>;
	cancelReview(sessionId: string): void;

	// Issue management
	dismissIssue(issueId: string, reason: string): void;
	applyFix(issueId: string): Promise<boolean>;
	applyAllFixes(sessionId: string): Promise<number>;
	generateFix(issueId: string): Promise<SentinelAutofix | null>;

	// State
	getCurrentSession(): SentinelReviewSession | null;
	getHistory(): SentinelHistoryEntry[];
	getAllIssues(): SentinelIssue[];
	isReviewing(): boolean;
}

export const ISentinelService = createDecorator<ISentinelService>('voidSentinelService');


// ---- LLM Prompt Templates (BugBot-inspired: aggressive investigation, low false positives) ----

const PERFILE_ANALYSIS_PROMPT = `You are Sentinel, an expert code reviewer. Your job is to find REAL bugs — not style issues.

INVESTIGATION APPROACH (inspired by best-in-class code review):
1. Understand the INTENT of the changes first
2. Investigate every suspicious pattern aggressively — err on the side of flagging
3. Focus on logic bugs, security vulnerabilities, race conditions, null safety, error handling
4. Think about edge cases the developer may have missed
5. Consider how changes interact with the rest of the codebase

For each issue, output valid JSON array:
[
  {
    "file": "<file path>",
    "startLine": <number>,
    "endLine": <number>,
    "severity": "<blocker|critical|warning|info>",
    "category": "<category>",
    "confidence": <0.0-1.0>,
    "message": "<brief description of the actual bug>",
    "suggestion": "<specific actionable fix>",
    "codeSnippet": "<the problematic code>",
    "cweId": "<CWE-XXX if security, null otherwise>"
  }
]

Categories: null_pointer, race_condition, missing_error_handling, security, logic_error, performance, code_quality, type_safety, injection, xss, auth_bypass, secrets_exposure, data_leak, resource_leak, concurrency, api_misuse, dead_code, complexity

STRICT RULES:
- Only report confidence >= 0.6
- NO style, formatting, naming, or documentation suggestions
- Each finding MUST describe a concrete bug or vulnerability, not a "could be improved"
- Be specific: include the exact code that's wrong and what would fix it
- If you find no real issues, output an empty array []
- Output ONLY the JSON array`;

const CROSSFILE_ANALYSIS_PROMPT = `You are Sentinel performing cross-file dependency analysis.

You are reviewing changes alongside related files that depend on them. Your job is to find BUGS caused by interactions between files — not single-file issues.

Look specifically for:
1. BROKEN CONTRACTS: Changed function signatures/behavior that callers don't account for
2. TYPE MISMATCHES: Return types changed but consumers still assume old type
3. ERROR PROPAGATION: New errors thrown but callers don't handle them
4. API DRIFT: API changes without corresponding updates in consumers
5. SHARED STATE: Mutations that could cause race conditions across modules
6. MISSING UPDATES: Constants, configs, or registrations that need updating after the change

Output issues as a JSON array. Only report CROSS-FILE issues with confidence >= 0.7.
If no cross-file issues exist, output [].`;

const SECURITY_AUDIT_PROMPT = `You are Sentinel performing a security penetration test review.
Think like an ATTACKER analyzing this code for exploitable vulnerabilities.

METHODOLOGY:
1. Map all INPUT BOUNDARIES (HTTP endpoints, form handlers, file ops, DB queries, shell commands, URL params)
2. For each boundary, enumerate ATTACK VECTORS
3. Trace data flow from input to dangerous operations
4. Check for OWASP Top 10: injection, XSS, path traversal, SSRF, auth bypass, insecure deserialization, CSRF

SEVERITY GUIDE:
- blocker: Remotely exploitable without authentication
- critical: Exploitable with authentication or local access
- warning: Potential vulnerability requiring specific conditions
- info: Defense-in-depth improvement

For each finding include CWE ID and brief proof-of-concept description.
Output as JSON array. Only report confidence >= 0.7. Output [] if nothing found.`;

const VALIDATION_PROMPT = `You are a code review VALIDATOR. Given the following list of potential issues found in a code review, determine which ones are REAL bugs vs false positives.

For each issue, respond with:
[
  { "id": "<issue id>", "valid": true/false, "reason": "<brief reason>" }
]

A finding is a FALSE POSITIVE if:
- It's about style, naming, or formatting
- The "bug" is actually correct behavior given the context
- The issue exists but can't actually be triggered in practice
- The suggestion would make the code worse

Only keep findings that are genuine bugs or security issues. Be aggressive about filtering — quality over quantity.`;

const AUTOFIX_PROMPT = `You are Sentinel generating a minimal, surgical code fix.

Output as JSON:
{
  "description": "<what this fix does>",
  "confidence": <0.0-1.0>,
  "edits": [
    {
      "file": "<file path>",
      "startLine": <number>,
      "startColumn": <number>,
      "endLine": <number>,
      "endColumn": <number>,
      "newText": "<replacement text>"
    }
  ]
}

RULES:
- Make the MINIMAL change to fix the issue
- Do NOT change unrelated code
- Preserve style and formatting
- Ensure the fix doesn't introduce NEW issues
- Output ONLY the JSON`;


// Re-export utils for backward compatibility
export { parseDiffFiles, extractImports, tryParseJSON, computeSecurityScore, computeQualityScore, resolveImportPath, deduplicateIssues, buildValidationPrompt, type ParsedDiffFile } from '../common/sentinelUtils.js';


// ---- Service Implementation ----

class SentinelService extends Disposable implements ISentinelService {
	declare readonly _serviceBrand: undefined;

	// Events
	private readonly _onDidStartReview = new Emitter<SentinelReviewSession>();
	readonly onDidStartReview = this._onDidStartReview.event;

	private readonly _onDidUpdateProgress = new Emitter<SentinelProgress>();
	readonly onDidUpdateProgress = this._onDidUpdateProgress.event;

	private readonly _onDidFindIssue = new Emitter<SentinelIssue>();
	readonly onDidFindIssue = this._onDidFindIssue.event;

	private readonly _onDidCompleteReview = new Emitter<SentinelReviewResult>();
	readonly onDidCompleteReview = this._onDidCompleteReview.event;

	private readonly _onDidDismissIssue = new Emitter<{ issueId: string }>();
	readonly onDidDismissIssue = this._onDidDismissIssue.event;

	private readonly _onDidApplyFix = new Emitter<{ issueId: string }>();
	readonly onDidApplyFix = this._onDidApplyFix.event;

	// State
	private _currentSession: SentinelReviewSession | null = null;
	private _history: SentinelHistoryEntry[] = [];
	private _allIssues: SentinelIssue[] = [];
	private _abortController: AbortController | null = null;
	private _currentRequestId: string | null = null;

	constructor(
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IToolsService private readonly _toolsService: IToolsService,
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
		@IvoidSettingsService private readonly _settingsService: IvoidSettingsService,
		@IFileService private readonly _fileService: IFileService,
	) {
		super();
	}

	getCurrentSession(): SentinelReviewSession | null {
		return this._currentSession;
	}

	getHistory(): SentinelHistoryEntry[] {
		return this._history;
	}

	getAllIssues(): SentinelIssue[] {
		return this._allIssues;
	}

	isReviewing(): boolean {
		return this._currentSession?.status === 'analyzing';
	}

	async startReview(request: SentinelReviewRequest): Promise<SentinelReviewSession> {
		// Cancel any existing review
		if (this._currentSession?.status === 'analyzing') {
			this.cancelReview(this._currentSession.id);
		}

		const session: SentinelReviewSession = {
			id: generateUuid(),
			request,
			result: null,
			status: 'pending',
			startedAt: Date.now(),
			progress: { phase: 'diff', filesAnalyzed: 0, totalFiles: 0, issuesFound: 0 },
		};

		this._currentSession = session;
		this._allIssues = [];
		this._abortController = new AbortController();
		this._onDidStartReview.fire(session);

		try {
			session.status = 'analyzing';

			// Pass 1: Get diff content
			this._updateProgress(session, { phase: 'diff', filesAnalyzed: 0, totalFiles: 0, issuesFound: 0 });
			const diffContent = await this._getDiffContent(request);
			if (!diffContent || !diffContent.trim()) {
				return this._completeSession(session, []);
			}

			const diffFiles = parseDiffFiles(diffContent);
			if (diffFiles.length === 0) {
				return this._completeSession(session, []);
			}
			session.progress.totalFiles = diffFiles.length;
			this._updateProgress(session, { ...session.progress, totalFiles: diffFiles.length });

			// Pass 2: Per-file analysis (aggressive investigation like BugBot)
			this._updateProgress(session, { ...session.progress, phase: 'analysis' });
			const perFileIssues = await this._analyzePerFile(session, diffFiles, request);

			// Pass 3: Cross-file analysis (deep + security + compliance modes)
			let crossFileIssues: SentinelIssue[] = [];
			if (request.reviewMode !== 'quick' && !this._isAborted()) {
				this._updateProgress(session, { ...session.progress, phase: 'cross-file' });
				crossFileIssues = await this._analyzeCrossFile(session, diffFiles, diffContent);
			}

			// Pass 4: Security audit (security + compliance modes)
			let securityIssues: SentinelIssue[] = [];
			if ((request.reviewMode === 'security' || request.reviewMode === 'compliance') && !this._isAborted()) {
				this._updateProgress(session, { ...session.progress, phase: 'security' });
				securityIssues = await this._analyzeSecurityAudit(session, diffContent);
			}

			// BugBot-inspired: Deduplicate across all passes
			let allIssues = deduplicateIssues([...perFileIssues, ...crossFileIssues, ...securityIssues]);

			// BugBot-inspired Pass 5: Validation (filter false positives via second LLM call)
			if (allIssues.length > 0 && request.reviewMode !== 'quick' && !this._isAborted()) {
				this._updateProgress(session, { ...session.progress, phase: 'rules' });
				allIssues = await this._validateIssues(allIssues, diffContent);
			}

			// Pass 6: Autofix generation for high-confidence issues
			if (!this._isAborted() && allIssues.some(i => i.confidence >= 0.8)) {
				this._updateProgress(session, { ...session.progress, phase: 'autofix' });
				await this._generateAutofixes(session, allIssues);
			}

			return this._completeSession(session, allIssues);
		} catch (err) {
			session.status = 'error';
			session.completedAt = Date.now();
			return session;
		}
	}

	cancelReview(sessionId: string): void {
		if (this._currentSession?.id === sessionId) {
			this._abortController?.abort();
			if (this._currentRequestId) {
				this._llmMessageService.abort(this._currentRequestId);
			}
			this._currentSession.status = 'cancelled';
			this._currentSession.completedAt = Date.now();
		}
	}

	dismissIssue(issueId: string, reason: string): void {
		const issue = this._allIssues.find(i => i.id === issueId);
		if (issue) {
			issue.dismissed = true;
			issue.dismissedReason = reason;
			this._onDidDismissIssue.fire({ issueId });
		}
	}

	async applyFix(issueId: string): Promise<boolean> {
		const issue = this._allIssues.find(i => i.id === issueId);
		if (!issue?.autofix) return false;

		try {
			for (const edit of issue.autofix.edits) {
				const content = await this._fileService.readFile(edit.uri);
				const text = content.value.toString();
				const lines = text.split('\n');

				// Validate line bounds
				const startLine = Math.max(1, Math.min(edit.range.startLine, lines.length));
				const endLine = Math.max(startLine, Math.min(edit.range.endLine, lines.length));
				const startCol = Math.max(1, edit.range.startColumn);
				const endCol = Math.max(1, edit.range.endColumn);

				// Build new content with proper line/column handling
				const beforeLines = lines.slice(0, startLine - 1);
				const afterLines = lines.slice(endLine);
				const firstAffectedLine = lines[startLine - 1] || '';
				const lastAffectedLine = lines[endLine - 1] || '';

				const prefix = firstAffectedLine.slice(0, startCol - 1);
				const suffix = lastAffectedLine.slice(endCol - 1);

				const newLines = [...beforeLines, prefix + edit.newText + suffix, ...afterLines];
				const newContent = newLines.join('\n');

				// Use VSBuffer for proper file writing
				await this._fileService.writeFile(edit.uri, VSBuffer.fromString(newContent));
			}

			issue.fixApplied = true;
			this._onDidApplyFix.fire({ issueId });
			return true;
		} catch {
			return false;
		}
	}

	async applyAllFixes(_sessionId: string): Promise<number> {
		let applied = 0;
		const issues = this._allIssues.filter(i => i.autofix && !i.dismissed && !i.fixApplied);
		for (const issue of issues) {
			if (await this.applyFix(issue.id)) applied++;
		}
		return applied;
	}

	async generateFix(issueId: string): Promise<SentinelAutofix | null> {
		const issue = this._allIssues.find(i => i.id === issueId);
		if (!issue) return null;

		try {
			const fileContent = await this._readFileContent(issue.uri.fsPath);
			if (!fileContent) return null;

			const prompt = `Issue in ${issue.uri.fsPath}:
- Severity: ${issue.severity}
- Category: ${issue.category}
- Message: ${issue.message}
- Lines: ${issue.startLine}-${issue.endLine}
- Suggestion: ${issue.suggestion}

File content:
\`\`\`
${fileContent.slice(0, 50000)}
\`\`\``;

			const result = await this._sendLLMRequest(AUTOFIX_PROMPT, prompt);
			const parsed = tryParseJSON<{ description: string; confidence: number; edits: Array<{ file: string; startLine: number; startColumn: number; endLine: number; endColumn: number; newText: string }> }>(result);

			if (!parsed?.edits?.length) return null;

			const autofix: SentinelAutofix = {
				description: parsed.description || 'Auto-generated fix',
				confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
				edits: parsed.edits.map(e => ({
					uri: URI.file(e.file),
					range: {
						startLine: e.startLine || 1,
						startColumn: e.startColumn || 1,
						endLine: e.endLine || e.startLine || 1,
						endColumn: e.endColumn || 1,
					},
					newText: e.newText || '',
				})),
			};

			issue.autofix = autofix;
			return autofix;
		} catch {
			return null;
		}
	}

	// ---- Private Methods ----

	private _isAborted(): boolean {
		return this._abortController?.signal.aborted ?? false;
	}

	private _updateProgress(session: SentinelReviewSession, progress: SentinelProgress): void {
		session.progress = progress;
		this._onDidUpdateProgress.fire(progress);
	}

	private _addIssue(session: SentinelReviewSession, issue: SentinelIssue): void {
		this._allIssues.push(issue);
		session.progress.issuesFound = this._allIssues.length;
		this._onDidFindIssue.fire(issue);
		this._onDidUpdateProgress.fire(session.progress);
	}

	private _completeSession(session: SentinelReviewSession, issues: SentinelIssue[]): SentinelReviewSession {
		const result: SentinelReviewResult = {
			issues,
			summary: this._generateSummary(issues),
			reviewedFiles: session.progress.totalFiles,
			timestamp: Date.now(),
			securityScore: computeSecurityScore(issues),
			qualityScore: computeQualityScore(issues),
			sessionId: session.id,
			mode: session.request.reviewMode,
			rulesApplied: session.request.customRules || [],
		};

		session.result = result;
		session.status = 'complete';
		session.completedAt = Date.now();
		session.progress.phase = 'complete';

		this._history.unshift({
			sessionId: session.id,
			timestamp: session.startedAt,
			branch: session.request.targetBranch || 'current',
			mode: session.request.reviewMode,
			issueCount: issues.length,
			criticalCount: issues.filter(i => i.severity === 'blocker' || i.severity === 'critical').length,
			fixedCount: issues.filter(i => i.fixApplied).length,
			dismissedCount: issues.filter(i => i.dismissed).length,
			filesReviewed: session.progress.totalFiles,
			duration: (session.completedAt || Date.now()) - session.startedAt,
		});

		// Keep history bounded
		if (this._history.length > 50) {
			this._history = this._history.slice(0, 50);
		}

		this._onDidCompleteReview.fire(result);
		this._updateProgress(session, session.progress);
		return session;
	}

	private async _getDiffContent(request: SentinelReviewRequest): Promise<string> {
		const folders = this._workspaceContextService.getWorkspace().folders;
		const cwd = folders[0]?.uri.fsPath;
		if (!cwd) return '';

		try {
			let command: string;
			if (request.mode === 'branch_diff') {
				const target = request.targetBranch || 'main';
				command = `git diff ${target}...HEAD`;
			} else if (request.mode === 'specific_files' && request.fileUris) {
				const paths = request.fileUris.map(u => u.fsPath).join(' ');
				command = `git diff -- ${paths}`;
			} else {
				// changed_files mode (default)
				command = 'git diff --cached; git diff';
			}

			const cmd = await this._toolsService.callTool.run_command({
				command,
				cwd,
				terminalId: '__void_sentinel',
			});
			const result = await cmd.result;
			return result.result || '';
		} catch {
			return '';
		}
	}

	private async _readFileContent(filePath: string): Promise<string | null> {
		try {
			const folders = this._workspaceContextService.getWorkspace().folders;
			const cwd = folders[0]?.uri.fsPath;
			if (!cwd) return null;

			const uri = URI.file(filePath.startsWith('/') ? filePath : `${cwd}/${filePath}`);
			const content = await this._fileService.readFile(uri);
			return content.value.toString();
		} catch {
			return null;
		}
	}

	private async _analyzePerFile(session: SentinelReviewSession, diffFiles: ParsedDiffFile[], request: SentinelReviewRequest): Promise<SentinelIssue[]> {
		const allIssues: SentinelIssue[] = [];
		const threshold = request.confidenceThreshold ?? 0.7;

		if (request.reviewMode === 'quick') {
			// Quick mode: batch all diffs in one LLM call
			const combinedDiff = diffFiles.map(f => f.diff).join('\n\n');
			const truncated = combinedDiff.slice(0, 80000);

			const result = await this._sendLLMRequest(PERFILE_ANALYSIS_PROMPT, `Review these file changes:\n\n${truncated}`);
			const issues = this._parseAndFilterIssues(result, threshold);

			for (const issue of issues) {
				allIssues.push(issue);
				this._addIssue(session, issue);
			}

			session.progress.filesAnalyzed = diffFiles.length;
			this._onDidUpdateProgress.fire(session.progress);
		} else {
			// Deep/Security/Compliance: analyze each file with full context
			for (const diffFile of diffFiles) {
				if (this._isAborted()) break;

				session.progress.currentFile = diffFile.filePath;
				this._onDidUpdateProgress.fire(session.progress);

				// BugBot-inspired: send full file content + diff for maximum context
				const fullContent = await this._readFileContent(diffFile.filePath);
				const prompt = fullContent
					? `File: ${diffFile.filePath}\n\nFull file content:\n\`\`\`\n${fullContent.slice(0, 30000)}\n\`\`\`\n\nChanges (diff):\n\`\`\`\n${diffFile.diff}\n\`\`\``
					: `File: ${diffFile.filePath}\n\nChanges (diff):\n\`\`\`\n${diffFile.diff}\n\`\`\``;

				const result = await this._sendLLMRequest(PERFILE_ANALYSIS_PROMPT, prompt);
				const issues = this._parseAndFilterIssues(result, threshold);

				for (const issue of issues) {
					allIssues.push(issue);
					this._addIssue(session, issue);
				}

				session.progress.filesAnalyzed++;
				this._onDidUpdateProgress.fire(session.progress);
			}
		}

		return allIssues;
	}

	private async _analyzeCrossFile(session: SentinelReviewSession, diffFiles: ParsedDiffFile[], fullDiff: string): Promise<SentinelIssue[]> {
		const issues: SentinelIssue[] = [];
		const relatedContext: string[] = [];

		for (const diffFile of diffFiles.slice(0, 5)) {
			const content = await this._readFileContent(diffFile.filePath);
			if (!content) continue;

			const imports = extractImports(content);
			for (const imp of imports.slice(0, 3)) {
				const basePath = resolveImportPath(diffFile.filePath, imp);
				if (!basePath) continue;

				// Try common extensions
				for (const ext of ['.ts', '.tsx', '.js', '.jsx', '']) {
					const importedContent = await this._readFileContent(basePath + ext);
					if (importedContent) {
						relatedContext.push(`\n--- Related file: ${basePath + ext} ---\n${importedContent.slice(0, 10000)}`);
						break;
					}
				}
			}
		}

		if (relatedContext.length === 0) return issues;

		const prompt = `Changed files diff:\n\`\`\`\n${fullDiff.slice(0, 40000)}\n\`\`\`\n\nRelated files:\n${relatedContext.join('\n').slice(0, 40000)}`;
		const result = await this._sendLLMRequest(CROSSFILE_ANALYSIS_PROMPT, prompt);
		const parsed = this._parseAndFilterIssues(result, 0.7);

		for (const issue of parsed) {
			issues.push(issue);
			this._addIssue(session, issue);
		}

		return issues;
	}

	private async _analyzeSecurityAudit(session: SentinelReviewSession, diffContent: string): Promise<SentinelIssue[]> {
		const issues: SentinelIssue[] = [];

		const prompt = `Analyze these code changes for security vulnerabilities:\n\n\`\`\`\n${diffContent.slice(0, 60000)}\n\`\`\``;
		const result = await this._sendLLMRequest(SECURITY_AUDIT_PROMPT, prompt);
		const parsed = this._parseAndFilterIssues(result, 0.7);

		for (const issue of parsed) {
			issues.push(issue);
			this._addIssue(session, issue);
		}

		return issues;
	}

	/** BugBot-inspired: Validate issues through a second LLM pass to reduce false positives */
	private async _validateIssues(issues: SentinelIssue[], diffContext: string): Promise<SentinelIssue[]> {
		if (issues.length === 0) return issues;

		try {
			const validationInput = buildValidationPrompt(issues, diffContext);
			const result = await this._sendLLMRequest(VALIDATION_PROMPT, validationInput);
			const validations = tryParseJSON<Array<{ id: string; valid: boolean; reason?: string }>>(result);

			if (!validations) return issues; // If validation fails, keep all issues

			const validIds = new Set(validations.filter(v => v.valid).map(v => v.id));
			// If validation returned results, filter. Otherwise keep all.
			if (validIds.size === 0 && validations.length > 0) {
				// Validator said nothing is valid — keep high-confidence issues anyway
				return issues.filter(i => i.confidence >= 0.85);
			}

			return issues.filter(i => validIds.has(i.id) || i.confidence >= 0.9);
		} catch {
			return issues; // On error, keep all issues
		}
	}

	private async _generateAutofixes(session: SentinelReviewSession, issues: SentinelIssue[]): Promise<void> {
		const highConfidenceIssues = issues.filter(i =>
			i.confidence >= 0.8 && (i.severity === 'blocker' || i.severity === 'critical')
		);

		for (const issue of highConfidenceIssues.slice(0, 5)) {
			if (this._isAborted()) break;
			await this.generateFix(issue.id);
		}
	}

	private _parseAndFilterIssues(llmResult: string, threshold: number): SentinelIssue[] {
		const parsed = tryParseJSON<Array<any>>(llmResult);
		if (!parsed || !Array.isArray(parsed)) return [];

		const issues: SentinelIssue[] = [];
		for (const raw of parsed) {
			if ((raw.confidence || 0) < threshold) continue;
			const issue = this._rawToIssue(raw);
			if (issue) issues.push(issue);
		}
		return issues;
	}

	private _rawToIssue(raw: any): SentinelIssue | null {
		if (!raw || typeof raw !== 'object') return null;
		if (!raw.file || !raw.message) return null;

		const folders = this._workspaceContextService.getWorkspace().folders;
		const cwd = folders[0]?.uri.fsPath || '';
		const filePath = raw.file.startsWith('/') ? raw.file : `${cwd}/${raw.file}`;

		const validSeverities = new Set(['blocker', 'critical', 'warning', 'info']);
		const severity = validSeverities.has(raw.severity) ? raw.severity as SentinelSeverity : 'warning';

		return {
			id: generateUuid(),
			uri: URI.file(filePath),
			startLine: typeof raw.startLine === 'number' ? Math.max(1, raw.startLine) : 1,
			endLine: typeof raw.endLine === 'number' ? Math.max(1, raw.endLine) : (typeof raw.startLine === 'number' ? raw.startLine : 1),
			severity,
			category: (raw.category as SentinelCategory) || 'code_quality',
			message: String(raw.message),
			suggestion: String(raw.suggestion || ''),
			codeSnippet: String(raw.codeSnippet || ''),
			confidence: typeof raw.confidence === 'number' ? Math.max(0, Math.min(1, raw.confidence)) : 0.7,
			cweId: raw.cweId && raw.cweId !== 'null' ? String(raw.cweId) : undefined,
			dismissed: false,
			fixApplied: false,
		};
	}

	private _sendLLMRequest(systemPrompt: string, userMessage: string): Promise<string> {
		return new Promise<string>((resolve) => {
			let fullText = '';
			const modelSelection = this._settingsService.state.modelSelectionOfFeature['Chat'];

			// Timeout: resolve with empty after 120 seconds
			const timeout = setTimeout(() => resolve('[]'), 120000);

			const requestId = this._llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				messages: [{ role: 'user', content: userMessage }],
				separateSystemMessage: systemPrompt,
				chatMode: 'ask',
				onText: ({ fullText: text }: { fullText: string }) => {
					fullText = text;
				},
				onFinalMessage: () => {
					clearTimeout(timeout);
					resolve(fullText);
				},
				onError: () => {
					clearTimeout(timeout);
					resolve('[]');
				},
				onAbort: () => {
					clearTimeout(timeout);
					resolve('[]');
				},
				logging: { loggingName: 'Sentinel Review' },
				modelSelection,
				modelSelectionOptions: undefined,
				overridesOfModel: undefined,
			});

			this._currentRequestId = requestId;
		});
	}

	private _generateSummary(issues: SentinelIssue[]): string {
		const active = issues.filter(i => !i.dismissed);
		if (active.length === 0) return 'No issues found. Code looks good!';

		const blockers = active.filter(i => i.severity === 'blocker').length;
		const critical = active.filter(i => i.severity === 'critical').length;
		const warnings = active.filter(i => i.severity === 'warning').length;
		const info = active.filter(i => i.severity === 'info').length;

		const parts: string[] = [];
		if (blockers > 0) parts.push(`${blockers} blocker(s)`);
		if (critical > 0) parts.push(`${critical} critical`);
		if (warnings > 0) parts.push(`${warnings} warning(s)`);
		if (info > 0) parts.push(`${info} info`);

		return `Found ${active.length} issue(s): ${parts.join(', ')}.`;
	}
}

registerSingleton(ISentinelService, SentinelService, InstantiationType.Delayed);
