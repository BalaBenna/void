/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { generateUuid } from '../../../../base/common/uuid.js';

import { PairSession, PairParticipant } from '../common/livePairTypes.js';


export interface ILivePairService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeSession: Event<PairSession | null>;
	readonly onDidUpdateParticipant: Event<PairParticipant>;

	/**
	 * Create a new pair programming session and generate a share link.
	 */
	createSession(): Promise<PairSession>;

	/**
	 * Join an existing session by ID or share link.
	 */
	joinSession(sessionId: string): Promise<PairSession | null>;

	/**
	 * Leave the current session.
	 */
	leaveSession(): void;

	/**
	 * Get the current session, or null if not in one.
	 */
	getCurrentSession(): PairSession | null;

	/**
	 * Update this participant's cursor position (broadcast to others).
	 */
	updateCursor(file: string, line: number, column: number): void;
}

export const ILivePairService = createDecorator<ILivePairService>('voidLivePairService');


class LivePairService extends Disposable implements ILivePairService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeSession = this._register(new Emitter<PairSession | null>());
	readonly onDidChangeSession: Event<PairSession | null> = this._onDidChangeSession.event;

	private readonly _onDidUpdateParticipant = this._register(new Emitter<PairParticipant>());
	readonly onDidUpdateParticipant: Event<PairParticipant> = this._onDidUpdateParticipant.event;

	private _currentSession: PairSession | null = null;
	private _participantId: string = generateUuid();
	private _ws: WebSocket | null = null;

	async createSession(): Promise<PairSession> {
		const session: PairSession = {
			id: generateUuid(),
			hostId: this._participantId,
			participants: [{
				id: this._participantId,
				name: 'Host',
				type: 'human',
				color: '#4CAF50',
			}],
			createdAt: Date.now(),
			status: 'active',
		};

		this._currentSession = session;
		this._onDidChangeSession.fire(session);

		// TODO: Connect to WebSocket relay server
		// this._connectToServer(session.id);

		return session;
	}

	async joinSession(sessionId: string): Promise<PairSession | null> {
		// TODO: Connect to WebSocket relay and sync state
		const session: PairSession = {
			id: sessionId,
			hostId: '',
			participants: [{
				id: this._participantId,
				name: 'Guest',
				type: 'human',
				color: '#2196F3',
			}],
			createdAt: Date.now(),
			status: 'active',
		};

		this._currentSession = session;
		this._onDidChangeSession.fire(session);
		return session;
	}

	leaveSession(): void {
		if (this._ws) {
			this._ws.close();
			this._ws = null;
		}
		this._currentSession = null;
		this._onDidChangeSession.fire(null);
	}

	getCurrentSession(): PairSession | null {
		return this._currentSession;
	}

	updateCursor(file: string, line: number, column: number): void {
		if (!this._currentSession) return;

		const participant = this._currentSession.participants.find(p => p.id === this._participantId);
		if (participant) {
			participant.cursorFile = file;
			participant.cursorLine = line;
			participant.cursorColumn = column;
			this._onDidUpdateParticipant.fire(participant);
		}

		// TODO: Broadcast cursor update via WebSocket
	}

	override dispose(): void {
		this.leaveSession();
		super.dispose();
	}
}

registerSingleton(ILivePairService, LivePairService, InstantiationType.Delayed);
