/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ScratchpadEntry } from '../common/scratchpadTypes.js';


export interface IScratchpadService {
	readonly _serviceBrand: undefined;

	createSession(): string;
	set(sessionId: string, key: string, value: string, source: string): void;
	get(sessionId: string, key: string): ScratchpadEntry | undefined;
	getAll(sessionId: string): ScratchpadEntry[];
	clearSession(sessionId: string): void;
	getSessionSummary(sessionId: string): string;
}

export const IScratchpadService = createDecorator<IScratchpadService>('voidScratchpadService');


class ScratchpadService extends Disposable implements IScratchpadService {
	declare readonly _serviceBrand: undefined;

	private _sessions: Map<string, Map<string, ScratchpadEntry>> = new Map();

	createSession(): string {
		const sessionId = generateUuid();
		this._sessions.set(sessionId, new Map());
		return sessionId;
	}

	set(sessionId: string, key: string, value: string, source: string): void {
		let session = this._sessions.get(sessionId);
		if (!session) {
			session = new Map();
			this._sessions.set(sessionId, session);
		}
		session.set(key, {
			key,
			value,
			source,
			timestamp: Date.now(),
		});
	}

	get(sessionId: string, key: string): ScratchpadEntry | undefined {
		return this._sessions.get(sessionId)?.get(key);
	}

	getAll(sessionId: string): ScratchpadEntry[] {
		const session = this._sessions.get(sessionId);
		if (!session) return [];
		return Array.from(session.values());
	}

	clearSession(sessionId: string): void {
		this._sessions.delete(sessionId);
	}

	getSessionSummary(sessionId: string): string {
		const entries = this.getAll(sessionId);
		if (entries.length === 0) return '';
		return entries
			.map(e => `[${e.key}] (by ${e.source}): ${e.value}`)
			.join('\n');
	}
}

registerSingleton(IScratchpadService, ScratchpadService, InstantiationType.Eager);
