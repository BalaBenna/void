/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { voidRule } from '../common/rulesTypes.js';
import { parseFrontmatter, matchGlob } from '../common/frontmatterParser.js';
import { IPathService } from '../../../services/path/common/pathService.js';


export interface IRulesService {
	readonly _serviceBrand: undefined;
	onDidChangeRules: Event<void>;
	getAllRules(): voidRule[];
	getMatchingRules(uri: URI): voidRule[];
	getAlwaysApplyRules(): voidRule[];
	getIntelligentRules(): voidRule[];
	getRuleByName(name: string): voidRule | undefined;
	refreshRules(): Promise<void>;
}

export const IRulesService = createDecorator<IRulesService>('voidRulesService');

class RulesService extends Disposable implements IRulesService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeRules = new Emitter<void>();
	readonly onDidChangeRules: Event<void> = this._onDidChangeRules.event;

	private _rules: voidRule[] = [];

	constructor(
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly _fileService: IFileService,
		@IPathService private readonly _pathService: IPathService,
	) {
		super();

		// Initial load
		this.refreshRules();

		// Watch for file changes in workspace
		this._register(this._fileService.onDidFilesChange(e => {
			// Check if any added/updated/deleted files are in .void/rules/ or are AGENTS.md
			const allChanged = [...e.rawAdded, ...e.rawUpdated, ...e.rawDeleted]
			const rulesChanged = allChanged.some(uri => {
				const path = uri.path
				return (path.includes('.void/rules/') && path.endsWith('.md'))
					|| path.endsWith('/AGENTS.md')
			})
			if (rulesChanged) {
				this.refreshRules()
			}
		}));
	}

	async refreshRules(): Promise<void> {
		const rules: voidRule[] = []
		const folders = this._workspaceContextService.getWorkspace().folders

		for (const folder of folders) {
			const rulesDir = URI.joinPath(folder.uri, '.void', 'rules')
			try {
				const stat = await this._fileService.resolve(rulesDir)
				if (!stat.children) continue

				for (const child of stat.children) {
					if (child.isDirectory || !child.name.endsWith('.md')) continue

					try {
						const content = await this._fileService.readFile(child.resource)
						const text = content.value.toString()
						const { frontmatter, body } = parseFrontmatter(text)

						rules.push({
							name: frontmatter.name || child.name.replace('.md', ''),
							description: frontmatter.description || '',
							globs: Array.isArray(frontmatter.globs) ? frontmatter.globs : [],
							alwaysApply: frontmatter.alwaysApply === true,
							applyIntelligently: frontmatter.applyIntelligently === true,
							content: body.trim(),
							filePath: child.resource.fsPath,
							source: 'project',
						})
					} catch {
						// Skip files that can't be read
					}
				}
			} catch {
				// Rules directory doesn't exist yet
			}
		}

		// Also load AGENTS.md files from workspace root and subdirectories
		for (const folder of folders) {
			const agentsRules = await this._loadAgentsMdFiles(folder.uri)
			rules.push(...agentsRules)
		}

		// Load user-level rules from ~/.void/rules/
		const userRules = await this._loadUserRules()
		rules.push(...userRules)

		this._rules = rules
		this._onDidChangeRules.fire()
	}

	/**
	 * Load user-level rules from ~/.void/rules/*.md
	 * These apply across all workspaces with lower precedence than project rules.
	 */
	private async _loadUserRules(): Promise<voidRule[]> {
		const rules: voidRule[] = []
		try {
			const userHome = await this._pathService.userHome()
			const userRulesDir = URI.joinPath(userHome, '.void', 'rules')
			const stat = await this._fileService.resolve(userRulesDir)
			if (!stat.children) return rules

			for (const child of stat.children) {
				if (child.isDirectory || !child.name.endsWith('.md')) continue
				try {
					const content = await this._fileService.readFile(child.resource)
					const text = content.value.toString()
					const { frontmatter, body } = parseFrontmatter(text)

					rules.push({
						name: frontmatter.name || `user:${child.name.replace('.md', '')}`,
						description: frontmatter.description || '',
						globs: Array.isArray(frontmatter.globs) ? frontmatter.globs : [],
						alwaysApply: frontmatter.alwaysApply === true,
						applyIntelligently: frontmatter.applyIntelligently === true,
						content: body.trim(),
						filePath: child.resource.fsPath,
						source: 'user',
					})
				} catch {
					// Skip files that can't be read
				}
			}
		} catch {
			// User rules directory doesn't exist
		}
		return rules
	}

	/**
	 * Load AGENTS.md files from a directory and its subdirectories.
	 * AGENTS.md files are treated as always-apply rules with lower precedence than .void/rules/ files.
	 */
	private async _loadAgentsMdFiles(dirUri: URI, depth: number = 0): Promise<voidRule[]> {
		if (depth > 5) return [] // limit recursion depth
		const rules: voidRule[] = []

		try {
			const agentsMdUri = URI.joinPath(dirUri, 'AGENTS.md')
			const content = await this._fileService.readFile(agentsMdUri)
			const text = content.value.toString().trim()
			if (text) {
				const relativePath = depth === 0 ? 'AGENTS.md' : agentsMdUri.fsPath
				rules.push({
					name: `AGENTS.md (${depth === 0 ? 'root' : relativePath})`,
					description: 'Project instructions from AGENTS.md',
					globs: [],
					alwaysApply: true,
					applyIntelligently: false,
					content: text,
					filePath: agentsMdUri.fsPath,
					source: 'agents_md',
				})
			}
		} catch {
			// AGENTS.md doesn't exist in this directory
		}

		// Scan subdirectories (only first level for performance)
		if (depth === 0) {
			try {
				const stat = await this._fileService.resolve(dirUri)
				if (stat.children) {
					for (const child of stat.children) {
						if (child.isDirectory && !child.name.startsWith('.') && child.name !== 'node_modules') {
							const subRules = await this._loadAgentsMdFiles(child.resource, depth + 1)
							rules.push(...subRules)
						}
					}
				}
			} catch {
				// Skip directories we can't read
			}
		}

		return rules
	}

	getAllRules(): voidRule[] {
		return this._rules
	}

	getMatchingRules(uri: URI): voidRule[] {
		const filePath = uri.fsPath
		return this._rules.filter(rule => {
			if (rule.alwaysApply) return true
			if (rule.globs.length === 0) return false
			return rule.globs.some(glob => matchGlob(glob, filePath))
		})
	}

	getAlwaysApplyRules(): voidRule[] {
		return this._rules.filter(rule => rule.alwaysApply)
	}

	getIntelligentRules(): voidRule[] {
		return this._rules.filter(rule => rule.applyIntelligently)
	}

	getRuleByName(name: string): voidRule | undefined {
		return this._rules.find(rule => rule.name === name)
	}
}

registerSingleton(IRulesService, RulesService, InstantiationType.Delayed);
