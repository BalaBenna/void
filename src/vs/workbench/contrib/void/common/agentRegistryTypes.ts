/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export type AgentSource = 'builtin' | 'project' | 'user'

export interface VoidAgentDefinition {
	id: string;              // slug, e.g. "explore", "security-auditor"
	name: string;
	description: string;
	source: AgentSource;
	model: 'inherit' | string;
	tools: string[] | null;  // null = use chatMode defaults
	readonly: boolean;
	isBackground: boolean;
	maxTokens: number | null;
	timeout: number;         // ms, default 120000
	maxIterations: number;   // default 10
	systemPrompt: string;
	filePath: string | null; // null for builtin
}
