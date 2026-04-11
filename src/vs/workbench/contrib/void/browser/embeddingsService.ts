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

import { VSBuffer } from '../../../../base/common/buffer.js';
import { ChunkSymbolKind, CodeChunk, EmbeddingRequest, IEmbeddingGenerationService, IndexSnapshot, IndexStatus, SearchResult, SerializedCodeChunk } from '../common/embeddingsTypes.js';
import { IvoidSettingsService } from '../common/voidSettingsService.js';
import { matchGlob } from '../common/frontmatterParser.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';

// Index persistence constants
const INDEX_VERSION = 1;
const INDEX_DIR = '.void/index';
const INDEX_FILE = 'chunks-v1.json';


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
	searchWithDependencies(query: string, targetDirectory: string | null, maxResults: number, depthLimit?: number): SearchResult[];
	getImportsForFile(uri: URI): URI[];
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

	// Cached vector scores from async search for hybrid blending
	private _lastVectorScores: Map<string, number> = new Map();

	// Import graph: file path -> set of imported file paths (for dependency-aware context)
	private _importGraph: Map<string, Set<string>> = new Map();

	// .voidignore patterns
	private _voidignorePatterns: string[] = [];

	// Progress tracking
	private _indexState: IndexStatus['state'] = 'idle';
	private _totalFiles = 0;
	private _indexedFiles = 0;

	// Embedding generation via IPC to main process
	private _embeddingService: IEmbeddingGenerationService | null = null;

	// Debounced disk save timer
	private _diskSaveTimeout: ReturnType<typeof setTimeout> | null = null;

	// Batch embedding generation config
	private static readonly EMBEDDING_BATCH_SIZE = 50; // max texts per API call

	constructor(
		@IFileService private readonly _fileService: IFileService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IvoidSettingsService private readonly _settingsService: IvoidSettingsService,
		@IMainProcessService private readonly _mainProcessService: IMainProcessService,
	) {
		super();

		// Connect to embedding generation service in main process
		try {
			this._embeddingService = ProxyChannel.toService<IEmbeddingGenerationService>(
				this._mainProcessService.getChannel('void-channel-embeddings')
			);
		} catch {
			// Channel may not be available
		}

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

			let changed = false
			for (const added of e.rawAdded) {
				if (this._shouldIndex(added)) { this.indexFile(added); changed = true }
			}
			for (const updated of e.rawUpdated) {
				if (this._shouldIndex(updated)) { this.indexFile(updated); changed = true }
			}
			for (const deleted of e.rawDeleted) {
				this.removeFile(deleted); changed = true
			}
			// Debounced save after file changes
			if (changed) this._scheduleDiskSave()
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

		this._indexState = 'indexing'
		this._indexedFiles = 0
		this._emitStatus()

		// Try to load cached index from disk for incremental re-indexing
		const cachedSnapshot = await this._loadIndexFromDisk()
		const cachedMtimes = cachedSnapshot?.fileMtimes ?? {}
		let usedCache = false

		if (cachedSnapshot && cachedSnapshot.version === INDEX_VERSION) {
			// Restore cached chunks
			this._restoreFromSnapshot(cachedSnapshot)
			usedCache = true
		} else {
			// Full re-index: clear everything
			this._chunks.clear()
			this._chunksByUri.clear()
			this._invertedIndex.clear()
		}

		// Count total files for progress
		this._totalFiles = 0
		for (const folder of folders) {
			this._totalFiles += await this._countIndexableFiles(folder.uri)
		}
		this._emitStatus()

		// Index files, skipping unchanged ones if we have a cache
		for (const folder of folders) {
			await this._indexDirectoryIncremental(folder.uri, usedCache ? cachedMtimes : null)
		}

		// Remove files that no longer exist (only if we used cache)
		if (usedCache) {
			await this._pruneDeletedFiles()
		}

		this._rebuildStats()

		// Build import graph for dependency-aware context
		this._buildImportGraph()

		// Generate vector embeddings if enabled
		await this._generateVectorEmbeddings()

		// Save updated index to disk
		await this._saveIndexToDisk()

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

	// @ts-ignore - kept for API completeness, called via _indexDirectoryIncremental
	private async _indexDirectory(dirUri: URI): Promise<void> {
		await this._indexDirectoryIncremental(dirUri, null)
	}

	private async _indexDirectoryIncremental(dirUri: URI, cachedMtimes: Record<string, number> | null): Promise<void> {
		try {
			const stat = await this._fileService.resolve(dirUri)
			if (!stat.children) return

			for (const child of stat.children) {
				if (child.isDirectory) {
					const name = child.name
					if (SKIP_DIRS.has(name)) continue
					await this._indexDirectoryIncremental(child.resource, cachedMtimes)
				} else {
					if (this._shouldIndex(child.resource)) {
						// Skip unchanged files if we have cached mtimes
						if (cachedMtimes) {
							const uriStr = child.resource.toString()
							const cachedMtime = cachedMtimes[uriStr]
							if (cachedMtime !== undefined && this._chunksByUri.has(uriStr)) {
								// File exists in cache — check if mtime changed
								try {
									const fileStat = await this._fileService.stat(child.resource)
									if (fileStat.mtime === cachedMtime) {
										this._indexedFiles++
										if (this._indexedFiles % 10 === 0) this._emitStatus()
										continue // skip, file unchanged
									}
								} catch {
									// Can't stat, re-index it
								}
							}
						}

						await this.indexFile(child.resource)
						this._indexedFiles++
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

	/**
	 * Remove chunks for files that no longer exist on disk.
	 */
	private async _pruneDeletedFiles(): Promise<void> {
		const toRemove: string[] = []
		for (const uriStr of this._chunksByUri.keys()) {
			try {
				const uri = URI.parse(uriStr)
				await this._fileService.stat(uri)
			} catch {
				toRemove.push(uriStr)
			}
		}
		for (const uriStr of toRemove) {
			this.removeFile(URI.parse(uriStr))
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
				// Remove from inverted index and clean up empty postings
				const tokens = tokenize(chunk.content)
				const seen = new Set<string>()
				for (const token of tokens) {
					if (seen.has(token)) continue
					seen.add(token)
					const postings = this._invertedIndex.get(token)
					if (postings) {
						postings.delete(chunkId)
						// Clean up empty postings sets to prevent memory leak
						if (postings.size === 0) {
							this._invertedIndex.delete(token)
						}
					}
				}
			}
			this._chunks.delete(chunkId)
		}

		this._chunksByUri.delete(uriStr)
		this._rebuildStats()
	}

	search(query: string, targetDirectory: string | null, maxResults: number): SearchResult[] {
		if (this._chunks.size === 0) return []

		const queryTokens = this._enhancedTokenize(query)
		if (queryTokens.length === 0) return []

		// BM25 scores
		const bm25Scores = this._bm25Search(queryTokens, targetDirectory)

		// Vector scores (async but we return sync - vector results enhance next call via caching)
		this._vectorSearch(query, targetDirectory, maxResults).then(vectorScores => {
			if (vectorScores.size > 0) {
				this._lastVectorScores = vectorScores
			}
		})

		// Combine BM25 with cached vector scores (hybrid search)
		const combinedScores = new Map<string, number>()

		// Normalize BM25 scores
		const maxBm25 = Math.max(...bm25Scores.values(), 1)
		for (const [id, score] of bm25Scores) {
			combinedScores.set(id, score / maxBm25)
		}

		// Blend in vector scores if available
		if (this._lastVectorScores.size > 0) {
			const maxVector = Math.max(...this._lastVectorScores.values(), 1)
			for (const [id, score] of this._lastVectorScores) {
				const existing = combinedScores.get(id) ?? 0
				const vectorNorm = score / maxVector
				combinedScores.set(id, existing * 0.4 + vectorNorm * 0.6) // 40% BM25, 60% vector for semantic quality
			}
		}

		// Sort and return top results
		const sorted = [...combinedScores.entries()]
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

	/**
	 * Search with dependency expansion: results include files imported by/importing the matched files.
	 */
	searchWithDependencies(query: string, targetDirectory: string | null, maxResults: number, depthLimit: number = 2): SearchResult[] {
		const initial = this.search(query, targetDirectory, maxResults)
		if (initial.length === 0 || this._importGraph.size === 0) return initial

		// Collect file paths from initial results
		const seenFiles = new Set<string>()
		for (const r of initial) seenFiles.add(r.uri.path)

		// Expand with dependencies up to depthLimit
		const frontier = new Set<string>(seenFiles)
		for (let depth = 0; depth < depthLimit; depth++) {
			const nextFrontier = new Set<string>()
			for (const filePath of frontier) {
				const imports = this._importGraph.get(filePath)
				if (imports) {
					for (const imp of imports) {
						if (!seenFiles.has(imp)) {
							seenFiles.add(imp)
							nextFrontier.add(imp)
						}
					}
				}
			}
			if (nextFrontier.size === 0) break
			frontier.clear()
			for (const f of nextFrontier) frontier.add(f)
		}

		// Add dependency chunks to results with reduced scores
		const depResults: SearchResult[] = [...initial]
		for (const filePath of seenFiles) {
			if (initial.some(r => r.uri.path === filePath)) continue // already in results

			// Find chunks for this dependency file
			for (const [uriStr, chunkIds] of this._chunksByUri) {
				const uri = URI.parse(uriStr)
				if (uri.path !== filePath) continue
				for (const chunkId of chunkIds) {
					const chunk = this._chunks.get(chunkId)
					if (!chunk) continue
					// Only include definitions (classes, interfaces, functions) from dependencies
					if (chunk.symbolKind && ['class', 'interface', 'struct', 'type', 'enum', 'trait'].includes(chunk.symbolKind)) {
						depResults.push({
							uri: chunk.uri,
							startLine: chunk.startLine,
							endLine: chunk.endLine,
							content: chunk.content,
							score: 0.3, // Lower score for dependency-expanded results
							symbolName: chunk.symbolName,
						})
					}
				}
			}
		}

		return depResults.slice(0, maxResults)
	}

	/**
	 * Get files imported by the given file.
	 */
	getImportsForFile(uri: URI): URI[] {
		const imports = this._importGraph.get(uri.path)
		if (!imports) return []
		return [...imports].map(p => {
			// Try to find the actual URI from our indexed files
			for (const [uriStr] of this._chunksByUri) {
				const parsed = URI.parse(uriStr)
				if (parsed.path === p) return parsed
			}
			return URI.file(p)
		})
	}

	/**
	 * Build import graph from indexed chunks by scanning for import/require patterns.
	 */
	private _buildImportGraph(): void {
		this._importGraph.clear()

		// Regex patterns for common import syntaxes
		const importPatterns = [
			/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,           // ES import ... from '...'
			/import\s+['"]([^'"]+)['"]/g,                         // import '...'
			/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,              // require('...')
			/from\s+(\S+)\s+import/g,                             // Python: from X import Y
			/^import\s+(\S+)/gm,                                  // Python: import X
		]

		for (const [uriStr, chunkIds] of this._chunksByUri) {
			const uri = URI.parse(uriStr)
			const filePath = uri.path
			const dirPath = filePath.substring(0, filePath.lastIndexOf('/'))
			const imports = new Set<string>()

			for (const chunkId of chunkIds) {
				const chunk = this._chunks.get(chunkId)
				if (!chunk) continue

				for (const pattern of importPatterns) {
					// Reset regex lastIndex
					pattern.lastIndex = 0
					let match
					while ((match = pattern.exec(chunk.content)) !== null) {
						const importPath = match[1]
						if (!importPath) continue

						// Resolve relative paths
						const resolved = this._resolveImportPath(importPath, dirPath)
						if (resolved) imports.add(resolved)
					}
				}
			}

			if (imports.size > 0) {
				this._importGraph.set(filePath, imports)
			}
		}
	}

	/**
	 * Resolve an import path to an absolute file path.
	 * Returns null if the import is external (node_modules, etc.)
	 */
	private _resolveImportPath(importPath: string, fromDir: string): string | null {
		// Skip external/node_modules imports
		if (!importPath.startsWith('.') && !importPath.startsWith('/')) return null

		// Resolve relative path
		let resolved: string
		if (importPath.startsWith('/')) {
			resolved = importPath
		} else {
			// Simple relative path resolution
			const parts = fromDir.split('/')
			for (const segment of importPath.split('/')) {
				if (segment === '..') parts.pop()
				else if (segment !== '.') parts.push(segment)
			}
			resolved = parts.join('/')
		}

		// Try common extensions if none provided
		const ext = resolved.substring(resolved.lastIndexOf('.'))
		if (!INDEXABLE_EXTENSIONS.has(ext)) {
			// Try adding common extensions
			for (const tryExt of ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs']) {
				const withExt = resolved + tryExt
				// Check if we have this file indexed
				for (const [uriStr] of this._chunksByUri) {
					if (URI.parse(uriStr).path === withExt) return withExt
				}
			}
			// Try /index.ts, /index.js
			for (const tryExt of ['/index.ts', '/index.tsx', '/index.js', '/index.jsx']) {
				const withIndex = resolved + tryExt
				for (const [uriStr] of this._chunksByUri) {
					if (URI.parse(uriStr).path === withIndex) return withIndex
				}
			}
			return null
		}

		return resolved
	}

	/**
	 * Enhanced tokenization: splits camelCase, snake_case, and handles code-specific patterns.
	 */
	private _enhancedTokenize(text: string): string[] {
		// Split camelCase and PascalCase
		const expanded = text.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
		// Split snake_case
		const withUnderscores = expanded.replace(/_/g, ' ')
		return tokenize(withUnderscores)
	}

	/**
	 * Pure BM25 search returning chunk scores.
	 */
	private _bm25Search(queryTokens: string[], targetDirectory: string | null): Map<string, number> {
		const k1 = 1.2
		const b = 0.75
		const N = this._totalChunks
		const scores = new Map<string, number>()

		for (const token of queryTokens) {
			const postings = this._invertedIndex.get(token)
			if (!postings) continue

			const df = postings.size
			const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1)

			for (const chunkId of postings) {
				const chunk = this._chunks.get(chunkId)
				if (!chunk) continue
				if (targetDirectory && !chunk.uri.path.includes(targetDirectory)) continue

				const chunkTokens = tokenize(chunk.content)
				const tf = chunkTokens.filter(t => t === token).length
				const docLen = chunkTokens.length
				const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / this._avgChunkLength)))
				const score = idf * tfNorm

				scores.set(chunkId, (scores.get(chunkId) ?? 0) + score)
			}
		}

		// Boost symbol name matches and rank by symbol kind
		const kindBoost: Record<string, number> = {
			'class': 1.3, 'interface': 1.3, 'struct': 1.3, 'trait': 1.3,
			'enum': 1.2, 'type': 1.2,
			'function': 1.1, 'method': 1.1,
			'variable': 1.0, 'preamble': 0.8,
		}
		for (const [chunkId, score] of scores) {
			const chunk = this._chunks.get(chunkId)
			if (!chunk) continue

			let boost = 1.0
			// Boost by symbol kind (definitions ranked higher)
			if (chunk.symbolKind) {
				boost *= kindBoost[chunk.symbolKind] ?? 1.0
			}
			// Boost by symbol name match
			if (chunk.symbolName) {
				const symbolTokens = this._enhancedTokenize(chunk.symbolName)
				const matchCount = queryTokens.filter(qt => symbolTokens.some(st => st.includes(qt) || qt.includes(st))).length
				if (matchCount > 0) {
					boost *= (1 + 0.5 * matchCount)
				}
			}
			if (boost !== 1.0) {
				scores.set(chunkId, score * boost)
			}
		}

		return scores
	}

	/**
	 * Generate vector embeddings for all chunks in batches.
	 */
	private async _generateVectorEmbeddings(): Promise<void> {
		const config = this._settingsService.state.globalSettings.embeddingsConfig
		if (!config.useVectorEmbeddings || config.embeddingProvider === 'none') return
		if (!this._embeddingService) return

		// Get API key for the embedding provider
		const apiKey = this._getEmbeddingApiKey()
		if (!apiKey) return

		const chunks = Array.from(this._chunks.values()).filter(c => !c.embedding)
		if (chunks.length === 0) return

		// Process in batches
		for (let i = 0; i < chunks.length; i += EmbeddingsService.EMBEDDING_BATCH_SIZE) {
			const batch = chunks.slice(i, i + EmbeddingsService.EMBEDDING_BATCH_SIZE)
			const texts = batch.map(c => c.content.slice(0, 8000)) // truncate to avoid token limits

			try {
				const request: EmbeddingRequest = {
					texts,
					model: config.embeddingModel,
					provider: config.embeddingProvider,
				}
				const response = await this._embeddingService.generateEmbeddings(request, apiKey)

				for (let j = 0; j < batch.length; j++) {
					if (response.embeddings[j]) {
						batch[j].embedding = response.embeddings[j]
					}
				}
			} catch (e) {
				console.warn('Failed to generate embeddings for batch:', e)
				// Continue with remaining batches
			}
		}
	}

	private _getEmbeddingApiKey(): string {
		const config = this._settingsService.state.globalSettings.embeddingsConfig
		if (config.embeddingProvider === 'openAI') {
			return (this._settingsService.state.settingsOfProvider.openAI as any)?.apiKey ?? ''
		}
		return ''
	}

	/**
	 * Compute cosine similarity between two vectors.
	 */
	private _cosineSimilarity(a: number[], b: number[]): number {
		if (a.length !== b.length) return 0
		let dotProduct = 0
		let normA = 0
		let normB = 0
		for (let i = 0; i < a.length; i++) {
			dotProduct += a[i] * b[i]
			normA += a[i] * a[i]
			normB += b[i] * b[i]
		}
		const denom = Math.sqrt(normA) * Math.sqrt(normB)
		return denom === 0 ? 0 : dotProduct / denom
	}

	/**
	 * Vector similarity search using pre-computed embeddings.
	 */
	private async _vectorSearch(query: string, targetDirectory: string | null, maxResults: number): Promise<Map<string, number>> {
		const scores = new Map<string, number>()
		const config = this._settingsService.state.globalSettings.embeddingsConfig
		if (!config.useVectorEmbeddings || config.embeddingProvider === 'none') return scores
		if (!this._embeddingService) return scores

		// Local provider doesn't need an API key
		const apiKey = config.embeddingProvider === 'local' ? '' : this._getEmbeddingApiKey()
		if (config.embeddingProvider !== 'local' && !apiKey) return scores

		// Generate embedding for the query
		try {
			const request: EmbeddingRequest = {
				texts: [query],
				model: config.embeddingModel,
				provider: config.embeddingProvider,
			}
			const response = await this._embeddingService.generateEmbeddings(request, apiKey)
			const queryEmbedding = response.embeddings[0]
			if (!queryEmbedding) return scores

			// Compute similarity with all chunks that have embeddings
			for (const [chunkId, chunk] of this._chunks) {
				if (!chunk.embedding) continue
				if (targetDirectory && !chunk.uri.path.includes(targetDirectory)) continue

				const similarity = this._cosineSimilarity(queryEmbedding, chunk.embedding)
				if (similarity > 0.1) { // threshold
					scores.set(chunkId, similarity)
				}
			}
		} catch (e) {
			console.warn('Vector search failed:', e)
		}

		return scores
	}

	// --- Persistent Index Serialization ---

	private _scheduleDiskSave(): void {
		if (this._diskSaveTimeout) clearTimeout(this._diskSaveTimeout)
		this._diskSaveTimeout = setTimeout(() => {
			this._diskSaveTimeout = null
			this._saveIndexToDisk()
		}, 5000) // Save at most every 5 seconds
	}

	private _getIndexDirUri(): URI | null {
		const folders = this._workspaceContextService.getWorkspace().folders
		if (folders.length === 0) return null
		return URI.joinPath(folders[0].uri, INDEX_DIR)
	}

	private _getIndexFileUri(): URI | null {
		const dirUri = this._getIndexDirUri()
		if (!dirUri) return null
		return URI.joinPath(dirUri, INDEX_FILE)
	}

	private async _saveIndexToDisk(): Promise<void> {
		const fileUri = this._getIndexFileUri()
		if (!fileUri) return

		try {
			// Ensure .void/index directory exists
			const dirUri = this._getIndexDirUri()!
			try {
				await this._fileService.stat(dirUri)
			} catch {
				await this._fileService.createFolder(dirUri)
			}

			// Build file mtimes map
			const fileMtimes: Record<string, number> = {}
			for (const [uriStr, chunkIds] of this._chunksByUri) {
				// Use mtime from first chunk of each file
				for (const chunkId of chunkIds) {
					const chunk = this._chunks.get(chunkId)
					if (chunk) {
						fileMtimes[uriStr] = chunk.mtime
						break
					}
				}
			}

			// Serialize chunks (without embeddings to keep file size manageable)
			const serializedChunks: SerializedCodeChunk[] = []
			for (const chunk of this._chunks.values()) {
				serializedChunks.push({
					id: chunk.id,
					uriStr: chunk.uri.toString(),
					startLine: chunk.startLine,
					endLine: chunk.endLine,
					content: chunk.content,
					symbolName: chunk.symbolName,
					symbolKind: chunk.symbolKind,
					language: chunk.language,
					mtime: chunk.mtime,
				})
			}

			const snapshot: IndexSnapshot = {
				version: INDEX_VERSION,
				timestamp: Date.now(),
				chunks: serializedChunks,
				fileMtimes,
			}

			const content = JSON.stringify(snapshot)
			await this._fileService.writeFile(fileUri, VSBuffer.fromString(content))
		} catch (e) {
			console.warn('Failed to save embeddings index to disk:', e)
		}
	}

	private async _loadIndexFromDisk(): Promise<IndexSnapshot | null> {
		const fileUri = this._getIndexFileUri()
		if (!fileUri) return null

		try {
			const content = await this._fileService.readFile(fileUri)
			const snapshot: IndexSnapshot = JSON.parse(content.value.toString())
			if (snapshot.version !== INDEX_VERSION) return null
			return snapshot
		} catch {
			return null // Index file doesn't exist or is corrupted
		}
	}

	private _restoreFromSnapshot(snapshot: IndexSnapshot): void {
		this._chunks.clear()
		this._chunksByUri.clear()
		this._invertedIndex.clear()

		for (const sc of snapshot.chunks) {
			const uri = URI.parse(sc.uriStr)
			const chunk: CodeChunk = {
				id: sc.id,
				uri,
				startLine: sc.startLine,
				endLine: sc.endLine,
				content: sc.content,
				symbolName: sc.symbolName,
				symbolKind: sc.symbolKind ?? null,
				language: sc.language,
				mtime: sc.mtime,
				embedding: null, // Embeddings are regenerated, not persisted
			}

			this._chunks.set(chunk.id, chunk)

			// Rebuild chunksByUri
			const uriStr = uri.toString()
			let chunkIds = this._chunksByUri.get(uriStr)
			if (!chunkIds) {
				chunkIds = new Set()
				this._chunksByUri.set(uriStr, chunkIds)
			}
			chunkIds.add(chunk.id)

			// Rebuild inverted index
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
							symbolKind: sc.symbolKind,
							language,
							mtime,
							embedding: null,
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
						symbolKind: sc.symbolKind,
						language,
						mtime,
						embedding: null,
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
					symbolKind: null,
					language,
					mtime,
					embedding: null,
				})
			}
		}

		return chunks
	}

	/**
	 * Split file content at function/class/method boundaries using regex patterns.
	 */
	private _splitAtSymbolBoundaries(lines: string[], language: string): { startLine: number; endLine: number; symbolName: string; symbolKind: ChunkSymbolKind }[] {
		const results: { startLine: number; endLine: number; symbolName: string; symbolKind: ChunkSymbolKind }[] = []

		// Language-specific patterns for symbol boundaries, with kind classification
		const patterns: { regex: RegExp; kind: ChunkSymbolKind }[] = []

		if (['typescript', 'javascript'].includes(language)) {
			patterns.push(
				{ regex: /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/, kind: 'function' },
				{ regex: /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/, kind: 'function' },
				{ regex: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/, kind: 'class' },
				{ regex: /^\s*(?:export\s+)?interface\s+(\w+)/, kind: 'interface' },
				{ regex: /^\s*(?:export\s+)?type\s+(\w+)/, kind: 'type' },
				{ regex: /^\s*(?:export\s+)?enum\s+(\w+)/, kind: 'enum' },
				{ regex: /^\s*(?:public|private|protected|static|async)\s+(\w+)\s*\(/, kind: 'method' },
			)
		} else if (language === 'python') {
			patterns.push(
				{ regex: /^\s*(?:async\s+)?def\s+(\w+)/, kind: 'function' },
				{ regex: /^\s*class\s+(\w+)/, kind: 'class' },
			)
		} else if (language === 'go') {
			patterns.push(
				{ regex: /^\s*func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)/, kind: 'function' },
				{ regex: /^\s*type\s+(\w+)\s+struct/, kind: 'struct' },
				{ regex: /^\s*type\s+(\w+)\s+interface/, kind: 'interface' },
			)
		} else if (language === 'rust') {
			patterns.push(
				{ regex: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/, kind: 'function' },
				{ regex: /^\s*(?:pub\s+)?struct\s+(\w+)/, kind: 'struct' },
				{ regex: /^\s*(?:pub\s+)?enum\s+(\w+)/, kind: 'enum' },
				{ regex: /^\s*(?:pub\s+)?trait\s+(\w+)/, kind: 'trait' },
				{ regex: /^\s*impl(?:<[^>]*>)?\s+(\w+)/, kind: 'class' },
			)
		} else if (language === 'java' || language === 'kotlin' || language === 'csharp') {
			patterns.push(
				{ regex: /^\s*(?:public|private|protected|static|final|abstract|override|suspend)*\s*class\s+(\w+)/, kind: 'class' },
				{ regex: /^\s*(?:public|private|protected|static|final|abstract|override|suspend)*\s*interface\s+(\w+)/, kind: 'interface' },
				{ regex: /^\s*(?:public|private|protected|static|final|abstract|override|suspend)*\s*(?:fun|void|int|String|boolean|long|double|float)\s+(\w+)/, kind: 'function' },
			)
		} else if (language === 'c' || language === 'cpp') {
			patterns.push(
				{ regex: /^\s*(?:static\s+)?(?:inline\s+)?(?:const\s+)?(?:\w+\s+)+(\w+)\s*\(/, kind: 'function' },
				{ regex: /^\s*(?:typedef\s+)?struct\s+(\w+)/, kind: 'struct' },
				{ regex: /^\s*class\s+(\w+)/, kind: 'class' },
				{ regex: /^\s*enum\s+(?:class\s+)?(\w+)/, kind: 'enum' },
			)
		} else if (language === 'ruby') {
			patterns.push(
				{ regex: /^\s*def\s+(\w+)/, kind: 'function' },
				{ regex: /^\s*class\s+(\w+)/, kind: 'class' },
				{ regex: /^\s*module\s+(\w+)/, kind: 'class' },
			)
		} else if (language === 'php') {
			patterns.push(
				{ regex: /^\s*(?:public|private|protected|static)?\s*function\s+(\w+)/, kind: 'function' },
				{ regex: /^\s*(?:abstract\s+)?class\s+(\w+)/, kind: 'class' },
				{ regex: /^\s*interface\s+(\w+)/, kind: 'interface' },
			)
		} else if (language === 'swift') {
			patterns.push(
				{ regex: /^\s*(?:public|private|internal|open)?\s*func\s+(\w+)/, kind: 'function' },
				{ regex: /^\s*(?:public|private|internal|open)?\s*class\s+(\w+)/, kind: 'class' },
				{ regex: /^\s*(?:public|private|internal|open)?\s*struct\s+(\w+)/, kind: 'struct' },
				{ regex: /^\s*(?:public|private|internal|open)?\s*protocol\s+(\w+)/, kind: 'interface' },
				{ regex: /^\s*(?:public|private|internal|open)?\s*enum\s+(\w+)/, kind: 'enum' },
			)
		}

		if (patterns.length === 0) return []

		// Find symbol boundaries
		const boundaries: { line: number; name: string; kind: ChunkSymbolKind }[] = []
		for (let i = 0; i < lines.length; i++) {
			for (const { regex, kind } of patterns) {
				const match = lines[i].match(regex)
				if (match && match[1]) {
					boundaries.push({ line: i, name: match[1], kind })
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
				symbolKind: boundaries[i].kind,
			})
		}

		// Add any content before the first boundary (imports, constants, etc.)
		if (boundaries.length > 0 && boundaries[0].line > 0) {
			const preambleContent = lines.slice(0, boundaries[0].line).join('\n').trim()
			if (preambleContent.length > 50) {
				results.unshift({
					startLine: 0,
					endLine: boundaries[0].line - 1,
					symbolName: '_preamble',
					symbolKind: 'preamble',
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
