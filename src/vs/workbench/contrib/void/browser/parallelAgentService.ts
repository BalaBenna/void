/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { generateUuid } from '../../../../base/common/uuid.js';

import { ParallelAgentExecution, ParallelAgentMode, ParallelAgentTask } from '../common/parallelAgentTypes.js';
import { IVoidSettingsService } from '../common/voidSettingsService.js';
import { ISubagentService } from './subagentServiceInterface.js';
import { ITerminalToolService } from './terminalToolService.js';
import { ModelSelection } from '../common/voidSettingsTypes.js';


export interface IParallelAgentService {
	readonly _serviceBrand: undefined;

	/**
	 * Fan-out mode: break the task into subtasks, each runs in its own worktree.
	 * Returns the execution with all task results.
	 */
	fanOut(opts: {
		parentThreadId: string;
		subtasks: { prompt: string; modelSelection?: ModelSelection }[];
	}): Promise<ParallelAgentExecution>;

	/**
	 * Best-of-N mode: same prompt runs N times with different model configs.
	 * Returns the execution with all results for comparison.
	 */
	bestOfN(opts: {
		parentThreadId: string;
		prompt: string;
		modelSelections: ModelSelection[];
	}): Promise<ParallelAgentExecution>;

	/**
	 * Merge a specific task's branch into the main branch.
	 */
	mergeTask(executionId: string, taskId: string): Promise<{ success: boolean; error?: string }>;

	/**
	 * Discard a task's worktree and branch.
	 */
	discardTask(executionId: string, taskId: string): Promise<void>;

	/**
	 * Clean up all worktrees for an execution.
	 */
	cleanupExecution(executionId: string): Promise<void>;

	getExecution(executionId: string): ParallelAgentExecution | undefined;
	getActiveExecutions(): ParallelAgentExecution[];
}

export const IParallelAgentService = createDecorator<IParallelAgentService>('voidParallelAgentService');


class ParallelAgentService extends Disposable implements IParallelAgentService {
	declare readonly _serviceBrand: undefined;

	private _executions: Map<string, ParallelAgentExecution> = new Map();

	constructor(
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IVoidSettingsService private readonly _settingsService: IVoidSettingsService,
		@ISubagentService private readonly _subagentService: ISubagentService,
		@ITerminalToolService private readonly _terminalToolService: ITerminalToolService,
	) {
		super();
	}

	private _getWorkspacePath(): string | null {
		const folders = this._workspaceContextService.getWorkspace().folders;
		return folders.length > 0 ? folders[0].uri.fsPath : null;
	}

	async fanOut(opts: {
		parentThreadId: string;
		subtasks: { prompt: string; modelSelection?: ModelSelection }[];
	}): Promise<ParallelAgentExecution> {
		const config = this._settingsService.state.globalSettings.parallelAgentConfig;

		if (!config.enabled) {
			return this._createFailedExecution(opts.parentThreadId, 'fan-out', 'Parallel agents are disabled in settings.');
		}

		const effectiveSubtasks = opts.subtasks.slice(0, config.maxParallelAgents);

		const execution: ParallelAgentExecution = {
			id: generateUuid(),
			parentThreadId: opts.parentThreadId,
			mode: 'fan-out',
			originalPrompt: effectiveSubtasks.map(s => s.prompt).join('; '),
			tasks: effectiveSubtasks.map(s => ({
				id: generateUuid(),
				prompt: s.prompt,
				modelSelection: s.modelSelection,
				status: 'pending',
			})),
			status: 'running',
			createdAt: Date.now(),
		};
		this._executions.set(execution.id, execution);

		// Create worktrees and run agents in parallel
		const promises = execution.tasks.map(task => this._runTaskInWorktree(execution.id, task));
		await Promise.allSettled(promises);

		// Update execution status
		const allCompleted = execution.tasks.every(t => t.status === 'completed' || t.status === 'failed');
		execution.status = allCompleted ? 'completed' : 'running';

		return execution;
	}

	async bestOfN(opts: {
		parentThreadId: string;
		prompt: string;
		modelSelections: ModelSelection[];
	}): Promise<ParallelAgentExecution> {
		const config = this._settingsService.state.globalSettings.parallelAgentConfig;

		if (!config.enabled) {
			return this._createFailedExecution(opts.parentThreadId, 'best-of-n', 'Parallel agents are disabled in settings.');
		}

		const effectiveModels = opts.modelSelections.slice(0, config.maxParallelAgents);

		const execution: ParallelAgentExecution = {
			id: generateUuid(),
			parentThreadId: opts.parentThreadId,
			mode: 'best-of-n',
			originalPrompt: opts.prompt,
			tasks: effectiveModels.map(ms => ({
				id: generateUuid(),
				prompt: opts.prompt,
				modelSelection: ms,
				status: 'pending',
			})),
			status: 'running',
			createdAt: Date.now(),
		};
		this._executions.set(execution.id, execution);

		// Create worktrees and run agents in parallel
		const promises = execution.tasks.map(task => this._runTaskInWorktree(execution.id, task));
		await Promise.allSettled(promises);

		execution.status = 'completed';
		return execution;
	}

