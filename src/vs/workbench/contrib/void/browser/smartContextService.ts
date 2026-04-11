/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IEmbeddingsService } from './embeddingsService.js';
import { SearchResult } from '../common/embeddingsTypes.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { EditorResourceAccessor } from '../../../common/editor.js';
import { IMemoryService } from './memoryService.js';

export interface ISmartContextService {
	readonly _serviceBrand: undefined;
	getRelevantContext(userMessage: string, maxTokens?: number): string;
}

export const ISmartContextService = createDecorator<ISmartContextService>('smartContextService');

const DEFAULT_MAX_TOKENS = 4000;
const CHARS_PER_TOKEN = 4;

// Signal weights for multi-signal fusion
const WEIGHT_TEXT = 0.45;      // BM25 + vector search score
const WEIGHT_RECENCY = 0.20;   // Recently edited files
const WEIGHT_STRUCTURE = 0.15; // Same directory as active file
const WEIGHT_MEMORY = 0.20;    // Memory relevance

class SmartContextService extends Disposable implements ISmartContextService {
	declare readonly _serviceBrand: undefined;

	// Track recently edited files for recency scoring
	private _recentEdits: Map<string, number> = new Map(); // uri -> timestamp
	private _maxRecentEdits = 50;

	constructor(
		@IEmbeddingsService private readonly _embeddingsService: IEmbeddingsService,
		@IEditorService private readonly _editorService: IEditorService,
		@IMemoryService private readonly _memoryService: IMemoryService,
	) {
		super();

		// Track editor changes for recency
		this._register(this._editorService.onDidActiveEditorChange(() => {
			const input = this._editorService.activeEditor;
			if (input) {
				const resource = EditorResourceAccessor.getOriginalUri(input);
				if (resource) {
					this._recentEdits.set(resource.toString(), Date.now());
					// Evict oldest entries
					if (this._recentEdits.size > this._maxRecentEdits) {
						const oldest = [...this._recentEdits.entries()]
							.sort((a, b) => a[1] - b[1])
							.slice(0, this._recentEdits.size - this._maxRecentEdits);
						for (const [key] of oldest) this._recentEdits.delete(key);
					}
				}
			}
		}));
	}

	getRelevantContext(userMessage: string, maxTokens: number = DEFAULT_MAX_TOKENS): string {
		if (!userMessage.trim()) return '';

		// Extract key terms from user message
		const keyTerms = this._extractKeyTerms(userMessage);
		if (keyTerms.length === 0) return '';

		// Signal 1: BM25 + vector search (primary)
		const searchQuery = keyTerms.join(' ');
		const searchResults = this._embeddingsService.searchWithDependencies(searchQuery, null, 15);
		if (searchResults.length === 0) return '';

		// Normalize text scores
		const maxScore = Math.max(...searchResults.map(r => r.score), 0.001);

		// Get active file for structural scoring
		const activeEditor = this._editorService.activeEditor;
		const activeUri = activeEditor ? EditorResourceAccessor.getOriginalUri(activeEditor) : undefined;
		const activeDir = activeUri ? activeUri.path.split('/').slice(0, -1).join('/') : '';

		// Get memory keywords for memory scoring
		const memoryKeywords = this._getMemoryKeywords(userMessage);

		// Multi-signal scoring
		const scored = searchResults.map(result => {
			const textScore = result.score / maxScore;
			const recencyScore = this._recencyScore(result.uri.toString());
			const structureScore = this._structureScore(result.uri.path, activeDir);
			const memoryScore = this._memoryScore(result.content, memoryKeywords);

			const combined = textScore * WEIGHT_TEXT
				+ recencyScore * WEIGHT_RECENCY
				+ structureScore * WEIGHT_STRUCTURE
				+ memoryScore * WEIGHT_MEMORY;

			return { result, score: combined };
		});

		// Sort by combined score
		scored.sort((a, b) => b.score - a.score);

		// Build context string respecting token budget
		const maxChars = maxTokens * CHARS_PER_TOKEN;
		let context = '';
		const includedFiles = new Set<string>();

		for (const { result } of scored) {
			const snippet = this._formatResult(result);
			if (context.length + snippet.length > maxChars) break;

			// Avoid duplicate file sections
			const fileKey = `${result.uri.fsPath}:${result.startLine}`;
			if (includedFiles.has(fileKey)) continue;
			includedFiles.add(fileKey);

			context += snippet + '\n---\n';
		}

		return context.trim();
	}

