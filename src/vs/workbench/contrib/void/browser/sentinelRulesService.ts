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
import { parseFrontmatter, matchGlob } from '../common/frontmatterParser.js';
import { SentinelRule, SentinelSeverity, SentinelCategory } from '../common/sentinelTypes.js';

export interface ISentinelRulesService {
	readonly _serviceBrand: undefined;
	onDidChangeRules: Event<void>;
	getAllRules(): SentinelRule[];
	getMatchingRules(uri: URI): SentinelRule[];
	getEnabledRules(): SentinelRule[];
	refreshRules(): Promise<void>;
}

export const ISentinelRulesService = createDecorator<ISentinelRulesService>('voidSentinelRulesService');

class SentinelRulesService extends Disposable implements ISentinelRulesService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeRules = new Emitter<void>();
	readonly onDidChangeRules: Event<void> = this._onDidChangeRules.event;

	private _rules: SentinelRule[] = [];

	constructor(
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly _fileService: IFileService,
	) {
		super();

		// Initial load
		this.refreshRules();

		// Watch for file changes
		this._register(this._fileService.onDidFilesChange(e => {
			const allChanged = [...e.rawAdded, ...e.rawUpdated, ...e.rawDeleted];
			const rulesChanged = allChanged.some(uri => {
				const path = uri.path;
				return path.includes('.void/sentinel/rules/') && path.endsWith('.md');
			});
			if (rulesChanged) {
				this.refreshRules();
			}
		}));
	}

	async refreshRules(): Promise<void> {
		const rules: SentinelRule[] = [];
		const folders = this._workspaceContextService.getWorkspace().folders;

		for (const folder of folders) {
			const rulesDir = URI.joinPath(folder.uri, '.void', 'sentinel', 'rules');
			try {
				const stat = await this._fileService.resolve(rulesDir);
				if (!stat.children) continue;

				for (const child of stat.children) {
					if (child.isDirectory || !child.name.endsWith('.md')) continue;

					try {
						const content = await this._fileService.readFile(child.resource);
						const text = content.value.toString();
						const { frontmatter, body } = parseFrontmatter(text);

						rules.push({
							name: frontmatter.name || child.name.replace('.md', ''),
							description: frontmatter.description || '',
							globs: Array.isArray(frontmatter.globs) ? frontmatter.globs : [],
							severity: (frontmatter.severity as SentinelSeverity) || 'warning',
							category: (frontmatter.category as SentinelCategory) || 'code_quality',
							prompt: body.trim(),
							enabled: frontmatter.enabled !== false,
						});
					} catch {
						// Skip files that can't be read
					}
				}
			} catch {
				// Rules directory doesn't exist yet - that's fine
			}
		}

		this._rules = rules;
		this._onDidChangeRules.fire();
	}

	getAllRules(): SentinelRule[] {
		return this._rules;
	}

	getMatchingRules(uri: URI): SentinelRule[] {
		const filePath = uri.fsPath;
		return this._rules.filter(rule => {
			if (!rule.enabled) return false;
			if (rule.globs.length === 0) return true; // No globs = applies to all
			return rule.globs.some(glob => matchGlob(glob, filePath));
		});
	}

	getEnabledRules(): SentinelRule[] {
		return this._rules.filter(rule => rule.enabled);
	}
}

registerSingleton(ISentinelRulesService, SentinelRulesService, InstantiationType.Delayed);
