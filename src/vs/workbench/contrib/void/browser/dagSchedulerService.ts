/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { DAGNode, DAGExecution, DAGConflict } from '../common/dagSchedulerTypes.js';
import { ISubagentService } from './subagentServiceInterface.js';
import { IVoidSettingsService } from '../common/voidSettingsService.js';


export interface IDAGSchedulerService {
	readonly _serviceBrand: undefined;

	createDAG(nodes: Omit<DAGNode, 'status'>[], maxConcurrency?: number): DAGExecution;
	executeDAG(executionId: string): Promise<DAGExecution>;
	detectConflicts(nodes: DAGNode[]): DAGConflict[];
	getExecution(executionId: string): DAGExecution | undefined;
}

export const IDAGSchedulerService = createDecorator<IDAGSchedulerService>('voidDAGSchedulerService');


class DAGSchedulerService extends Disposable implements IDAGSchedulerService {
	declare readonly _serviceBrand: undefined;

	private _executions: Map<string, DAGExecution> = new Map();

	constructor(
		@ISubagentService private readonly _subagentService: ISubagentService,
		@IVoidSettingsService private readonly _settingsService: IVoidSettingsService,
	) {
		super();
	}

	createDAG(nodes: Omit<DAGNode, 'status'>[], maxConcurrency?: number): DAGExecution {
		const dagMaxConcurrent = this._settingsService.state.globalSettings.dagMaxConcurrentSubagents ?? 5;
		const execution: DAGExecution = {
			id: generateUuid(),
			nodes: nodes.map(n => ({ ...n, status: 'pending' as const })),
			status: 'pending',
			maxConcurrency: maxConcurrency ?? dagMaxConcurrent,
			createdAt: Date.now(),
		};
		this._executions.set(execution.id, execution);
		return execution;
	}

	async executeDAG(executionId: string): Promise<DAGExecution> {
		const execution = this._executions.get(executionId);
		if (!execution) throw new Error(`DAG execution not found: ${executionId}`);

		// Check for conflicts
		const conflicts = this.detectConflicts(execution.nodes);
		if (conflicts.length > 0) {
			// Mark conflicting nodes — adjust concurrency to serialize them
			for (const conflict of conflicts) {
				const nodeB = execution.nodes.find(n => n.id === conflict.nodeB);
				if (nodeB && !nodeB.dependencies.includes(conflict.nodeA)) {
					nodeB.dependencies.push(conflict.nodeA);
				}
			}
		}

		execution.status = 'running';

		// Topological execution with max concurrency
		const completed = new Set<string>();
		const failed = new Set<string>();

		while (true) {
			// Find nodes ready to run (all dependencies met)
			const ready = execution.nodes.filter(n =>
				n.status === 'pending' &&
				n.dependencies.every(dep => completed.has(dep))
			);

			// If nothing ready and nothing running, we're done
			const running = execution.nodes.filter(n => n.status === 'running');
			if (ready.length === 0 && running.length === 0) break;

			// Skip if nothing new to schedule but things are running (shouldn't happen in this sync approach)
			if (ready.length === 0) break;

			// Respect max concurrency
			const toRun = ready.slice(0, execution.maxConcurrency - running.length);
			if (toRun.length === 0 && running.length > 0) break;

			// Skip nodes whose dependencies failed
			for (const node of ready) {
				if (node.dependencies.some(dep => failed.has(dep))) {
					node.status = 'skipped';
					continue;
				}
			}

			// Run batch in parallel
			const promises = toRun.map(async (node) => {
				node.status = 'running';
				node.startedAt = Date.now();
				try {
					const result = await this._subagentService.spawnSubagent(
						'',
						'custom',
						node.prompt,
						false,
					);
					node.result = result.result ?? '';
					node.status = result.status === 'completed' ? 'completed' : 'failed';
					if (result.status === 'completed') {
						completed.add(node.id);
					} else {
						failed.add(node.id);
						node.error = result.result;
					}
				} catch (e) {
					node.status = 'failed';
					node.error = `${e}`;
					failed.add(node.id);
				} finally {
					node.completedAt = Date.now();
				}
			});

			await Promise.allSettled(promises);
		}

		const allDone = execution.nodes.every(n => n.status !== 'pending' && n.status !== 'running');
		const anyFailed = execution.nodes.some(n => n.status === 'failed');
		execution.status = allDone ? (anyFailed ? 'failed' : 'completed') : 'running';
		execution.completedAt = Date.now();

		return execution;
	}

	detectConflicts(nodes: DAGNode[]): DAGConflict[] {
		const conflicts: DAGConflict[] = [];

		for (let i = 0; i < nodes.length; i++) {
			for (let j = i + 1; j < nodes.length; j++) {
				const a = nodes[i];
				const b = nodes[j];
				if (!a.targetFiles || !b.targetFiles) continue;

				const overlapping = a.targetFiles.filter(f => b.targetFiles!.includes(f));
				if (overlapping.length > 0) {
					// Only a conflict if they can run concurrently (no dependency chain)
					const aDepOnB = this._hasTransitiveDep(nodes, a.id, b.id);
					const bDepOnA = this._hasTransitiveDep(nodes, b.id, a.id);
					if (!aDepOnB && !bDepOnA) {
						conflicts.push({
							nodeA: a.id,
							nodeB: b.id,
							conflictingFiles: overlapping,
						});
					}
				}
			}
		}

		return conflicts;
	}

	private _hasTransitiveDep(nodes: DAGNode[], fromId: string, toId: string): boolean {
		const visited = new Set<string>();
		const stack = [fromId];
		while (stack.length > 0) {
			const current = stack.pop()!;
			if (current === toId) return true;
			if (visited.has(current)) continue;
			visited.add(current);
			const node = nodes.find(n => n.id === current);
			if (node) stack.push(...node.dependencies);
		}
		return false;
	}

	getExecution(executionId: string): DAGExecution | undefined {
		return this._executions.get(executionId);
	}
}

registerSingleton(IDAGSchedulerService, DAGSchedulerService, InstantiationType.Delayed);
