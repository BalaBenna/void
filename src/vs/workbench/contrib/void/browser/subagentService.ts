/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { generateUuid } from '../../../../base/common/uuid.js';

import { SubagentDefinition, SubagentExecution, SubagentType } from '../common/subagentTypes.js';
import { IVoidSettingsService } from '../common/voidSettingsService.js';


// Built-in subagent definitions
const builtinSubagentDefinitions: Record<string, SubagentDefinition> = {
	explore: {
		name: 'Explore',
		description: 'Fast agent for codebase exploration. Searches files, reads code, and answers questions about the codebase.',
		model: 'inherit',
		readonly: true,
		isBackground: false,
		prompt: 'You are an exploration subagent. Search the codebase to find relevant files, patterns, and information. Use read-only tools only. Summarize your findings concisely.',
		type: 'explore',
	},
	bash: {
		name: 'Bash',
		description: 'Terminal execution agent. Runs bash commands and returns results.',
		model: 'inherit',
		readonly: false,
		isBackground: false,
		prompt: 'You are a bash execution subagent. Run the requested terminal commands and return the results.',
		type: 'bash',
	},
	browser: {
		name: 'Browser',
		description: 'Web search agent. Searches the web for information using Tavily.',
		model: 'inherit',
		readonly: true,
		isBackground: false,
		prompt: 'You are a web search subagent. Use the web_search tool to find relevant information online. Summarize your findings concisely.',
		type: 'browser',
	},
};


export interface ISubagentService {
	readonly _serviceBrand: undefined;

	spawnSubagent(parentThreadId: string, type: SubagentType, prompt: string, background?: boolean): Promise<SubagentExecution>;
	getSubagentExecution(executionId: string): SubagentExecution | undefined;
	getSubagentResults(executionId: string): string | undefined;
	getBuiltinDefinition(type: SubagentType): SubagentDefinition | undefined;
}

export const ISubagentService = createDecorator<ISubagentService>('voidSubagentService');

class SubagentService extends Disposable implements ISubagentService {
	declare readonly _serviceBrand: undefined;

	private _executions: Map<string, SubagentExecution> = new Map();

	constructor(
		@IVoidSettingsService private readonly _voidSettingsService: IVoidSettingsService,
	) {
		super();
	}

	getBuiltinDefinition(type: SubagentType): SubagentDefinition | undefined {
		return builtinSubagentDefinitions[type];
	}

	async spawnSubagent(parentThreadId: string, type: SubagentType, prompt: string, background: boolean = false): Promise<SubagentExecution> {
		const config = this._voidSettingsService.state.globalSettings.subagentConfig;

		if (!config.enabled) {
			const execution: SubagentExecution = {
				id: generateUuid(),
				parentThreadId,
				definition: builtinSubagentDefinitions[type] ?? builtinSubagentDefinitions['explore']!,
				status: 'failed',
				result: 'Subagents are disabled in settings.',
			};
			this._executions.set(execution.id, execution);
			return execution;
		}

		// Check max concurrent
		const runningCount = Array.from(this._executions.values()).filter(e => e.status === 'running').length;
		if (runningCount >= config.maxConcurrent) {
			const execution: SubagentExecution = {
				id: generateUuid(),
				parentThreadId,
				definition: builtinSubagentDefinitions[type] ?? builtinSubagentDefinitions['explore']!,
				status: 'failed',
				result: `Max concurrent subagents (${config.maxConcurrent}) reached. Wait for a running subagent to complete.`,
			};
			this._executions.set(execution.id, execution);
			return execution;
		}

		const definition = builtinSubagentDefinitions[type] ?? builtinSubagentDefinitions['explore']!;

		const execution: SubagentExecution = {
			id: generateUuid(),
			parentThreadId,
			definition,
			status: 'running',
		};
		this._executions.set(execution.id, execution);

		// For now, return a placeholder result. Full implementation will create
		// a hidden thread and run the agent loop on it.
		// TODO: Create a hidden subagent thread via _chatThreadService with isSubagent: true,
		// run the agent loop with the appropriate tool subset, collect results, and return them.
		try {
			execution.status = 'completed';
			execution.result = `[Subagent ${definition.name}] Task: "${prompt}" — Subagent execution is not yet fully implemented. This is a placeholder result.`;
		} catch (e) {
			execution.status = 'failed';
			execution.result = `Subagent error: ${e}`;
		}

		return execution;
	}

	getSubagentExecution(executionId: string): SubagentExecution | undefined {
		return this._executions.get(executionId);
	}

	getSubagentResults(executionId: string): string | undefined {
		return this._executions.get(executionId)?.result;
	}
}

registerSingleton(ISubagentService, SubagentService, InstantiationType.Delayed);
