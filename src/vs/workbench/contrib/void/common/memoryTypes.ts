/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export type MemoryType = 'project_fact' | 'decision' | 'pattern' | 'preference';

export interface Memory {
	id: string;
	type: MemoryType;
	content: string;
	context: string;       // brief context about when/why this was stored
	tags: string[];
	createdAt: number;     // ms epoch
	lastAccessedAt: number;
	accessCount: number;
}

export interface MemoryStore {
	version: number;
	memories: Memory[];
}

export interface MemoryConfig {
	enabled: boolean;
	maxMemories: number;
	autoExtract: boolean;  // automatically extract memories after agent loop
}

export const defaultMemoryConfig: MemoryConfig = {
	enabled: false,
	maxMemories: 100,
	autoExtract: false,
};
