/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';

import { CodeChunk, IndexStatus, SearchResult } from '../common/embeddingsTypes.js';
import { IvoidSettingsService } from '../common/voidSettingsService.js';
import { matchGlob } from '../common/frontmatterParser.js';


// Chunk size limits
const MAX_CHUNK_CHARS = 1500;
const CHUNK_OVERLAP = 200;

// File extensions to index
const INDEXABLE_EXTENSIONS = new Set([
	'.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.c', '.cpp', '.h', '.hpp',
	'.cs', '.rb', '.php', '.swift', '.kt', '.scala', '.vue', '.svelte', '.html', '.css',
	'.scss', '.less', '.json', '.yaml', '.yml', '.toml', '.md', '.sh', '.bash', '.zsh',
]);

// Directories to skip
const SKIP_DIRS = new Set([
	'node_modules', '.git', '.void', 'dist', 'build', 'out', '.next', '__pycache__',
	'vendor', '.venv', 'venv', 'target', '.gradle', 'coverage', '.cache',
]);

export interface IEmbeddingsService {
	readonly _serviceBrand: undefined;

	onDidChangeIndexStatus: Event<IndexStatus>;
	indexWorkspace(): Promise<void>;
	indexFile(uri: URI): Promise<void>;
	removeFile(uri: URI): void;
	search(query: string, targetDirectory: string | null, maxResults: number): SearchResult[];
	isIndexed(): boolean;
	getIndexedFileCount(): number;
	getIndexStatus(): IndexStatus;
	reindex(): Promise<void>;
}

export const IEmbeddingsService = createDecorator<IEmbeddingsService>('voidEmbeddingsService');


// Tokenize text into lowercase words
function tokenize(text: string): string[] {
	return text.toLowerCase().replace(/[^a-z0-9_]/g, ' ').split(/\s+/).filter(t => t.length > 1)
}

// Simple language detection from extension
function languageFromExt(ext: string): string {
	const map: Record<string, string> = {
		'.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
		'.py': 'python', '.java': 'java', '.go': 'go', '.rs': 'rust', '.c': 'c', '.cpp': 'cpp',
		'.cs': 'csharp', '.rb': 'ruby', '.php': 'php', '.swift': 'swift', '.kt': 'kotlin',
		'.scala': 'scala', '.vue': 'vue', '.svelte': 'svelte', '.html': 'html', '.css': 'css',
		'.md': 'markdown', '.sh': 'shell', '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml',
	}
	return map[ext] ?? 'unknown'
}


