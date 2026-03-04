/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { PairSession, PairCursor } from '../common/pairProgrammingTypes.js';


export interface IPairProgrammingService {
	readonly _serviceBrand: undefined;

	onDidChangeSession: Event<PairSession | null>;
	onDidUpdateCursors: Event<PairCursor[]>;

	createSession(): PairSession;
	joinSession(sessionId: string): Promise<boolean>;
	leaveSession(): void;
	getSession(): PairSession | null;
	getCursors(): PairCursor[];
	updateCursor(cursor: PairCursor): void;
}

export const IPairProgrammingService = createDecorator<IPairProgrammingService>('voidPairProgrammingService');


class PairProgrammingService extends Disposable implements IPairProgrammingService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeSession = new Emitter<PairSession | null>();
	readonly onDidChangeSession: Event<PairSession | null> = this._onDidChangeSession.event;

	private readonly _onDidUpdateCursors = new Emitter<PairCursor[]>();
	readonly onDidUpdateCursors: Event<PairCursor[]> = this._onDidUpdateCursors.event;

	private _session: PairSession | null = null;
	private _cursors: Map<string, PairCursor> = new Map();

	createSession(): PairSession {
		this._session = {
			id: generateUuid(),
			hostUserId: generateUuid(), // Would be real user ID
			guestUserIds: [],
			status: 'waiting',
			createdAt: Date.now(),
		};
		this._onDidChangeSession.fire(this._session);
		return this._session;
	}

	async joinSession(_sessionId: string): Promise<boolean> {
		// In a full implementation, this would connect via WebRTC/WebSocket
		// For now, this is a placeholder
		return false;
	}

	leaveSession(): void {
		this._session = null;
		this._cursors.clear();
		this._onDidChangeSession.fire(null);
	}

	getSession(): PairSession | null {
		return this._session;
	}

	getCursors(): PairCursor[] {
		return Array.from(this._cursors.values());
	}

	updateCursor(cursor: PairCursor): void {
		this._cursors.set(cursor.userId, cursor);
		this._onDidUpdateCursors.fire(this.getCursors());
	}
}

registerSingleton(IPairProgrammingService, PairProgrammingService, InstantiationType.Delayed);
