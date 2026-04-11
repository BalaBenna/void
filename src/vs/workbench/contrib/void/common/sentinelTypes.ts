/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IssueCategory, IssueSeverity, ReviewIssue, ReviewRequest, ReviewResult } from './prReviewTypes.js';

// Extended severity adds 'blocker' above 'critical'
export type SentinelSeverity = 'blocker' | IssueSeverity;

// Extended categories with security-focused additions
export type SentinelCategory = IssueCategory
	| 'injection'
	| 'xss'
	| 'auth_bypass'
	| 'secrets_exposure'
	| 'dependency_vulnerability'
	| 'data_leak'
	| 'resource_leak'
	| 'concurrency'
	| 'api_misuse'
	| 'dead_code'
	| 'complexity';

// Review modes
export type ReviewMode = 'quick' | 'deep' | 'security' | 'compliance';

// Enhanced issue with autofix, confidence, cross-file context
export interface SentinelIssue extends Omit<ReviewIssue, 'severity' | 'category'> {
	severity: SentinelSeverity;
	category: SentinelCategory;
	confidence: number;           // 0-1, default threshold 0.7
	autofix?: SentinelAutofix;
	relatedFiles?: URI[];
	ruleSource?: string;          // which custom rule flagged this
	cweId?: string;               // CWE reference for security issues
	dismissed?: boolean;
	dismissedReason?: string;
	fixApplied?: boolean;
}

export interface SentinelAutofix {
	description: string;
	edits: SentinelEdit[];
	confidence: number;
}

export interface SentinelEdit {
	uri: URI;
	range: { startLine: number; startColumn: number; endLine: number; endColumn: number };
	newText: string;
}

// Review session tracking
export interface SentinelReviewSession {
	id: string;
	request: SentinelReviewRequest;
	result: SentinelReviewResult | null;
	status: 'pending' | 'analyzing' | 'complete' | 'error' | 'cancelled';
	startedAt: number;
	completedAt?: number;
	progress: SentinelProgress;
}

export interface SentinelProgress {
	phase: 'diff' | 'analysis' | 'cross-file' | 'security' | 'rules' | 'autofix' | 'complete';
	filesAnalyzed: number;
	totalFiles: number;
	issuesFound: number;
	currentFile?: string;
}

export interface SentinelReviewRequest extends ReviewRequest {
	reviewMode: ReviewMode;
	customRules?: string[];
	confidenceThreshold?: number;
	targetBranch?: string;
}

export interface SentinelReviewResult extends Omit<ReviewResult, 'issues'> {
	issues: SentinelIssue[];
	securityScore: number;        // 0-100
	qualityScore: number;         // 0-100
	sessionId: string;
	mode: ReviewMode;
	rulesApplied: string[];
}

// Custom review rule (stored in .void/sentinel/rules/)
export interface SentinelRule {
	name: string;
	description: string;
	globs: string[];
	severity: SentinelSeverity;
	category: SentinelCategory;
	prompt: string;
	enabled: boolean;
}

// Review history entry
export interface SentinelHistoryEntry {
	sessionId: string;
	timestamp: number;
	branch: string;
	mode: ReviewMode;
	issueCount: number;
	criticalCount: number;
	fixedCount: number;
	dismissedCount: number;
	filesReviewed: number;
	duration: number;
}