class EmbeddingsService extends Disposable implements IEmbeddingsService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeIndexStatus = new Emitter<IndexStatus>();
	readonly onDidChangeIndexStatus: Event<IndexStatus> = this._onDidChangeIndexStatus.event;

	// In-memory chunk index
	private _chunks: Map<string, CodeChunk> = new Map(); // chunkId -> chunk
	private _chunksByUri: Map<string, Set<string>> = new Map(); // uri.toString() -> chunkIds

	// Inverted index for BM25 search: term -> Set<chunkId>
	private _invertedIndex: Map<string, Set<string>> = new Map();

	// Document frequency for BM25
	private _totalChunks = 0;
	private _avgChunkLength = 0;

	private _indexed = false;

	// .voidignore patterns
	private _voidignorePatterns: string[] = [];

	// Progress tracking
	private _indexState: IndexStatus['state'] = 'idle';
	private _totalFiles = 0;
	private _indexedFiles = 0;

	constructor(
		@IFileService private readonly _fileService: IFileService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IvoidSettingsService private readonly _settingsService: IvoidSettingsService,
	) {
		super();

		// Load .voidignore
		this._loadvoidignore();

		// Watch for file changes and re-index
		this._register(this._fileService.onDidFilesChange(e => {
			// Watch for .voidignore changes
			const allChanged = [...e.rawAdded, ...e.rawUpdated, ...e.rawDeleted]
			if (allChanged.some(uri => uri.path.endsWith('.voidignore'))) {
				this._loadvoidignore()
			}

			if (!this._indexed) return
			if (!this._settingsService.state.globalSettings.embeddingsConfig.reindexOnSave) return

			for (const added of e.rawAdded) {
				if (this._shouldIndex(added)) this.indexFile(added)
			}
			for (const updated of e.rawUpdated) {
				if (this._shouldIndex(updated)) this.indexFile(updated)
			}
			for (const deleted of e.rawDeleted) {
				this.removeFile(deleted)
			}
		}))
	}

	private async _loadvoidignore(): Promise<void> {
		const patterns: string[] = []
		const folders = this._workspaceContextService.getWorkspace().folders
		for (const folder of folders) {
			try {
				const voidignoreUri = URI.joinPath(folder.uri, '.voidignore')
				const content = await this._fileService.readFile(voidignoreUri)
				const text = content.value.toString()
				for (const line of text.split('\n')) {
					const trimmed = line.trim()
					if (trimmed && !trimmed.startsWith('#')) {
						patterns.push(trimmed)
					}
				}
			} catch {
				// .voidignore doesn't exist
			}
		}
		this._voidignorePatterns = patterns
	}

	isIndexed(): boolean {
		return this._indexed
	}

	getIndexedFileCount(): number {
		return this._chunksByUri.size
	}

	private _shouldIndex(uri: URI): boolean {
		const path = uri.path
		const ext = path.substring(path.lastIndexOf('.'))
		if (!INDEXABLE_EXTENSIONS.has(ext)) return false

		// Check skip dirs
		const segments = path.split('/')
		for (const seg of segments) {
			if (SKIP_DIRS.has(seg)) return false
		}

		// Check .voidignore patterns
		for (const pattern of this._voidignorePatterns) {
			if (matchGlob(pattern, path)) return false
		}

		return true
	}

	getIndexStatus(): IndexStatus {
		return {
			state: this._indexState,
			totalFiles: this._totalFiles,
			indexedFiles: this._indexedFiles,
			progress: this._totalFiles > 0 ? Math.round((this._indexedFiles / this._totalFiles) * 100) : 0,
		}
	}

	private _emitStatus(): void {
		this._onDidChangeIndexStatus.fire(this.getIndexStatus())
	}

	async reindex(): Promise<void> {
		this._chunks.clear()
		this._chunksByUri.clear()
		this._invertedIndex.clear()
		this._indexed = false
		this._indexState = 'idle'
		this._totalFiles = 0
		this._indexedFiles = 0
		this._emitStatus()
		await this._loadvoidignore()
		await this.indexWorkspace()
	}

	async indexWorkspace(): Promise<void> {
		const folders = this._workspaceContextService.getWorkspace().folders
		if (folders.length === 0) return

		// Clear existing index
		this._chunks.clear()
		this._chunksByUri.clear()
		this._invertedIndex.clear()

		this._indexState = 'indexing'
		this._indexedFiles = 0

		// First, count total files to index for progress tracking
		this._totalFiles = 0
		for (const folder of folders) {
			this._totalFiles += await this._countIndexableFiles(folder.uri)
		}
		this._emitStatus()

		for (const folder of folders) {
			await this._indexDirectory(folder.uri)
		}

		this._rebuildStats()
		this._indexed = true
		this._indexState = 'indexed'
		this._emitStatus()
	}

	private async _countIndexableFiles(dirUri: URI): Promise<number> {
		let count = 0
		try {
			const stat = await this._fileService.resolve(dirUri)
			if (!stat.children) return 0
			for (const child of stat.children) {
				if (child.isDirectory) {
					if (SKIP_DIRS.has(child.name)) continue
					count += await this._countIndexableFiles(child.resource)
				} else {
					if (this._shouldIndex(child.resource)) count++
				}
			}
		} catch { /* skip */ }
		return count
	}

	private async _indexDirectory(dirUri: URI): Promise<void> {
		try {
			const stat = await this._fileService.resolve(dirUri)
			if (!stat.children) return

			for (const child of stat.children) {
				if (child.isDirectory) {
					const name = child.name
					if (SKIP_DIRS.has(name)) continue
					await this._indexDirectory(child.resource)
				} else {
					if (this._shouldIndex(child.resource)) {
						await this.indexFile(child.resource)
						this._indexedFiles++
						// Emit progress every 10 files to avoid excessive events
						if (this._indexedFiles % 10 === 0) {
							this._emitStatus()
						}
					}
				}
			}
		} catch {
			// Skip directories we can't read
		}
	}

	async indexFile(uri: URI): Promise<void> {
		// Remove old chunks for this file
		this.removeFile(uri)

		try {
			const content = await this._fileService.readFile(uri)
			const text = content.value.toString()
			if (text.length === 0) return

			const path = uri.path
			const ext = path.substring(path.lastIndexOf('.'))
			const language = languageFromExt(ext)
			const mtime = content.mtime ?? Date.now()

			const chunks = this._chunkFile(uri, text, language, mtime)
			const chunkIds = new Set<string>()

			for (const chunk of chunks) {
				this._chunks.set(chunk.id, chunk)
				chunkIds.add(chunk.id)

				// Add to inverted index
				const tokens = tokenize(chunk.content)
				const seen = new Set<string>()
				for (const token of tokens) {
					if (seen.has(token)) continue
					seen.add(token)
					let postings = this._invertedIndex.get(token)
					if (!postings) {
						postings = new Set()
						this._invertedIndex.set(token, postings)
					}
					postings.add(chunk.id)
				}
			}

			this._chunksByUri.set(uri.toString(), chunkIds)
			this._rebuildStats()
		} catch {
			// Skip files we can't read
		}
	}

	removeFile(uri: URI): void {
		const uriStr = uri.toString()
		const chunkIds = this._chunksByUri.get(uriStr)
		if (!chunkIds) return

		for (const chunkId of chunkIds) {
			const chunk = this._chunks.get(chunkId)
			if (chunk) {
				// Remove from inverted index
				const tokens = tokenize(chunk.content)
				const seen = new Set<string>()
				for (const token of tokens) {
					if (seen.has(token)) continue
					seen.add(token)
					this._invertedIndex.get(token)?.delete(chunkId)
				}
			}
			this._chunks.delete(chunkId)
		}

		this._chunksByUri.delete(uriStr)
		this._rebuildStats()
	}

	search(query: string, targetDirectory: string | null, maxResults: number): SearchResult[] {
		if (this._chunks.size === 0) return []

		const queryTokens = tokenize(query)
		if (queryTokens.length === 0) return []

		// BM25 parameters
		const k1 = 1.2
		const b = 0.75
		const N = this._totalChunks

		// Score each chunk
		const scores: Map<string, number> = new Map()

		for (const token of queryTokens) {
			const postings = this._invertedIndex.get(token)
			if (!postings) continue

			const df = postings.size
			const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1)

			for (const chunkId of postings) {
				const chunk = this._chunks.get(chunkId)
				if (!chunk) continue

				// Filter by target directory
				if (targetDirectory && !chunk.uri.path.includes(targetDirectory)) continue

				// Term frequency in this chunk
				const chunkTokens = tokenize(chunk.content)
				const tf = chunkTokens.filter(t => t === token).length

				// BM25 score
				const docLen = chunkTokens.length
				const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / this._avgChunkLength)))
				const score = idf * tfNorm

				scores.set(chunkId, (scores.get(chunkId) ?? 0) + score)
			}
		}

		// Boost chunks whose symbolName matches query tokens
		for (const [chunkId, score] of scores) {
			const chunk = this._chunks.get(chunkId)
			if (!chunk?.symbolName) continue
			const symbolTokens = tokenize(chunk.symbolName)
			const matchCount = queryTokens.filter(qt => symbolTokens.some(st => st.includes(qt) || qt.includes(st))).length
			if (matchCount > 0) {
				scores.set(chunkId, score * (1 + 0.5 * matchCount))
			}
		}

		// Sort and return top results
		const sorted = [...scores.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, maxResults)

		return sorted.map(([chunkId, score]) => {
			const chunk = this._chunks.get(chunkId)!
			return {
				uri: chunk.uri,
				startLine: chunk.startLine,
				endLine: chunk.endLine,
				content: chunk.content,
				score,
				symbolName: chunk.symbolName,
			}
		})
	}

	private _rebuildStats(): void {
		this._totalChunks = this._chunks.size
		if (this._totalChunks === 0) {
			this._avgChunkLength = 0
			return
		}
		let totalTokens = 0
		for (const chunk of this._chunks.values()) {
			totalTokens += tokenize(chunk.content).length
		}
		this._avgChunkLength = totalTokens / this._totalChunks
	}

	/**
	 * Chunk a file into searchable segments.
	 * Tries to split at function/class boundaries first, then falls back to fixed-size chunks.
	 */
	private _chunkFile(uri: URI, content: string, language: string, mtime: number): CodeChunk[] {
		const lines = content.split('\n')
		const chunks: CodeChunk[] = []

		// Try symbol-aware splitting
		const symbolChunks = this._splitAtSymbolBoundaries(lines, language)

		if (symbolChunks.length > 0) {
			for (const sc of symbolChunks) {
				const chunkContent = lines.slice(sc.startLine, sc.endLine + 1).join('\n')
				if (chunkContent.trim().length === 0) continue

				// If chunk is too large, split it further
				if (chunkContent.length > MAX_CHUNK_CHARS) {
					const subChunks = this._fixedSizeChunks(lines, sc.startLine, sc.endLine, MAX_CHUNK_CHARS, CHUNK_OVERLAP)
					for (const sub of subChunks) {
						chunks.push({
							id: generateUuid(),
							uri,
							startLine: sub.startLine,
							endLine: sub.endLine,
							content: sub.content,
							symbolName: sc.symbolName,
							language,
							mtime,
						})
					}
				} else {
					chunks.push({
						id: generateUuid(),
						uri,
						startLine: sc.startLine,
						endLine: sc.endLine,
						content: chunkContent,
						symbolName: sc.symbolName,
						language,
						mtime,
					})
				}
			}
		} else {
			// Fall back to fixed-size chunks
			const fixedChunks = this._fixedSizeChunks(lines, 0, lines.length - 1, MAX_CHUNK_CHARS, CHUNK_OVERLAP)
			for (const fc of fixedChunks) {
				chunks.push({
					id: generateUuid(),
					uri,
					startLine: fc.startLine,
					endLine: fc.endLine,
					content: fc.content,
					symbolName: null,
					language,
					mtime,
				})
			}
		}

		return chunks
	}

	/**
	 * Split file content at function/class/method boundaries using regex patterns.
	 */
	private _splitAtSymbolBoundaries(lines: string[], language: string): { startLine: number; endLine: number; symbolName: string }[] {
		const results: { startLine: number; endLine: number; symbolName: string }[] = []

		// Language-specific patterns for symbol boundaries
		const patterns: RegExp[] = []

		if (['typescript', 'javascript'].includes(language)) {
			patterns.push(
				/^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
				/^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/,
				/^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/,
				/^\s*(?:export\s+)?interface\s+(\w+)/,
				/^\s*(?:export\s+)?type\s+(\w+)/,
				/^\s*(?:public|private|protected|static|async)\s+(\w+)\s*\(/,
			)
		} else if (language === 'python') {
			patterns.push(
				/^\s*(?:async\s+)?def\s+(\w+)/,
				/^\s*class\s+(\w+)/,
			)
		} else if (language === 'go') {
			patterns.push(
				/^\s*func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)/,
				/^\s*type\s+(\w+)\s+struct/,
				/^\s*type\s+(\w+)\s+interface/,
			)
		} else if (language === 'rust') {
			patterns.push(
				/^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/,
				/^\s*(?:pub\s+)?struct\s+(\w+)/,
				/^\s*(?:pub\s+)?enum\s+(\w+)/,
				/^\s*(?:pub\s+)?trait\s+(\w+)/,
				/^\s*impl(?:<[^>]*>)?\s+(\w+)/,
			)
		} else if (language === 'java' || language === 'kotlin' || language === 'csharp') {
			patterns.push(
				/^\s*(?:public|private|protected|static|final|abstract|override|suspend)*\s*(?:fun|void|int|String|boolean|class|interface)\s+(\w+)/,
			)
		}

		if (patterns.length === 0) return []

		// Find symbol boundaries
		const boundaries: { line: number; name: string }[] = []
		for (let i = 0; i < lines.length; i++) {
			for (const pattern of patterns) {
				const match = lines[i].match(pattern)
				if (match && match[1]) {
					boundaries.push({ line: i, name: match[1] })
					break
				}
			}
		}

		if (boundaries.length === 0) return []

		// Create chunks between boundaries
		for (let i = 0; i < boundaries.length; i++) {
			const start = boundaries[i].line
			const end = i + 1 < boundaries.length ? boundaries[i + 1].line - 1 : lines.length - 1
			results.push({
				startLine: start,
				endLine: Math.min(end, lines.length - 1),
				symbolName: boundaries[i].name,
			})
		}

		// Add any content before the first boundary
		if (boundaries.length > 0 && boundaries[0].line > 0) {
			const preambleContent = lines.slice(0, boundaries[0].line).join('\n').trim()
			if (preambleContent.length > 50) { // skip trivial preambles
				results.unshift({
					startLine: 0,
					endLine: boundaries[0].line - 1,
					symbolName: '_preamble',
				})
			}
		}

		return results
	}

	/**
	 * Split a range of lines into fixed-size chunks with overlap.
	 */
	private _fixedSizeChunks(lines: string[], startLine: number, endLine: number, maxChars: number, overlap: number): { startLine: number; endLine: number; content: string }[] {
		const results: { startLine: number; endLine: number; content: string }[] = []

		let currentStart = startLine
		while (currentStart <= endLine) {
			let charCount = 0
			let currentEnd = currentStart

			while (currentEnd <= endLine) {
				charCount += lines[currentEnd].length + 1
				if (charCount > maxChars && currentEnd > currentStart) break
				currentEnd++
			}
			currentEnd = Math.min(currentEnd, endLine)

			const content = lines.slice(currentStart, currentEnd + 1).join('\n')
			if (content.trim().length > 0) {
				results.push({ startLine: currentStart, endLine: currentEnd, content })
			}

			// Move forward, accounting for overlap
			const overlapLines = Math.max(1, Math.floor(overlap / 80)) // ~80 chars per line
			currentStart = currentEnd + 1 - overlapLines
			if (currentStart <= (results.length > 0 ? results[results.length - 1].startLine : -1)) {
				currentStart = currentEnd + 1 // avoid infinite loop
			}
		}

		return results
	}
}

registerSingleton(IEmbeddingsService, EmbeddingsService, InstantiationType.Delayed);
