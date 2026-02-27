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


export interface IEnvFileService {
	readonly _serviceBrand: undefined;
	onDidChangeEnvVars: Event<void>;
	getEnvVar(key: string): string | undefined;
	getAllEnvVars(): Record<string, string>;
	refreshEnvFile(): Promise<void>;
}

export const IEnvFileService = createDecorator<IEnvFileService>('voidEnvFileService');

// Recognized keys that Void can use from .env
const RECOGNIZED_KEYS = new Set([
	'TAVILY_API_KEY',
	'ANTHROPIC_API_KEY',
	'OPENAI_API_KEY',
	'OPENROUTER_API_KEY',
	'GOOGLE_API_KEY',
	'DEEPSEEK_API_KEY',
	'GROQ_API_KEY',
	'XAI_API_KEY',
	'MISTRAL_API_KEY',
]);

function parseEnvFile(content: string): Record<string, string> {
	const vars: Record<string, string> = {}
	for (const line of content.split('\n')) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith('#')) continue

		const eqIdx = trimmed.indexOf('=')
		if (eqIdx === -1) continue

		const key = trimmed.substring(0, eqIdx).trim()
		let value = trimmed.substring(eqIdx + 1).trim()

		// Remove surrounding quotes
		if ((value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1)
		}

		if (RECOGNIZED_KEYS.has(key)) {
			vars[key] = value
		}
	}
	return vars
}

class EnvFileService extends Disposable implements IEnvFileService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeEnvVars = new Emitter<void>();
	readonly onDidChangeEnvVars: Event<void> = this._onDidChangeEnvVars.event;

	private _envVars: Record<string, string> = {};

	constructor(
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly _fileService: IFileService,
	) {
		super();

		// Initial load
		this.refreshEnvFile();

		// Watch for .env file changes
		this._register(this._fileService.onDidFilesChange(e => {
			const allChanged = [...e.rawAdded, ...e.rawUpdated, ...e.rawDeleted]
			const envChanged = allChanged.some(uri => uri.path.endsWith('.env'))
			if (envChanged) {
				this.refreshEnvFile()
			}
		}));
	}

	async refreshEnvFile(): Promise<void> {
		const allVars: Record<string, string> = {}
		const folders = this._workspaceContextService.getWorkspace().folders

		for (const folder of folders) {
			try {
				const envUri = URI.joinPath(folder.uri, '.env')
				const content = await this._fileService.readFile(envUri)
				const text = content.value.toString()
				const parsed = parseEnvFile(text)
				Object.assign(allVars, parsed)
			} catch {
				// .env doesn't exist
			}
		}

		this._envVars = allVars
		this._onDidChangeEnvVars.fire()
	}

	getEnvVar(key: string): string | undefined {
		return this._envVars[key]
	}

	getAllEnvVars(): Record<string, string> {
		return { ...this._envVars }
	}
}

registerSingleton(IEnvFileService, EnvFileService, InstantiationType.Delayed);
