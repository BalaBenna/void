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


export interface IRulesService {
	readonly _serviceBrand: undefined;
	onDidChangeRules: Event<void>;
	getAllRules(): voidRule[];
	getMatchingRules(uri: URI): voidRule[];
	getAlwaysApplyRules(): voidRule[];
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
	) {
		super();

		// Initial load
		this.refreshRules();

		// Watch for file changes in workspace
		this._register(this._fileService.onDidFilesChange(e => {
			// Check if any added/updated/deleted files are in .void/rules/
			const allChanged = [...e.rawAdded, ...e.rawUpdated, ...e.rawDeleted]
			const rulesChanged = allChanged.some(uri => {
				const path = uri.path
				return path.includes('.void/rules/') && path.endsWith('.md')
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
							content: body.trim(),
							filePath: child.resource.fsPath,
						})
					} catch {
						// Skip files that can't be read
					}
				}
			} catch {
				// Rules directory doesn't exist yet
			}
		}

		this._rules = rules
		this._onDidChangeRules.fire()
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

	getRuleByName(name: string): voidRule | undefined {
		return this._rules.find(rule => rule.name === name)
	}
}

registerSingleton(IRulesService, RulesService, InstantiationType.Delayed);
