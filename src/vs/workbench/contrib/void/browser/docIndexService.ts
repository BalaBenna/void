/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';


export interface DocEntry {
	packageName: string;
	version: string;
	content: string;
}

export interface IDocIndexService {
	readonly _serviceBrand: undefined;

	detectDependencies(): Promise<string[]>;
	indexDependencyDocs(packageName: string): Promise<void>;
	searchDocs(query: string, packageName?: string): DocEntry[];
	isIndexed(packageName: string): boolean;
}

export const IDocIndexService = createDecorator<IDocIndexService>('voidDocIndexService');


class DocIndexService extends Disposable implements IDocIndexService {
	declare readonly _serviceBrand: undefined;

	private _docs: Map<string, DocEntry[]> = new Map(); // packageName -> entries

	constructor(
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly _fileService: IFileService,
	) {
		super();
	}

	async detectDependencies(): Promise<string[]> {
		const folders = this._workspaceContextService.getWorkspace().folders;
		if (folders.length === 0) return [];

		const packageJsonUri = URI.joinPath(folders[0].uri, 'package.json');
		try {
			const content = await this._fileService.readFile(packageJsonUri);
			const pkg = JSON.parse(content.value.toString());
			const deps = Object.keys(pkg.dependencies || {});
			const devDeps = Object.keys(pkg.devDependencies || {});
			return [...deps, ...devDeps];
		} catch {
			return [];
		}
	}

	async indexDependencyDocs(packageName: string): Promise<void> {
		// In a full implementation, this would:
		// 1. Fetch docs from npm/GitHub
		// 2. Parse and chunk them
		// 3. Store in the doc index
		// For now, store a placeholder entry
		if (!this._docs.has(packageName)) {
			this._docs.set(packageName, [{
				packageName,
				version: 'latest',
				content: `Documentation for ${packageName} (pending fetch)`,
			}]);
		}
	}

	searchDocs(query: string, packageName?: string): DocEntry[] {
		const results: DocEntry[] = [];
		const searchIn = packageName ? [packageName] : Array.from(this._docs.keys());

		for (const pkg of searchIn) {
			const entries = this._docs.get(pkg) || [];
			for (const entry of entries) {
				if (entry.content.toLowerCase().includes(query.toLowerCase())) {
					results.push(entry);
				}
			}
		}

		return results.slice(0, 10);
	}

	isIndexed(packageName: string): boolean {
		return this._docs.has(packageName);
	}
}

registerSingleton(IDocIndexService, DocIndexService, InstantiationType.Delayed);
