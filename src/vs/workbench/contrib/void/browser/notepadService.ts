/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';

export interface Notepad {
	name: string;
	content: string;
	uri: URI;
}

export interface INotepadService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeNotepads: Event<void>;
	getNotepads(): Notepad[];
	getNotepad(name: string): Notepad | undefined;
	saveNotepad(name: string, content: string): Promise<void>;
	deleteNotepad(name: string): Promise<void>;
	refreshNotepads(): Promise<void>;
}

export const INotepadService = createDecorator<INotepadService>('notepadService');

class NotepadService extends Disposable implements INotepadService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeNotepads = this._register(new Emitter<void>());
	readonly onDidChangeNotepads = this._onDidChangeNotepads.event;

	private _notepads: Notepad[] = [];

	constructor(
		@IFileService private readonly _fileService: IFileService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
	) {
		super();
		this.refreshNotepads();
	}

	private _getNotepadsDir(): URI | null {
		const folders = this._workspaceContextService.getWorkspace().folders;
		if (folders.length === 0) return null;
		return URI.joinPath(folders[0].uri, '.void', 'notepads');
	}

	getNotepads(): Notepad[] {
		return [...this._notepads];
	}

	getNotepad(name: string): Notepad | undefined {
		return this._notepads.find(n => n.name === name);
	}

	async saveNotepad(name: string, content: string): Promise<void> {
		const dir = this._getNotepadsDir();
		if (!dir) return;

		const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
		const uri = URI.joinPath(dir, `${safeName}.md`);

		await this._fileService.writeFile(uri, VSBuffer.fromString(content));
		await this.refreshNotepads();
	}

	async deleteNotepad(name: string): Promise<void> {
		const dir = this._getNotepadsDir();
		if (!dir) return;

		const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
		const uri = URI.joinPath(dir, `${safeName}.md`);

		try {
			await this._fileService.del(uri);
		} catch {
			// File might not exist
		}
		await this.refreshNotepads();
	}

	async refreshNotepads(): Promise<void> {
		const dir = this._getNotepadsDir();
		if (!dir) {
			this._notepads = [];
			return;
		}

		try {
			const stat = await this._fileService.resolve(dir);
			if (!stat.children) {
				this._notepads = [];
				return;
			}

			const notepads: Notepad[] = [];
			for (const child of stat.children) {
				if (!child.name.endsWith('.md')) continue;

				try {
					const content = (await this._fileService.readFile(child.resource)).value.toString();
					notepads.push({
						name: child.name.replace('.md', ''),
						content,
						uri: child.resource,
					});
				} catch {
					// Skip unreadable files
				}
			}

			this._notepads = notepads;
			this._onDidChangeNotepads.fire();
		} catch {
			// Notepads directory doesn't exist yet
			this._notepads = [];
		}
	}
}

registerSingleton(INotepadService, NotepadService, InstantiationType.Eager);
