/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useState, useEffect, useCallback } from 'react';
import { useAccessor } from '../util/services.js';
import { Activity, Clock, Cpu, DollarSign, Pause, Play, Square, Trash2 } from 'lucide-react';

import type { AgentEntry, MissionControlStats } from '../../../missionControlService.js';

export const MissionControl: React.FC = () => {
	const accessor = useAccessor();
	const missionControlService = accessor.get('IMissionControlService');

	const [agents, setAgents] = useState<AgentEntry[]>([]);
	const [stats, setStats] = useState<MissionControlStats>({
		tokensUsedToday: 0,
		tasksCompletedToday: 0,
		activeAgentCount: 0,
		estimatedCostToday: 0,
	});

	const refresh = useCallback(() => {
		setAgents(missionControlService.getRecentAgents(20));
		setStats(missionControlService.getStats());
	}, [missionControlService]);

	useEffect(() => {
		refresh();
		const disposable = missionControlService.onDidChange(() => refresh());
		return () => disposable.dispose();
	}, [missionControlService, refresh]);

	const activeAgents = agents.filter(a => a.status === 'running' || a.status === 'paused');
	const recentAgents = agents.filter(a => a.status !== 'running' && a.status !== 'paused');

	const formatDuration = (startMs: number, endMs?: number) => {
		const durationMs = (endMs ?? Date.now()) - startMs;
		const seconds = Math.floor(durationMs / 1000);
		if (seconds < 60) return `${seconds}s`;
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
		return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
	};

	const statusColor = (status: AgentEntry['status']) => {
		switch (status) {
			case 'running': return 'text-green-400';
			case 'completed': return 'text-blue-400';
			case 'failed': return 'text-red-400';
			case 'cancelled': return 'text-yellow-400';
			case 'paused': return 'text-orange-400';
		}
	};

	return (
		<div className="flex flex-col h-full">
			{/* Stats Header */}
			<div className="grid grid-cols-2 gap-2 p-3 border-b border-void-border-1">
				<div className="flex items-center gap-2 text-xs">
					<Activity size={14} className="text-green-400" />
					<span className="text-void-fg-3">Active:</span>
					<span className="text-void-fg-1 font-medium">{stats.activeAgentCount}</span>
				</div>
				<div className="flex items-center gap-2 text-xs">
					<Cpu size={14} className="text-blue-400" />
					<span className="text-void-fg-3">Tokens:</span>
					<span className="text-void-fg-1 font-medium">{(stats.tokensUsedToday / 1000).toFixed(1)}K</span>
				</div>
				<div className="flex items-center gap-2 text-xs">
					<Clock size={14} className="text-purple-400" />
					<span className="text-void-fg-3">Tasks:</span>
					<span className="text-void-fg-1 font-medium">{stats.tasksCompletedToday}</span>
				</div>
				<div className="flex items-center gap-2 text-xs">
					<DollarSign size={14} className="text-yellow-400" />
					<span className="text-void-fg-3">Cost:</span>
					<span className="text-void-fg-1 font-medium">${stats.estimatedCostToday.toFixed(3)}</span>
				</div>
			</div>

			{/* Active Agents */}
			{activeAgents.length > 0 && (
				<div className="border-b border-void-border-1">
					<div className="flex items-center justify-between px-3 py-2">
						<span className="text-xs font-medium text-void-fg-2">Active Agents</span>
						<button
							className="text-xs text-red-400 hover:text-red-300"
							onClick={() => missionControlService.cancelAll()}
						>
							Cancel All
						</button>
					</div>
					{activeAgents.map(agent => (
						<div key={agent.id} className="px-3 py-2 hover:bg-void-bg-2 border-t border-void-border-1/50">
							<div className="flex items-center justify-between">
								<span className="text-sm text-void-fg-1 truncate">{agent.name}</span>
								<div className="flex items-center gap-1">
									<span className={`text-xs ${statusColor(agent.status)}`}>{agent.status}</span>
									<button
										className="p-0.5 hover:bg-void-bg-3 rounded"
										onClick={() => missionControlService.cancelAgent(agent.id)}
										title="Cancel"
									>
										<Square size={10} className="text-red-400" />
									</button>
								</div>
							</div>
							<div className="flex items-center gap-3 mt-1 text-xs text-void-fg-3">
								<span>{agent.model}</span>
								<span>{formatDuration(agent.startedAt)}</span>
								{agent.lastAction && <span className="truncate">{agent.lastAction}</span>}
							</div>
						</div>
					))}
				</div>
			)}

			{/* Recent Agents */}
			<div className="flex-1 overflow-y-auto">
				<div className="px-3 py-2">
					<span className="text-xs font-medium text-void-fg-2">Recent</span>
				</div>
				{recentAgents.length === 0 ? (
					<div className="text-center text-void-fg-3 text-xs py-8">
						No recent agents
					</div>
				) : (
					recentAgents.map(agent => (
						<div key={agent.id} className="px-3 py-2 hover:bg-void-bg-2 border-t border-void-border-1/50">
							<div className="flex items-center justify-between">
								<span className="text-sm text-void-fg-1 truncate">{agent.name}</span>
								<span className={`text-xs ${statusColor(agent.status)}`}>{agent.status}</span>
							</div>
							<div className="flex items-center gap-3 mt-1 text-xs text-void-fg-3">
								<span>{agent.model}</span>
								<span>{formatDuration(agent.startedAt, agent.completedAt)}</span>
								<span>{(agent.tokenCount / 1000).toFixed(1)}K tokens</span>
							</div>
						</div>
					))
				)}
			</div>
		</div>
	);
};
