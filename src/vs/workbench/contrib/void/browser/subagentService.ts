/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { generateUuid } from '../../../../base/common/uuid.js';

import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { SubagentDefinition, SubagentExecution, SubagentType } from '../common/subagentTypes.js';
import { IVoidSettingsService } from '../common/voidSettingsService.js';
import { IChatThreadService } from './chatThreadServiceInterface.js';
import { ISubagentService } from './subagentServiceInterface.js';
import { IAgentRegistryService } from './agentRegistryService.js';

export { ISubagentService } from './subagentServiceInterface.js';


class SubagentService extends Disposable implements ISubagentService {
	declare readonly _serviceBrand: undefined;

	private _executions: Map<string, SubagentExecution> = new Map();

	private _chatThreadServiceLazy: IChatThreadService | undefined;
	private get chatThreadService(): IChatThreadService {
		if (!this._chatThreadServiceLazy) {
			this._chatThreadServiceLazy = this._instantiationService.invokeFunction(
				accessor => accessor.get(IChatThreadService)
			);
		}
		return this._chatThreadServiceLazy;
	}

	constructor(
		@IVoidSettingsService private readonly _voidSettingsService: IVoidSettingsService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IAgentRegistryService private readonly _agentRegistryService: IAgentRegistryService,
	) {
		super();
	}

	getBuiltinDefinition(type: SubagentType): SubagentDefinition | undefined {
		const agentDef = this._agentRegistryService.getAgent(type)
		if (!agentDef) return undefined
		return {
			name: agentDef.name,
			description: agentDef.description,
			model: agentDef.model,
			readonly: agentDef.readonly,
			isBackground: agentDef.isBackground,
			prompt: agentDef.systemPrompt,
			type: agentDef.id,
		}
	}

	async spawnSubagent(parentThreadId: string, type: SubagentType, prompt: string, background: boolean = false): Promise<SubagentExecution> {
		const config = this._voidSettingsService.state.globalSettings.subagentConfig;

		if (!config.enabled) {
			const execution: SubagentExecution = {
				id: generateUuid(),
				parentThreadId,
				definition: this._makeDefinition(type),
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
				definition: this._makeDefinition(type),
				status: 'failed',
				result: `Max concurrent subagents (${config.maxConcurrent}) reached. Wait for a running subagent to complete.`,
			};
			this._executions.set(execution.id, execution);
			return execution;
		}

		// Look up agent from registry
		const agentDef = this._agentRegistryService.getAgent(type)
		if (!agentDef) {
			const validIds = this._agentRegistryService.getAllAgents().map(a => a.id).join('", "')
			const execution: SubagentExecution = {
				id: generateUuid(),
				parentThreadId,
				definition: this._makeDefinition(type),
				status: 'failed',
				result: `Unknown agent type "${type}". Available agents: "${validIds}"`,
			};
			this._executions.set(execution.id, execution);
			return execution;
		}

		const definition: SubagentDefinition = {
			name: agentDef.name,
			description: agentDef.description,
			model: agentDef.model,
			readonly: agentDef.readonly,
			isBackground: agentDef.isBackground,
			prompt: agentDef.systemPrompt,
			type: agentDef.id,
		}

		const execution: SubagentExecution = {
			id: generateUuid(),
			parentThreadId,
			definition,
			status: 'running',
		};
		this._executions.set(execution.id, execution);

		// Build the full prompt with the subagent's system instructions
		const fullPrompt = `${agentDef.systemPrompt}\n\nTask: ${prompt}`

		// Derive chatMode from agent definition
		const chatMode = agentDef.readonly ? 'ask' : 'agent'
		const maxIterations = agentDef.maxIterations
		const timeoutMs = agentDef.timeout

		// Run the subagent on a hidden thread
		const runPromise = this.chatThreadService.runSubagentThread({
			prompt: fullPrompt,
			chatModeOverride: chatMode,
			maxIterations,
			timeoutMs,
		})

		if (background) {
			// Fire and forget for background subagents — update execution when done
			runPromise.then(({ result, status }) => {
				execution.status = status;
				execution.result = result;
			}).catch(e => {
				execution.status = 'failed';
				execution.result = `Subagent error: ${e}`;
			})
		} else {
			// Wait for completion
			try {
				const { result, status } = await runPromise;
				execution.status = status;
				execution.result = result;
			} catch (e) {
				execution.status = 'failed';
				execution.result = `Subagent error: ${e}`;
			}
		}

		return execution;
	}

	private _makeDefinition(type: string): SubagentDefinition {
		const agentDef = this._agentRegistryService.getAgent(type)
		if (agentDef) {
			return {
				name: agentDef.name,
				description: agentDef.description,
				model: agentDef.model,
				readonly: agentDef.readonly,
				isBackground: agentDef.isBackground,
				prompt: agentDef.systemPrompt,
				type: agentDef.id,
			}
		}
		// Fallback for unknown types
		return {
			name: type,
			description: `Agent: ${type}`,
			model: 'inherit',
			readonly: false,
			isBackground: false,
			prompt: '',
			type,
		}
	}

	getSubagentExecution(executionId: string): SubagentExecution | undefined {
		return this._executions.get(executionId);
	}

	getSubagentResults(executionId: string): string | undefined {
		return this._executions.get(executionId)?.result;
	}
}

registerSingleton(ISubagentService, SubagentService, InstantiationType.Delayed);
