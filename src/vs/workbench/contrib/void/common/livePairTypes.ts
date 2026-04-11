/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export interface PairSession {
	id: string;
	hostId: string;
	participants: PairParticipant[];
	createdAt: number;
	status: 'active' | 'ended';
}

export interface PairParticipant {
	id: string;
	name: string;
	type: 'human' | 'ai';
	cursorFile?: string;
	cursorLine?: number;
	cursorColumn?: number;
	color: string;
}

export interface LivePairConfig {
	enabled: boolean;
	serverUrl: string;
}

export const defaultLivePairConfig: LivePairConfig = {
	enabled: false,
	serverUrl: 'ws://localhost:4567',
};