	private async _runTaskInWorktree(executionId: string, task: ParallelAgentTask): Promise<void> {
		const workspacePath = this._getWorkspacePath();
		if (!workspacePath) {
			task.status = 'failed';
			task.error = 'No workspace folder found.';
			return;
		}

		task.status = 'running';
		task.startedAt = Date.now();

		const branchName = `agent/${task.id.substring(0, 8)}`;
		const worktreePath = `${workspacePath}/.void/worktrees/${task.id.substring(0, 8)}`;

		try {
			// Create git worktree
			const createResult = await this._runGitCommand(
				`git worktree add "${worktreePath}" -b "${branchName}"`,
				workspacePath
			);
			if (!createResult.success) {
				task.status = 'failed';
				task.error = `Failed to create worktree: ${createResult.output}`;
				return;
			}

			task.worktreePath = worktreePath;
			task.branchName = branchName;

			// Run the subagent with context about the worktree
			const contextualPrompt = `You are working in a git worktree at: ${worktreePath}\nAll file edits should be relative to this path.\n\n${task.prompt}`;

			const subExecution = await this._subagentService.spawnSubagent(
				'', // no parent thread for parallel agents
				'custom',
				contextualPrompt,
				false, // wait for completion
			);

			task.result = subExecution.result ?? 'No result';
			task.status = subExecution.status === 'completed' ? 'completed' : 'failed';
			if (subExecution.status === 'failed') {
				task.error = subExecution.result;
			}
		} catch (e) {
			task.status = 'failed';
			task.error = `Worktree agent error: ${e}`;
		} finally {
			task.completedAt = Date.now();
		}
	}

	async mergeTask(executionId: string, taskId: string): Promise<{ success: boolean; error?: string }> {
		const execution = this._executions.get(executionId);
		if (!execution) return { success: false, error: 'Execution not found.' };

		const task = execution.tasks.find(t => t.id === taskId);
		if (!task) return { success: false, error: 'Task not found.' };
		if (!task.branchName) return { success: false, error: 'No branch associated with this task.' };

		const workspacePath = this._getWorkspacePath();
		if (!workspacePath) return { success: false, error: 'No workspace.' };

		// Merge the branch
		const mergeResult = await this._runGitCommand(
			`git merge "${task.branchName}" --no-ff -m "Merge parallel agent: ${task.prompt.substring(0, 50)}"`,
			workspacePath
		);

		if (!mergeResult.success) {
			return { success: false, error: `Merge failed: ${mergeResult.output}` };
		}

		execution.selectedTaskId = taskId;

		// Clean up if configured
		const config = this._settingsService.state.globalSettings.parallelAgentConfig;
		if (config.cleanupAfterMerge) {
			await this._cleanupTask(task, workspacePath);
		}

		return { success: true };
	}

	async discardTask(executionId: string, taskId: string): Promise<void> {
		const execution = this._executions.get(executionId);
		if (!execution) return;

		const task = execution.tasks.find(t => t.id === taskId);
		if (!task) return;

		const workspacePath = this._getWorkspacePath();
		if (!workspacePath) return;

		await this._cleanupTask(task, workspacePath);
		task.status = 'cancelled';
	}

	async cleanupExecution(executionId: string): Promise<void> {
		const execution = this._executions.get(executionId);
		if (!execution) return;

		const workspacePath = this._getWorkspacePath();
		if (!workspacePath) return;

		for (const task of execution.tasks) {
			await this._cleanupTask(task, workspacePath);
		}

		this._executions.delete(executionId);
	}

	private async _cleanupTask(task: ParallelAgentTask, workspacePath: string): Promise<void> {
		if (task.worktreePath) {
			await this._runGitCommand(`git worktree remove "${task.worktreePath}" --force`, workspacePath);
		}
		if (task.branchName) {
			await this._runGitCommand(`git branch -D "${task.branchName}"`, workspacePath);
		}
	}

	private async _runGitCommand(command: string, cwd: string): Promise<{ success: boolean; output: string }> {
		try {
			const terminalId = `parallel-agent-${generateUuid().substring(0, 8)}`;
			const { resPromise } = await this._terminalToolService.runCommand(command, {
				type: 'temporary',
				cwd,
				terminalId,
			});
			const { result, resolveReason } = await resPromise;

			const success = resolveReason.type === 'done' && resolveReason.exitCode === 0;
			return { success, output: result };
		} catch (e) {
			return { success: false, output: `${e}` };
		}
	}

	private _createFailedExecution(parentThreadId: string, mode: ParallelAgentMode, error: string): ParallelAgentExecution {
		const execution: ParallelAgentExecution = {
			id: generateUuid(),
			parentThreadId,
			mode,
			originalPrompt: '',
			tasks: [],
			status: 'failed',
			createdAt: Date.now(),
		};
		this._executions.set(execution.id, execution);
		return execution;
	}

	getExecution(executionId: string): ParallelAgentExecution | undefined {
		return this._executions.get(executionId);
	}

	getActiveExecutions(): ParallelAgentExecution[] {
		return Array.from(this._executions.values()).filter(e => e.status === 'running');
	}
}

registerSingleton(IParallelAgentService, ParallelAgentService, InstantiationType.Delayed);
