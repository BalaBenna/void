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
	chunkType?: 'line-based' | 'ast-aware'; // tree-sitter support
}

export interface FileHashEntry {
	contentHash: string;
	lastIndexed: number;
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

// Payload types for backend sync API
export interface EmbeddingChunkPayload {
	chunkId: string;
	fileUri: string;
	content: string;
	symbolName?: string;
	language?: string;
	startLine?: number;
	endLine?: number;
}

export interface EmbeddingUpsertRequest {
	workspaceId: string;
	chunks: EmbeddingChunkPayload[];
}

export interface EmbeddingStoredChunk {
	chunk_id: string;
	file_uri: string;
	content: string;
	symbol_name: string | null;
	language: string | null;
	start_line: number | null;
	end_line: number | null;
}
