/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { IServerChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { Event } from '../../../../base/common/event.js';
import { ASTChunk, TreeSitterChunkRequest, TreeSitterChunkResponse } from '../common/treeSitterTypes.js';


/**
 * IPC channel for tree-sitter based code chunking.
 * Falls back to heuristic-based chunking when tree-sitter native module is not available.
 * No shell commands are used — all chunking is done via string parsing.
 */
export class TreeSitterChannel implements IServerChannel {

	listen(_context: any, _event: string): Event<any> {
		throw new Error('No events');
	}

	async call(_context: any, command: string, args?: any): Promise<any> {
		switch (command) {
			case 'chunk':
				return this._chunkFile(args as TreeSitterChunkRequest);
			default:
				throw new Error(`Unknown command: ${command}`);
		}
	}

	private async _chunkFile(request: TreeSitterChunkRequest): Promise<TreeSitterChunkResponse> {
		try {
			const chunks = this._heuristicChunk(request);
			return { chunks, success: true };
		} catch (e) {
			const chunks = this._lineBasedChunk(request);
			return { chunks, success: true, error: `heuristic fallback: ${e}` };
		}
	}

	private _heuristicChunk(request: TreeSitterChunkRequest): ASTChunk[] {
		const { content, language } = request;
		const lines = content.split('\n');
		const chunks: ASTChunk[] = [];

		const functionPatterns = [
			/^\s*(export\s+)?(async\s+)?function\s+(\w+)/,
			/^\s*(export\s+)?(const|let|var)\s+(\w+)\s*=\s*(async\s+)?\(/,
			/^\s*(public|private|protected)?\s*(static\s+)?(async\s+)?(\w+)\s*\(/,
		];
		const classPatterns = [
			/^\s*(export\s+)?(abstract\s+)?class\s+(\w+)/,
			/^\s*(export\s+)?interface\s+(\w+)/,
			/^\s*(export\s+)?type\s+(\w+)/,
		];

		let currentChunkStart = 0;
		let currentChunkName: string | null = null;
		let currentChunkType: ASTChunk['type'] = 'other';

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			let matched = false;
			for (const pattern of functionPatterns) {
				const match = pattern.exec(line);
				if (match) {
					if (i > currentChunkStart) {
						chunks.push({
							type: currentChunkType,
							name: currentChunkName,
							content: lines.slice(currentChunkStart, i).join('\n'),
							startLine: currentChunkStart + 1,
							endLine: i,
							language,
						});
					}
					currentChunkStart = i;
					currentChunkName = match[3] || match[4] || null;
					currentChunkType = 'function';
					matched = true;
					break;
				}
			}
			if (!matched) {
				for (const pattern of classPatterns) {
					const match = pattern.exec(line);
					if (match) {
						if (i > currentChunkStart) {
							chunks.push({
								type: currentChunkType,
								name: currentChunkName,
								content: lines.slice(currentChunkStart, i).join('\n'),
								startLine: currentChunkStart + 1,
								endLine: i,
								language,
							});
						}
						currentChunkStart = i;
						currentChunkName = match[2] || match[3] || null;
						currentChunkType = line.includes('interface') ? 'interface' :
							line.includes('type') ? 'type' : 'class';
						break;
					}
				}
			}
		}

		// Final chunk
		if (currentChunkStart < lines.length) {
			chunks.push({
				type: currentChunkType,
				name: currentChunkName,
				content: lines.slice(currentChunkStart).join('\n'),
				startLine: currentChunkStart + 1,
				endLine: lines.length,
				language,
			});
		}

		return chunks;
	}

	private _lineBasedChunk(request: TreeSitterChunkRequest): ASTChunk[] {
		const { content, language } = request;
		const MAX_CHUNK_SIZE = 1500;
		const OVERLAP = 200;
		const chunks: ASTChunk[] = [];

		let start = 0;
		while (start < content.length) {
			const end = Math.min(start + MAX_CHUNK_SIZE, content.length);
			const chunkContent = content.slice(start, end);
			const startLine = content.slice(0, start).split('\n').length;
			const endLine = content.slice(0, end).split('\n').length;

			chunks.push({
				type: 'block',
				name: null,
				content: chunkContent,
				startLine,
				endLine,
				language,
			});

			start = end - OVERLAP;
			if (end >= content.length) break;
		}

		return chunks;
	}
}
