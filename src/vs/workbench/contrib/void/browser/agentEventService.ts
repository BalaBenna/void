/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { AgentEvent, AgentEventType } from '../common/agentEventTypes.js';

export interface IAgentEventService {
	readonly _serviceBrand: undefined;
	onDidEmitEvent: Event<AgentEvent>;
	emit(event: AgentEvent): void;
	emitSimple(type: AgentEventType, threadId: string, iteration: number, maxIterations: number, data?: Record<string, unknown>): void;
}

export const IAgentEventService = createDecorator<IAgentEventService>('voidAgentEventService');

class AgentEventService extends Disposable implements IAgentEventService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidEmitEvent = new Emitter<AgentEvent>();
	readonly onDidEmitEvent: Event<AgentEvent> = this._onDidEmitEvent.event;

	emit(event: AgentEvent): void {
		this._onDidEmitEvent.fire(event);
	}

	emitSimple(type: AgentEventType, threadId: string, iteration: number, maxIterations: number, data?: Record<string, unknown>): void {
		this._onDidEmitEvent.fire({
			type,
			threadId,
			timestamp: Date.now(),
			iteration,
			maxIterations,
			data,
		});
	}
}

registerSingleton(IAgentEventService, AgentEventService, InstantiationType.Eager);
