/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { IServerChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { Event } from '../../../../base/common/event.js';

// E2B REST API base URL
const E2B_API_BASE = 'https://api.e2b.dev';

type CreateSandboxParams = { apiKey: string; template: string; timeoutMs: number };
type RunCommandParams = { apiKey: string; sandboxId: string; command: string; cwd?: string; timeoutMs?: number };
type WriteFileParams = { apiKey: string; sandboxId: string; path: string; content: string };
type ReadFileParams = { apiKey: string; sandboxId: string; path: string };
type ListFilesParams = { apiKey: string; sandboxId: string; path: string };
type DestroySandboxParams = { apiKey: string; sandboxId: string };

export interface E2BSandboxResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export class E2BSandboxChannel implements IServerChannel {

	listen(_: unknown, _event: string): Event<any> {
		throw new Error(`E2BSandboxChannel: No events available.`);
	}

	async call(_: unknown, command: string, params: any): Promise<any> {
		try {
			if (command === 'createSandbox') return await this._createSandbox(params);
			if (command === 'runCommand') return await this._runCommand(params);
			if (command === 'writeFile') return await this._writeFile(params);
			if (command === 'readFile') return await this._readFile(params);
			if (command === 'listFiles') return await this._listFiles(params);
			if (command === 'destroySandbox') return await this._destroySandbox(params);
			throw new Error(`E2BSandboxChannel: command "${command}" not recognized.`);
		} catch (e: any) {
			console.error('E2BSandboxChannel call error:', e);
			return { error: e.message || 'Unknown E2B error' };
		}
	}

	// ── Create a new E2B sandbox ──
	private async _createSandbox(params: CreateSandboxParams): Promise<{ sandboxId: string } | { error: string }> {
		const { apiKey, template, timeoutMs } = params;

		const response = await fetch(`${E2B_API_BASE}/sandboxes`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-API-Key': apiKey,
			},
			body: JSON.stringify({
				templateID: template || 'base',
				timeout: Math.floor(timeoutMs / 1000), // E2B expects seconds
			}),
		});

		if (!response.ok) {
			const errorText = await response.text();
			return { error: `E2B API error (${response.status}): ${errorText}` };
		}

		const data = await response.json();
		return { sandboxId: data.sandboxID };
	}

	// ── Run a command in an E2B sandbox ──
	private async _runCommand(params: RunCommandParams): Promise<E2BSandboxResult | { error: string }> {
		const { apiKey, sandboxId, command, cwd, timeoutMs } = params;

		const response = await fetch(`${E2B_API_BASE}/sandboxes/${sandboxId}/commands`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-API-Key': apiKey,
			},
			body: JSON.stringify({
				cmd: command,
				cwd: cwd || '/home/user',
				timeout: timeoutMs ? Math.floor(timeoutMs / 1000) : 300,
			}),
		});

		if (!response.ok) {
			const errorText = await response.text();
			return { error: `E2B command error (${response.status}): ${errorText}` };
		}

		const data = await response.json();
		return {
			stdout: data.stdout || '',
			stderr: data.stderr || '',
			exitCode: data.exitCode ?? 0,
		};
	}

	// ── Write a file to an E2B sandbox ──
	private async _writeFile(params: WriteFileParams): Promise<{ success: boolean } | { error: string }> {
		const { apiKey, sandboxId, path, content } = params;

		const response = await fetch(`${E2B_API_BASE}/sandboxes/${sandboxId}/files`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-API-Key': apiKey,
			},
			body: JSON.stringify({
				path,
				content,
			}),
		});

		if (!response.ok) {
			const errorText = await response.text();
			return { error: `E2B file write error (${response.status}): ${errorText}` };
		}

		return { success: true };
	}

	// ── Read a file from an E2B sandbox ──
	private async _readFile(params: ReadFileParams): Promise<{ content: string } | { error: string }> {
		const { apiKey, sandboxId, path } = params;

		const response = await fetch(`${E2B_API_BASE}/sandboxes/${sandboxId}/files?path=${encodeURIComponent(path)}`, {
			method: 'GET',
			headers: {
				'X-API-Key': apiKey,
			},
		});

		if (!response.ok) {
			const errorText = await response.text();
			return { error: `E2B file read error (${response.status}): ${errorText}` };
		}

		const data = await response.json();
		return { content: data.content || '' };
	}

	// ── List files in an E2B sandbox ──
	private async _listFiles(params: ListFilesParams): Promise<{ files: string[] } | { error: string }> {
		const { apiKey, sandboxId, path } = params;

		const response = await fetch(`${E2B_API_BASE}/sandboxes/${sandboxId}/files?path=${encodeURIComponent(path)}&type=list`, {
			method: 'GET',
			headers: {
				'X-API-Key': apiKey,
			},
		});

		if (!response.ok) {
			const errorText = await response.text();
			return { error: `E2B file list error (${response.status}): ${errorText}` };
		}

		const data = await response.json();
		return { files: data.files || [] };
	}

	// ── Destroy an E2B sandbox ──
	private async _destroySandbox(params: DestroySandboxParams): Promise<{ success: boolean } | { error: string }> {
		const { apiKey, sandboxId } = params;

		const response = await fetch(`${E2B_API_BASE}/sandboxes/${sandboxId}`, {
			method: 'DELETE',
			headers: {
				'X-API-Key': apiKey,
			},
		});

		if (!response.ok) {
			const errorText = await response.text();
			return { error: `E2B destroy error (${response.status}): ${errorText}` };
		}

		return { success: true };
	}
}
