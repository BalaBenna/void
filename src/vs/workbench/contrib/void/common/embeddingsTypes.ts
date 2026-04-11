/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

// Symbol kinds for search ranking (mirrors common SymbolKind values)
export type ChunkSymbolKind = 'function' | 'class' | 'interface' | 'type' | 'method' | 'variable' | 'enum' | 'struct' | 'trait' | 'preamble' | null;

export interface CodeChunk {
	id: string;
	uri: URI;
	startLine: number;
	endLine: number;
	content: string;
	symbolName: string | null;
	symbolKind: ChunkSymbolKind;
	language: string;
	mtime: number;
	embedding: number[] | null; // vector embedding, null if not generated
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

// Embedding generation types
export interface EmbeddingRequest {
	texts: string[];
	model: string;
	provider: 'openAI' | 'local' | 'none';
}

export interface EmbeddingResponse {
	embeddings: number[][];
}

// IPC types for embedding channel
export interface IEmbeddingGenerationService {
	readonly _serviceBrand: undefined;
	generateEmbeddings(request: EmbeddingRequest, apiKey: string): Promise<EmbeddingResponse>;
}

export const IEmbeddingGenerationService = createDecorator<IEmbeddingGenerationService>('voidEmbeddingGenerationService');

// Persistent index snapshot for disk serialization
export interface IndexSnapshot {
	version: number;
	timestamp: number;
	chunks: SerializedCodeChunk[];
	fileMtimes: Record<string, number>; // uri.toString() -> mtime
}

// Serializable version of CodeChunk (URI serialized as string)
export interface SerializedCodeChunk {
	id: string;
	uriStr: string;
	startLine: number;
	endLine: number;
	content: string;
	symbolName: string | null;
	symbolKind: ChunkSymbolKind;
	language: string;
	mtime: number;
	// Note: embeddings are NOT persisted (too large, regenerated on demand)
}
