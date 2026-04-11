/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export interface CommitInfo {
	sha: string;
	shortSha: string;
	author: string;
	date: string;
	message: string;
	files: string[];
}

export interface FileEvolution {
	filePath: string;
	commits: CommitInfo[];
	summary: string; // LLM-generated summary of how the file evolved
}

export interface TimeTravelQuery {
	type: 'when_added' | 'who_modified' | 'file_at_time' | 'evolution';
	subject: string;     // file, feature, or module name
	timeRange?: string;  // "2 weeks ago", specific date, etc.
}