	private _recencyScore(uriStr: string): number {
		const lastEdit = this._recentEdits.get(uriStr);
		if (!lastEdit) return 0;

		// Score decays with time — full score within 5 minutes, 0 after 1 hour
		const ageMs = Date.now() - lastEdit;
		const fiveMinutes = 5 * 60 * 1000;
		const oneHour = 60 * 60 * 1000;

		if (ageMs < fiveMinutes) return 1;
		if (ageMs > oneHour) return 0;
		return 1 - (ageMs - fiveMinutes) / (oneHour - fiveMinutes);
	}

	private _structureScore(filePath: string, activeDir: string): number {
		if (!activeDir) return 0;
		const fileDir = filePath.split('/').slice(0, -1).join('/');
		if (fileDir === activeDir) return 1;       // same directory
		if (fileDir.startsWith(activeDir)) return 0.5; // subdirectory
		if (activeDir.startsWith(fileDir)) return 0.3; // parent directory
		return 0;
	}

	private _getMemoryKeywords(userMessage: string): Set<string> {
		// Fire-and-forget async query; use cached approach
		// We cache memory terms for sync access
		this._memoryService.getRelevantMemories(userMessage, 5).then(memories => {
			for (const m of memories) {
				const tokens = m.content.toLowerCase().replace(/[^a-z0-9_]/g, ' ').split(/\s+/).filter(t => t.length > 3);
				for (const t of tokens) this._cachedMemoryKeywords.add(t);
			}
		});
		// Use cached keywords from previous call
		return this._cachedMemoryKeywords;
	}

	private _cachedMemoryKeywords = new Set<string>();

	private _memoryScore(content: string, memoryKeywords: Set<string>): number {
		if (memoryKeywords.size === 0) return 0;
		const contentTokens = content.toLowerCase().replace(/[^a-z0-9_]/g, ' ').split(/\s+/);
		let matches = 0;
		for (const token of contentTokens) {
			if (memoryKeywords.has(token)) matches++;
		}
		return Math.min(matches / 5, 1); // Normalize: 5+ matches = full score
	}

	private _extractKeyTerms(message: string): string[] {
		// Remove common question words and filler
		const stopWords = new Set([
			'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
			'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
			'should', 'may', 'might', 'can', 'shall', 'i', 'you', 'we', 'they',
			'he', 'she', 'it', 'this', 'that', 'these', 'those', 'what', 'which',
			'who', 'where', 'when', 'how', 'why', 'not', 'no', 'and', 'or', 'but',
			'if', 'then', 'else', 'for', 'with', 'from', 'to', 'in', 'on', 'at',
			'of', 'by', 'about', 'please', 'help', 'me', 'my', 'want', 'need',
			'like', 'make', 'change', 'fix', 'add', 'remove', 'update', 'create',
		]);

		// Split by whitespace and punctuation, preserve code-like tokens
		const tokens = message
			.replace(/[`'"(){}[\]<>]/g, ' ')
			.split(/\s+/)
			.filter(t => t.length > 2)
			.filter(t => !stopWords.has(t.toLowerCase()));

		// Prioritize code-like tokens (camelCase, snake_case, dotted paths)
		const codeTokens = tokens.filter(t => /[._A-Z]/.test(t) || /^[a-z]+[A-Z]/.test(t));
		const otherTokens = tokens.filter(t => !codeTokens.includes(t));

		return [...codeTokens, ...otherTokens].slice(0, 10);
	}

	private _formatResult(result: SearchResult): string {
		const header = result.symbolName
			? `${result.uri.fsPath} (${result.symbolName}, lines ${result.startLine}-${result.endLine})`
			: `${result.uri.fsPath} (lines ${result.startLine}-${result.endLine})`;

		return `${header}:\n\`\`\`\n${result.content}\n\`\`\``;
	}
}

registerSingleton(ISmartContextService, SmartContextService, InstantiationType.Eager);
