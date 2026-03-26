/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { generateUuid } from '../../../../base/common/uuid.js';

import { Memory, MemoryStore, MemoryType } from '../common/memoryTypes.js';
import { IvoidSettingsService } from '../common/voidSettingsService.js';


export interface IMemoryService {
	readonly _serviceBrand: undefined;

	addMemory(opts: { type: MemoryType; content: string; context: string; tags: string[] }): Promise<Memory>;
	removeMemory(id: string): Promise<void>;
	queryMemories(query: string, maxResults?: number): Memory[];
	getAllMemories(): Memory[];
	getRelevantMemories(userMessage: string, maxResults?: number): Memory[];
	clearAll(): Promise<void>;

	/**
	 * Extract memories from a conversation summary.
	 * Parses structured JSON output from the LLM.
	 */
	extractAndStoreFromSummary(summaryJson: string): Promise<Memory[]>;
}

export const IMemoryService = createDecorator<IMemoryService>('voidMemoryService');


// Simple tokenizer for keyword matching
function tokenize(text: string): string[] {
	return text.toLowerCase().replace(/[^a-z0-9_]/g, ' ').split(/\s+/).filter(t => t.length > 2)
}

// Stop words to filter out common words
const STOP_WORDS = new Set([
	'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her',
	'was', 'one', 'our', 'out', 'has', 'have', 'from', 'this', 'that', 'with',
	'they', 'been', 'said', 'each', 'which', 'their', 'will', 'other', 'about',
	'them', 'then', 'than', 'into', 'could', 'some', 'what', 'when', 'where',
	'use', 'used', 'using', 'file', 'code', 'should', 'would',
])

class MemoryService extends Disposable implements IMemoryService {
	declare readonly _serviceBrand: undefined;

	private _memoryStore: MemoryStore = { version: 1, memories: [] };
	private _loaded = false;

	constructor(
		@IFileService private readonly _fileService: IFileService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IvoidSettingsService private readonly _settingsService: IvoidSettingsService,
	) {
		super();
	}

	private _getMemoryFileUri(): URI | null {
		const folders = this._workspaceContextService.getWorkspace().folders;
		if (folders.length === 0) return null;
		return URI.joinPath(folders[0].uri, '.void', 'memory.json');
	}

	private async _ensureLoaded(): Promise<void> {
		if (this._loaded) return;
		this._loaded = true;

		const uri = this._getMemoryFileUri();
		if (!uri) return;

		try {
			const content = await this._fileService.readFile(uri);
			const parsed = JSON.parse(content.value.toString());
			if (parsed && parsed.version && Array.isArray(parsed.memories)) {
				this._memoryStore = parsed;
			}
		} catch {
			// File doesn't exist yet or is invalid — start fresh
			this._memoryStore = { version: 1, memories: [] };
		}
	}

	private async _persist(): Promise<void> {
		const uri = this._getMemoryFileUri();
		if (!uri) return;

		try {
			// Ensure .void directory exists
			const voidDir = URI.joinPath(uri, '..');
			try { await this._fileService.resolve(voidDir); }
			catch { await this._fileService.createFolder(voidDir); }

			const json = JSON.stringify(this._memoryStore, null, 2);
			await this._fileService.writeFile(uri, VSBuffer.fromString(json));
		} catch {
			// Silently fail — memory is not critical
		}
	}

	async addMemory(opts: { type: MemoryType; content: string; context: string; tags: string[] }): Promise<Memory> {
		await this._ensureLoaded();

		const config = this._settingsService.state.globalSettings.memoryConfig;

		const memory: Memory = {
			id: generateUuid(),
			type: opts.type,
			content: opts.content,
			context: opts.context,
			tags: opts.tags,
			createdAt: Date.now(),
			lastAccessedAt: Date.now(),
			accessCount: 0,
		};

		this._memoryStore.memories.push(memory);

		// Enforce max memories limit — remove oldest by last accessed
		if (this._memoryStore.memories.length > config.maxMemories) {
			this._memoryStore.memories.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
			this._memoryStore.memories = this._memoryStore.memories.slice(0, config.maxMemories);
		}

		await this._persist();
		return memory;
	}

	async removeMemory(id: string): Promise<void> {
		await this._ensureLoaded();
		this._memoryStore.memories = this._memoryStore.memories.filter(m => m.id !== id);
		await this._persist();
	}

	getAllMemories(): Memory[] {
		return this._memoryStore.memories;
	}

	queryMemories(query: string, maxResults: number = 5): Memory[] {
		const queryTokens = tokenize(query).filter(t => !STOP_WORDS.has(t));
		if (queryTokens.length === 0) return [];

		const scored = this._memoryStore.memories.map(memory => {
			const memoryTokens = new Set(tokenize(memory.content + ' ' + memory.tags.join(' ')));
			let matchCount = 0;
			for (const qt of queryTokens) {
				for (const mt of memoryTokens) {
					if (mt.includes(qt) || qt.includes(mt)) {
						matchCount++;
						break;
					}
				}
			}
			const score = matchCount / queryTokens.length;
			return { memory, score };
		}).filter(s => s.score > 0);

		scored.sort((a, b) => b.score - a.score);

		// Update access counts
		const results = scored.slice(0, maxResults).map(s => {
			s.memory.lastAccessedAt = Date.now();
			s.memory.accessCount++;
			return s.memory;
		});

		return results;
	}

	getRelevantMemories(userMessage: string, maxResults: number = 5): Memory[] {
		return this.queryMemories(userMessage, maxResults);
	}

	async clearAll(): Promise<void> {
		this._memoryStore = { version: 1, memories: [] };
		await this._persist();
	}

	async extractAndStoreFromSummary(summaryJson: string): Promise<Memory[]> {
		const added: Memory[] = [];

		try {
			// Try to parse as JSON array of memory items
			let items: any[];

			// Handle case where LLM wraps in markdown code block
			let cleaned = summaryJson.trim();
			if (cleaned.startsWith('```')) {
				cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
			}

			const parsed = JSON.parse(cleaned);
			items = Array.isArray(parsed) ? parsed : (parsed.memories ?? [parsed]);

			for (const item of items) {
				if (!item.content || typeof item.content !== 'string') continue;

				const type: MemoryType = ['project_fact', 'decision', 'pattern', 'preference'].includes(item.type)
					? item.type
					: 'project_fact';

				const memory = await this.addMemory({
					type,
					content: item.content,
					context: item.context ?? '',
					tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
				});
				added.push(memory);
			}
		} catch {
			// If parsing fails, store the raw text as a single memory
			if (summaryJson.trim().length > 10) {
				const memory = await this.addMemory({
					type: 'project_fact',
					content: summaryJson.trim(),
					context: 'auto-extracted from conversation',
					tags: [],
				});
				added.push(memory);
			}
		}

		return added;
	}
}

registerSingleton(IMemoryService, MemoryService, InstantiationType.Delayed);
