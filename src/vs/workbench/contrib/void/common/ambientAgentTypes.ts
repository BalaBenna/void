/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export type AmbientMonitorType = 'lint' | 'test' | 'security' | 'dependency';

export interface AmbientFinding {
	id: string;
	type: AmbientMonitorType;
	severity: 'info' | 'warning' | 'error';
	message: string;
	filePath?: string;
	line?: number;
	suggestion?: string;
	timestamp: number;
}

export interface AmbientAgentConfig {
	enabled: boolean;
	checkIntervalMs: number;        // How often to check (default 30s)
	monitors: {
		lint: boolean;                // Watch for new lint errors on save
		test: boolean;                // Suggest test runs when test/tested code changes
		security: boolean;            // Scan for secrets/vulnerabilities
		dependency: boolean;          // Check for outdated/vulnerable packages
	};
	sensitivity: 'aggressive' | 'balanced' | 'quiet';
}

export const defaultAmbientAgentConfig: AmbientAgentConfig = {
	enabled: false,
	checkIntervalMs: 30_000,
	monitors: {
		lint: true,
		test: true,
		security: true,
		dependency: false,
	},
	sensitivity: 'balanced',
};
