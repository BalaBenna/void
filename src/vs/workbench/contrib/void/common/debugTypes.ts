/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export interface BlameInfo {
	file: string;
	line: number;
	author: string;
	commit: string;
	date: string;
	summary: string;
}

export interface DebugErrorSource {
	type: 'lsp' | 'terminal' | 'test_runner' | 'build';
	errors: DebugError[];
}

export interface DebugError {
	message: string;
	file?: string;
	line?: number;
	column?: number;
	severity: 'error' | 'warning';
	code?: string;
	source: string;
}

export interface DebugAnalysis {
	errors: DebugError[];
	blameInfo: BlameInfo[];
	rootCause?: string;
	suggestedFix?: string;
	confidence: number; // 0–1
}

export interface DebugSourceConfig {
	includeLSP: boolean;
	includeTerminal: boolean;
	includeTestRunner: boolean;
	includeBuild: boolean;
}

export const defaultDebugSourceConfig: DebugSourceConfig = {
	includeLSP: true,
	includeTerminal: true,
	includeTestRunner: true,
	includeBuild: true,
};
