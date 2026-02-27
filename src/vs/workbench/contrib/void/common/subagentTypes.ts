/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export type BuiltinSubagentType = 'explore' | 'bash' | 'browser' | 'custom'

// SubagentType is now any string to support custom agent IDs from the registry
export type SubagentType = string

export interface SubagentDefinition {
	name: string;
	description: string;
	model: 'inherit' | 'fast' | string;
	readonly: boolean;
	isBackground: boolean;
	prompt: string;
	type: SubagentType;
}

export interface SubagentExecution {
	id: string;
	parentThreadId: string;
	definition: SubagentDefinition;
	status: 'running' | 'completed' | 'failed';
	result?: string;
}
