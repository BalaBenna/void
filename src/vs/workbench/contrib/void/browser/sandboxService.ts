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

export interface ISandboxService {
	readonly _serviceBrand: undefined;
	wrapCommand(command: string): string;
	classifyRisk(command: string): CommandRiskLevel;
	isSandboxAvailable(): boolean;
	getSandboxMode(): SandboxMode;
}

export const ISandboxService = createDecorator<ISandboxService>('voidSandboxService');

class SandboxService extends Disposable implements ISandboxService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IvoidSettingsService private readonly _settingsService: IvoidSettingsService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IAgentEventService _agentEventService: IAgentEventService,
	) {
		super();
	}

	isSandboxAvailable(): boolean {
		return os === 'mac'; // sandbox-exec is macOS only
	}

	getSandboxMode(): SandboxMode {
		return this._settingsService.state.globalSettings.sandboxMode;
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

		if (sandboxMode === 'off' || !this.isSandboxAvailable()) {
			return command;
		}

		const policy = this._settingsService.state.globalSettings.sandboxPolicy;
		const workspacePaths = this._workspaceContextService.getWorkspace().folders.map(f => f.uri.fsPath);
		const workspacePath = workspacePaths[0] || '/tmp';

		const profile = this._generateSeatbeltProfile(workspacePath, policy);
		const escapedCommand = command.replace(/'/g, "'\\''");
		return `sandbox-exec -p '${profile}' /bin/bash -c '${escapedCommand}'`;
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
