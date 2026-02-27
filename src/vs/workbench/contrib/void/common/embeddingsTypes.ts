/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';

export interface CodeChunk {
	id: string;
	uri: URI;
	startLine: number;
	endLine: number;
	content: string;
	symbolName: string | null;
	language: string;
	mtime: number;
}

export interface SearchResult {
	uri: URI;
	startLine: number;
	endLine: number;
	content: string;
	score: number;
	symbolName: string | null;
}

export interface IndexStatus {
	state: 'idle' | 'indexing' | 'indexed';
	totalFiles: number;
	indexedFiles: number;
	progress: number; // 0-100
}
