/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ModelSelection } from './voidSettingsTypes.js';

export type ParallelAgentMode = 'fan-out' | 'best-of-n';

export type ParallelAgentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ParallelAgentTask {
	id: string;
	prompt: string;
	modelSelection?: ModelSelection;  // override per-agent model if desired
	worktreePath?: string;            // set after worktree creation
	branchName?: string;              // set after worktree creation
	status: ParallelAgentStatus;
	result?: string;
	error?: string;
	startedAt?: number;
	completedAt?: number;
}

export interface ParallelAgentExecution {
	id: string;
	parentThreadId: string;
	mode: ParallelAgentMode;
	originalPrompt: string;
	tasks: ParallelAgentTask[];
	status: ParallelAgentStatus;
	selectedTaskId?: string;   // which task's result was chosen (for best-of-n)
	createdAt: number;
}

export interface ParallelAgentConfig {
	enabled: boolean;
	maxParallelAgents: number;   // max concurrent worktrees
	cleanupAfterMerge: boolean;  // auto-remove worktrees after merge/rejection
}

export const defaultParallelAgentConfig: ParallelAgentConfig = {
	enabled: false,
	maxParallelAgents: 3,
	cleanupAfterMerge: true,
};
