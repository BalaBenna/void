/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export type SandboxMode = 'off' | 'auto_run' | 'strict' | 'e2b';
export type CommandRiskLevel = 'safe' | 'moderate' | 'dangerous' | 'critical';

export interface SandboxPolicy {
	workspacePath: string;
	filesystem: {
		readPaths: string[];
		writePaths: string[];
		denyPaths: string[];
	};
	network: { allowed: boolean };
	maxExecutionTimeMs: number;
}

export interface YoloConfig {
	enabled: boolean;
	allowlist: string[];
	denylist: string[];
}

export const defaultSandboxPolicy: SandboxPolicy = {
	workspacePath: '',
	filesystem: {
		readPaths: [],
		writePaths: [],
		denyPaths: ['~/.ssh', '~/.aws', '~/.npmrc', '~/.config', '~/.gnupg'],
	},
	network: { allowed: true },
	maxExecutionTimeMs: 300_000,
};

export const defaultYoloConfig: YoloConfig = {
	enabled: false,
	allowlist: ['npm test*', 'npm run*', 'git status', 'git log*', 'git diff*', 'ls*', 'cat*', 'echo*'],
	denylist: ['rm -rf*', 'sudo*', 'git push --force*', 'chmod*', 'dd *', 'mkfs*'],
};

export interface E2BSandboxConfig {
	template?: string;         // Custom sandbox template (optional)
	timeoutMs: number;         // Default: 300_000 (5 min)
}

export const defaultE2BSandboxConfig: E2BSandboxConfig = {
	template: undefined,
	timeoutMs: 300_000,
};
