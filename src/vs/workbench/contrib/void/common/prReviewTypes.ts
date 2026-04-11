/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';

export type IssueSeverity = 'critical' | 'warning' | 'info';

export type IssueCategory =
	| 'null_pointer'
	| 'race_condition'
	| 'missing_error_handling'
	| 'security'
	| 'logic_error'
	| 'performance'
	| 'code_quality'
	| 'type_safety';

export interface ReviewIssue {
	id: string;
	uri: URI;
	startLine: number;
	endLine: number;
	severity: IssueSeverity;
	category: IssueCategory;
	message: string;
	suggestion: string;
	codeSnippet: string;
}

export interface ReviewResult {
	issues: ReviewIssue[];
	summary: string;
	reviewedFiles: number;
	timestamp: number;
}

export interface ReviewRequest {
	mode: 'changed_files' | 'branch_diff' | 'specific_files';
	fileUris?: URI[];
}
