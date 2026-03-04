/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { AgentCheckpoint } from '../common/agentCheckpointTypes.js';
import { ChatMessage } from '../common/chatThreadServiceTypes.js';


export interface IAgentCheckpointService {
	readonly _serviceBrand: undefined;

	onDidCreateCheckpoint: Event<AgentCheckpoint>;

	saveCheckpoint(threadId: string, messages: ChatMessage[], label?: string, iterationIndex?: number): AgentCheckpoint;
	restoreCheckpoint(checkpointId: string): AgentCheckpoint | undefined;
	branchFromCheckpoint(checkpointId: string): { threadId: string; messages: ChatMessage[] } | undefined;
	listCheckpoints(threadId: string): AgentCheckpoint[];
	deleteCheckpoint(checkpointId: string): void;
}

export const IAgentCheckpointService = createDecorator<IAgentCheckpointService>('voidAgentCheckpointService');


class AgentCheckpointService extends Disposable implements IAgentCheckpointService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidCreateCheckpoint = new Emitter<AgentCheckpoint>();
	readonly onDidCreateCheckpoint: Event<AgentCheckpoint> = this._onDidCreateCheckpoint.event;

	private _checkpoints: Map<string, AgentCheckpoint> = new Map();
	private _checkpointsByThread: Map<string, string[]> = new Map(); // threadId -> checkpointIds

	saveCheckpoint(threadId: string, messages: ChatMessage[], label?: string, iterationIndex?: number): AgentCheckpoint {
		const checkpoint: AgentCheckpoint = {
			id: generateUuid(),
			threadId,
			label,
			messages: [...messages], // shallow copy
			fileSnapshots: {},
			createdAt: Date.now(),
			iterationIndex: iterationIndex ?? 0,
		};

		this._checkpoints.set(checkpoint.id, checkpoint);

		let threadCheckpoints = this._checkpointsByThread.get(threadId);
		if (!threadCheckpoints) {
			threadCheckpoints = [];
			this._checkpointsByThread.set(threadId, threadCheckpoints);
		}
		threadCheckpoints.push(checkpoint.id);

		this._onDidCreateCheckpoint.fire(checkpoint);
		return checkpoint;
	}

	restoreCheckpoint(checkpointId: string): AgentCheckpoint | undefined {
		return this._checkpoints.get(checkpointId);
	}

	branchFromCheckpoint(checkpointId: string): { threadId: string; messages: ChatMessage[] } | undefined {
		const checkpoint = this._checkpoints.get(checkpointId);
		if (!checkpoint) return undefined;

		const newThreadId = generateUuid();
		return {
			threadId: newThreadId,
			messages: [...checkpoint.messages],
		};
	}

	listCheckpoints(threadId: string): AgentCheckpoint[] {
		const ids = this._checkpointsByThread.get(threadId) || [];
		return ids
			.map(id => this._checkpoints.get(id))
			.filter((c): c is AgentCheckpoint => c !== undefined);
	}

	deleteCheckpoint(checkpointId: string): void {
		const checkpoint = this._checkpoints.get(checkpointId);
		if (!checkpoint) return;

		this._checkpoints.delete(checkpointId);
		const threadCheckpoints = this._checkpointsByThread.get(checkpoint.threadId);
		if (threadCheckpoints) {
			const idx = threadCheckpoints.indexOf(checkpointId);
			if (idx !== -1) threadCheckpoints.splice(idx, 1);
		}
	}
}

registerSingleton(IAgentCheckpointService, AgentCheckpointService, InstantiationType.Delayed);
