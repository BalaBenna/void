/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Emitter, Event } from '../../../../base/common/event.js';


export type AgentStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';

export interface AgentEntry {
	id: string;
	name: string;
	type: 'chat' | 'background' | 'parallel' | 'subagent';
	status: AgentStatus;
	model: string;
	startedAt: number;
	completedAt?: number;
	tokenCount: number;
	lastAction?: string;
	threadId?: string;
}

export interface MissionControlStats {
	tokensUsedToday: number;
	tasksCompletedToday: number;
	activeAgentCount: number;
	estimatedCostToday: number;
}

export interface IMissionControlService {
	readonly _serviceBrand: undefined;

	readonly onDidChange: Event<void>;

	getActiveAgents(): AgentEntry[];
	getRecentAgents(maxCount?: number): AgentEntry[];
	getStats(): MissionControlStats;

	registerAgent(entry: Omit<AgentEntry, 'status' | 'startedAt' | 'tokenCount'>): string;
	updateAgent(id: string, update: Partial<AgentEntry>): void;
	cancelAgent(id: string): void;
	cancelAll(): void;
}

export const IMissionControlService = createDecorator<IMissionControlService>('voidMissionControlService');


class MissionControlService extends Disposable implements IMissionControlService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private _agents: Map<string, AgentEntry> = new Map();
	private _tokensUsedToday = 0;
	private _tasksCompletedToday = 0;
	private _todayStart = this._getTodayStart();

	private _getTodayStart(): number {
		const now = new Date();
		return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	}

	private _resetDailyStatsIfNeeded(): void {
		const todayStart = this._getTodayStart();
		if (todayStart !== this._todayStart) {
			this._todayStart = todayStart;
			this._tokensUsedToday = 0;
			this._tasksCompletedToday = 0;
		}
	}

	getActiveAgents(): AgentEntry[] {
		return [...this._agents.values()].filter(a => a.status === 'running' || a.status === 'paused');
	}

	getRecentAgents(maxCount: number = 20): AgentEntry[] {
		return [...this._agents.values()]
			.sort((a, b) => b.startedAt - a.startedAt)
			.slice(0, maxCount);
	}

	getStats(): MissionControlStats {
		this._resetDailyStatsIfNeeded();
		return {
			tokensUsedToday: this._tokensUsedToday,
			tasksCompletedToday: this._tasksCompletedToday,
			activeAgentCount: this.getActiveAgents().length,
			estimatedCostToday: this._tokensUsedToday * 0.000003, // rough estimate
		};
	}

	registerAgent(entry: Omit<AgentEntry, 'status' | 'startedAt' | 'tokenCount'>): string {
		const agent: AgentEntry = {
			...entry,
			status: 'running',
			startedAt: Date.now(),
			tokenCount: 0,
		};
		this._agents.set(agent.id, agent);
		this._onDidChange.fire();
		return agent.id;
	}

	updateAgent(id: string, update: Partial<AgentEntry>): void {
		const agent = this._agents.get(id);
		if (!agent) return;

		if (update.tokenCount) {
			this._tokensUsedToday += update.tokenCount - agent.tokenCount;
		}

		Object.assign(agent, update);

		if (update.status === 'completed') {
			agent.completedAt = Date.now();
			this._tasksCompletedToday++;
		}

		this._onDidChange.fire();
	}

	cancelAgent(id: string): void {
		this.updateAgent(id, { status: 'cancelled' });
	}

	cancelAll(): void {
		for (const agent of this.getActiveAgents()) {
			this.cancelAgent(agent.id);
		}
	}
}

registerSingleton(IMissionControlService, MissionControlService, InstantiationType.Eager);
