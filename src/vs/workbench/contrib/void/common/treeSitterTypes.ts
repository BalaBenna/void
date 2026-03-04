/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export interface ASTChunk {
	type: 'function' | 'class' | 'method' | 'interface' | 'type' | 'import' | 'export' | 'block' | 'other';
	name: string | null;
	content: string;
	startLine: number;
	endLine: number;
	language: string;
}

export interface TreeSitterChunkRequest {
	filePath: string;
	content: string;
	language: string;
}

export interface TreeSitterChunkResponse {
	chunks: ASTChunk[];
	success: boolean;
	error?: string;
}
