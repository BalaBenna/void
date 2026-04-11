/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IvoidSettingsService } from '../common/voidSettingsService.js';
import { SandboxMode, CommandRiskLevel, SandboxPolicy } from '../common/sandboxTypes.js';
import { IAgentEventService } from './agentEventService.js';
import { os } from '../common/helpers/systemInfo.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';

export interface E2BCommandResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export interface ISandboxService {
	readonly _serviceBrand: undefined;
	wrapCommand(command: string): string;
	classifyRisk(command: string): CommandRiskLevel;
	isSandboxAvailable(): boolean;
	getSandboxMode(): SandboxMode;
	isE2BMode(): boolean;
	runInE2B(command: string, cwd?: string): Promise<E2BCommandResult>;
	destroyE2BSandbox(): Promise<void>;
}

export const ISandboxService = createDecorator<ISandboxService>('voidSandboxService');

class SandboxService extends Disposable implements ISandboxService {
	declare readonly _serviceBrand: undefined;

	private _e2bSandboxId: string | null = null;

	constructor(
		@IvoidSettingsService private readonly _settingsService: IvoidSettingsService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IAgentEventService _agentEventService: IAgentEventService,
		@IMainProcessService private readonly _mainProcessService: IMainProcessService,
	) {
		super();
	}

	isSandboxAvailable(): boolean {
		const mode = this.getSandboxMode();
		if (mode === 'e2b') {
			return !!this._settingsService.state.globalSettings.e2bSandboxConfig.apiKey;
		}
		return os === 'mac'; // sandbox-exec is macOS only
	}

	getSandboxMode(): SandboxMode {
		return this._settingsService.state.globalSettings.sandboxMode;
	}

	isE2BMode(): boolean {
		return this.getSandboxMode() === 'e2b';
	}

	classifyRisk(command: string): CommandRiskLevel {
		const cmd = command.trim();

		// Critical commands - always block or require explicit approval
		if (/^(rm\s+-rf|sudo\s|chmod\s|git\s+push\s+--force|dd\s|mkfs\s)/i.test(cmd)) return 'critical';

		// Dangerous commands - install, download, network
		if (/^(npm\s+install|pip\s+install|curl\s|wget\s|brew\s)/i.test(cmd)) return 'dangerous';

		// Safe commands - read-only operations
		if (/^(ls|cat|head|tail|grep|find|echo|pwd|wc|sort|uniq|diff|file)\b/i.test(cmd)) return 'safe';
		if (/^git\s+(status|log|diff|branch|show|remote|tag)\b/i.test(cmd)) return 'safe';

		// Moderate commands - build, test, linting
		if (/^(npm\s+(test|run|build)|npx\s|tsc|eslint|jest|pytest|cargo\s+(test|build|check))\b/i.test(cmd)) return 'moderate';

		return 'moderate'; // default
	}

