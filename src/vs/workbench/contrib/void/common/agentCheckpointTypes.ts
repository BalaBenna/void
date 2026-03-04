/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ChatMessage } from './chatThreadServiceTypes.js';

export interface AgentCheckpoint {
	id: string;
	threadId: string;
	label?: string;
	messages: ChatMessage[];
	scratchpadState?: Record<string, string>; // key-value from scratchpad
	fileSnapshots: Record<string, string>; // fsPath -> content hash
	createdAt: number;
	iterationIndex: number;
}
