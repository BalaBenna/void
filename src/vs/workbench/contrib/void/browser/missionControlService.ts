/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IParallelAgentService } from './parallelAgentService.js';


export type AgentStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed';

export interface AgentSummary {
	id: string;
	name: string;
	type: string;
	status: AgentStatus;
	progress?: number; // 0-100
	filesModified: string[];
	errors: string[];
	startedAt?: number;
}

export interface IMissionControlService {
	readonly _serviceBrand: undefined;

	onDidChangeAgentStates: Event<void>;

	getActiveAgents(): AgentSummary[];
	pauseAgent(agentId: string): void;
	resumeAgent(agentId: string): void;
	cancelAgent(agentId: string): void;
	getAgentSummary(agentId: string): AgentSummary | undefined;
}

export const IMissionControlService = createDecorator<IMissionControlService>('voidMissionControlService');


class MissionControlService extends Disposable implements IMissionControlService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeAgentStates = new Emitter<void>();
	readonly onDidChangeAgentStates: Event<void> = this._onDidChangeAgentStates.event;

	private _agents: Map<string, AgentSummary> = new Map();

	// Lazy circular dependency resolution
	private _parallelAgentServiceLazy: IParallelAgentService | undefined;
	private get parallelAgentService(): IParallelAgentService {
		if (!this._parallelAgentServiceLazy) {
			this._parallelAgentServiceLazy = this._instantiationService.invokeFunction(
				accessor => accessor.get(IParallelAgentService)
			);
		}
		return this._parallelAgentServiceLazy;
	}

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();
	}

	getActiveAgents(): AgentSummary[] {
		// Aggregate from parallel agent executions
		const parallelExecutions = this.parallelAgentService.getActiveExecutions();
		const summaries: AgentSummary[] = [];

		for (const exec of parallelExecutions) {
			for (const task of exec.tasks) {
				summaries.push({
					id: task.id,
					name: `Parallel: ${task.prompt.substring(0, 50)}`,
					type: exec.mode,
					status: task.status === 'running' ? 'running' :
						task.status === 'completed' ? 'completed' :
							task.status === 'failed' ? 'failed' : 'idle',
					filesModified: [],
					errors: task.error ? [task.error] : [],
					startedAt: task.startedAt,
				});
			}
		}

		// Add tracked agents
		for (const agent of this._agents.values()) {
			summaries.push(agent);
		}

		return summaries;
	}

	pauseAgent(_agentId: string): void {
		const agent = this._agents.get(_agentId);
		if (agent) {
			agent.status = 'paused';
			this._onDidChangeAgentStates.fire();
		}
	}

	resumeAgent(_agentId: string): void {
		const agent = this._agents.get(_agentId);
		if (agent && agent.status === 'paused') {
			agent.status = 'running';
			this._onDidChangeAgentStates.fire();
		}
	}

	cancelAgent(_agentId: string): void {
		const agent = this._agents.get(_agentId);
		if (agent) {
			agent.status = 'failed';
			this._onDidChangeAgentStates.fire();
		}
	}

	getAgentSummary(agentId: string): AgentSummary | undefined {
		return this._agents.get(agentId);
	}
}

registerSingleton(IMissionControlService, MissionControlService, InstantiationType.Eager);
