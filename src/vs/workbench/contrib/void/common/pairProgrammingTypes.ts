/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export interface PairSession {
	id: string;
	hostUserId: string;
	guestUserIds: string[];
	status: 'waiting' | 'connected' | 'disconnected';
	createdAt: number;
}

export interface PairCursor {
	userId: string;
	file: string;
	line: number;
	column: number;
	color: string;
}

export interface PairConflict {
	file: string;
	region: { startLine: number; endLine: number };
	users: string[];
}