	wrapCommand(command: string): string {
		const sandboxMode = this.getSandboxMode();

		if (sandboxMode === 'off' || sandboxMode === 'e2b' || !this.isSandboxAvailable()) {
			return command;
		}

		const policy = this._settingsService.state.globalSettings.sandboxPolicy;
		const workspacePaths = this._workspaceContextService.getWorkspace().folders.map(f => f.uri.fsPath);
		const workspacePath = workspacePaths[0] || '/tmp';

		const profile = this._generateSeatbeltProfile(workspacePath, policy);
		const escapedCommand = command.replace(/'/g, "'\\''");
		return `sandbox-exec -p '${profile}' /bin/bash -c '${escapedCommand}'`;
	}

	// ── E2B Cloud Sandbox ──

	async runInE2B(command: string, cwd?: string): Promise<E2BCommandResult> {
		const config = this._settingsService.state.globalSettings.e2bSandboxConfig;
		if (!config.apiKey) {
			throw new Error('E2B API key not configured. Go to Settings > Sandbox and add your E2B API key.');
		}

		const channel = this._mainProcessService.getChannel('void-channel-e2b-sandbox');

		// Create sandbox if we don't have one yet
		if (!this._e2bSandboxId) {
			const createResult: any = await channel.call('createSandbox', {
				apiKey: config.apiKey,
				template: config.template,
				timeoutMs: config.timeoutMs,
			});

			if (createResult.error) {
				throw new Error(`Failed to create E2B sandbox: ${createResult.error}`);
			}
			this._e2bSandboxId = createResult.sandboxId;
		}

		// Run the command
		const result: any = await channel.call('runCommand', {
			apiKey: config.apiKey,
			sandboxId: this._e2bSandboxId,
			command,
			cwd,
			timeoutMs: config.timeoutMs,
		});

		if (result.error) {
			// If sandbox expired, clear it and retry once
			if (result.error.includes('404') || result.error.includes('not found')) {
				this._e2bSandboxId = null;
				return this.runInE2B(command, cwd);
			}
			throw new Error(`E2B command failed: ${result.error}`);
		}

		return {
			stdout: result.stdout || '',
			stderr: result.stderr || '',
			exitCode: result.exitCode ?? 0,
		};
	}

	async destroyE2BSandbox(): Promise<void> {
		if (!this._e2bSandboxId) return;

		const config = this._settingsService.state.globalSettings.e2bSandboxConfig;
		if (!config.apiKey) return;

		const channel = this._mainProcessService.getChannel('void-channel-e2b-sandbox');
		await channel.call('destroySandbox', {
			apiKey: config.apiKey,
			sandboxId: this._e2bSandboxId,
		});

		this._e2bSandboxId = null;
	}

	private _generateSeatbeltProfile(workspacePath: string, policy: SandboxPolicy): string {
		const readPaths = [
			'/usr', '/bin', '/sbin', '/System/Library', '/opt/homebrew',
			'/Library/Frameworks', '/private/var', '/dev',
			workspacePath, '/tmp',
			...policy.filesystem.readPaths,
		];

		const writePaths = [
			workspacePath, '/tmp', '/private/tmp',
			...policy.filesystem.writePaths,
		];

		// Expand ~ paths using seatbelt's (home-directory-path) literal
		// In the seatbelt profile, we use (string-append (param "HOME") "/...") pattern
		const denyPaths = policy.filesystem.denyPaths.filter(p => !p.startsWith('~/'));
		const denyHomePaths = policy.filesystem.denyPaths.filter(p => p.startsWith('~/')).map(p => p.slice(2));

		let profile = '(version 1)\n(deny default)\n';

		// Allow basic process operations
		profile += '(allow process-exec)\n';
		profile += '(allow process-fork)\n';
		profile += '(allow signal)\n';
		profile += '(allow sysctl-read)\n';
		profile += '(allow mach-lookup)\n';
		profile += '(allow ipc-posix-shm-read-data)\n';
		profile += '(allow ipc-posix-shm-write-data)\n';

		// Deny sensitive paths first (higher priority)
		for (const p of denyPaths) {
			profile += `(deny file-read* (subpath "${p}"))\n`;
			profile += `(deny file-write* (subpath "${p}"))\n`;
		}

		// Deny home-relative paths using seatbelt's home-directory-path
		for (const p of denyHomePaths) {
			profile += `(deny file-read* (subpath (string-append (param "HOME") "/${p}")))\n`;
			profile += `(deny file-write* (subpath (string-append (param "HOME") "/${p}")))\n`;
		}

		// Allow reads
		for (const p of readPaths) {
			profile += `(allow file-read* (subpath "${p}"))\n`;
		}

		// Allow writes
		for (const p of writePaths) {
			profile += `(allow file-write* (subpath "${p}"))\n`;
		}

		// Network access
		if (policy.network.allowed) {
			profile += '(allow network*)\n';
		}

		return profile;
	}
}

registerSingleton(ISandboxService, SandboxService, InstantiationType.Delayed);
