/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export interface ScratchpadEntry {
	key: string;
	value: string;
	source: string; // agent/subagent id that wrote this
	timestamp: number;
}

export interface Scratchpad {
	sessionId: string;
	entries: Map<string, ScratchpadEntry>;
	createdAt: number;
}
