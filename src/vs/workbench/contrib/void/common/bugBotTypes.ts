/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export type BugSeverity = 'critical' | 'high' | 'medium' | 'low' | 'enhancement';

export interface TriagedIssue {
	number: number;
	title: string;
	body: string;
	labels: string[];
	severity: BugSeverity;
	relevantFiles: string[];
	suggestedFix: string | null;
	autoFixable: boolean;
	complexity: 'trivial' | 'simple' | 'moderate' | 'complex';
}

export interface BugBotConfig {
	enabled: boolean;
	autoFix: boolean;          // auto-fix trivial/simple issues
	maxIssuesToTriage: number;  // per batch
}

export const defaultBugBotConfig: BugBotConfig = {
	enabled: false,
	autoFix: false,
	maxIssuesToTriage: 10,
};
