/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { voidAgentDefinition } from '../common/agentRegistryTypes.js';
import { parseFrontmatter } from '../common/frontmatterParser.js';


export interface IAgentRegistryService {
	readonly _serviceBrand: undefined;
	onDidChangeAgents: Event<void>;
	getAllAgents(): voidAgentDefinition[];
	getAgent(id: string): voidAgentDefinition | undefined;
	getBuiltinAgents(): voidAgentDefinition[];
	getCustomAgents(): voidAgentDefinition[];
	refreshAgents(): Promise<void>;
	getAgentRosterString(): string;
}

export const IAgentRegistryService = createDecorator<IAgentRegistryService>('voidAgentRegistryService');


// Built-in agent definitions — these were previously hardcoded in subagentService.ts
const builtinAgents: voidAgentDefinition[] = [
	{
		id: 'explore',
		name: 'Explore',
		description: 'Fast agent for codebase exploration. Searches files, reads code, and answers questions about the codebase.',
		source: 'builtin',
		model: 'inherit',
		tools: null,
		readonly: true,
		isBackground: false,
		maxTokens: null,
		timeout: 120_000,
		maxIterations: 10,
		systemPrompt: 'You are an exploration subagent. Search the codebase to find relevant files, patterns, and information. Use read-only tools only. Summarize your findings concisely.',
		filePath: null,
	},
	{
		id: 'bash',
		name: 'Bash',
		description: 'Terminal execution agent. Runs bash commands and returns results.',
		source: 'builtin',
		model: 'inherit',
		tools: null,
		readonly: false,
		isBackground: false,
		maxTokens: null,
		timeout: 120_000,
		maxIterations: 10,
		systemPrompt: 'You are a bash execution subagent. Run the requested terminal commands and return the results.',
		filePath: null,
	},
	{
		id: 'browser',
		name: 'Browser',
		description: 'Web search agent. Searches the web for information using Tavily.',
		source: 'builtin',
		model: 'inherit',
		tools: null,
		readonly: true,
		isBackground: false,
		maxTokens: null,
		timeout: 120_000,
		maxIterations: 5,
		systemPrompt: 'You are a web search subagent. Use the web_search tool to find relevant information online. Summarize your findings concisely.',
		filePath: null,
	},
	{
		id: 'custom',
		name: 'Custom',
		description: 'General-purpose agent with full tool access. Used for parallel execution and custom tasks.',
		source: 'builtin',
		model: 'inherit',
		tools: null,
		readonly: false,
		isBackground: false,
		maxTokens: null,
		timeout: 120_000,
		maxIterations: 15,
		systemPrompt: 'You are an autonomous agent with full tool access. Complete the given task thoroughly.',
		filePath: null,
	},
];


class AgentRegistryService extends Disposable implements IAgentRegistryService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeAgents = new Emitter<void>();
	readonly onDidChangeAgents: Event<void> = this._onDidChangeAgents.event;

	private _agents: voidAgentDefinition[] = [...builtinAgents];

	constructor(
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly _fileService: IFileService,
	) {
		super();

		// Initial load
		this.refreshAgents();

		// Watch for file changes in .void/agents/
		this._register(this._fileService.onDidFilesChange(e => {
			const allChanged = [...e.rawAdded, ...e.rawUpdated, ...e.rawDeleted]
			const agentsChanged = allChanged.some(uri => {
				const path = uri.path
				return path.includes('.void/agents/') && path.endsWith('.md')
			})
			if (agentsChanged) {
				this.refreshAgents()
			}
		}));
	}

	async refreshAgents(): Promise<void> {
		const customAgents: voidAgentDefinition[] = []

		// 1. Scan workspace .void/agents/ directories (project-level)
		const folders = this._workspaceContextService.getWorkspace().folders
		for (const folder of folders) {
			const agentsDir = URI.joinPath(folder.uri, '.void', 'agents')
			const agents = await this._loadAgentsFromDir(agentsDir, 'project')
			customAgents.push(...agents)
		}

		// Combine: builtins first, then custom (custom can override builtins by id)
		const agentMap = new Map<string, voidAgentDefinition>()
		for (const agent of builtinAgents) {
			agentMap.set(agent.id, agent)
		}
		for (const agent of customAgents) {
			agentMap.set(agent.id, agent)
		}

		this._agents = Array.from(agentMap.values())
		this._onDidChangeAgents.fire()
	}

	private async _loadAgentsFromDir(dirUri: URI, source: 'project' | 'user'): Promise<voidAgentDefinition[]> {
		const agents: voidAgentDefinition[] = []
		try {
			const stat = await this._fileService.resolve(dirUri)
			if (!stat.children) return agents

			for (const child of stat.children) {
				if (child.isDirectory || !child.name.endsWith('.md')) continue

				try {
					const content = await this._fileService.readFile(child.resource)
					const text = content.value.toString()
					const { frontmatter, body } = parseFrontmatter(text)

					const id = frontmatter.id || child.name.replace('.md', '')

					agents.push({
						id,
						name: frontmatter.name || id,
						description: frontmatter.description || '',
						source,
						model: frontmatter.model || 'inherit',
						tools: Array.isArray(frontmatter.tools) ? frontmatter.tools : null,
						readonly: frontmatter.readonly === true,
						isBackground: frontmatter.isBackground === true || frontmatter.background === true,
						maxTokens: typeof frontmatter.maxTokens === 'number' ? frontmatter.maxTokens : null,
						timeout: typeof frontmatter.timeout === 'number' ? frontmatter.timeout : 120_000,
						maxIterations: typeof frontmatter.maxIterations === 'number' ? frontmatter.maxIterations : 10,
						systemPrompt: body.trim(),
						filePath: child.resource.fsPath,
					})
				} catch {
					// Skip files that can't be read
				}
			}
		} catch {
			// Agents directory doesn't exist yet
		}
		return agents
	}

	getAllAgents(): voidAgentDefinition[] {
		return this._agents
	}

	getAgent(id: string): voidAgentDefinition | undefined {
		return this._agents.find(a => a.id === id)
	}

	getBuiltinAgents(): voidAgentDefinition[] {
		return this._agents.filter(a => a.source === 'builtin')
	}

	getCustomAgents(): voidAgentDefinition[] {
		return this._agents.filter(a => a.source !== 'builtin')
	}

	getAgentRosterString(): string {
		if (this._agents.length === 0) return ''

		const lines = this._agents.map(a => {
			const tags: string[] = []
			if (a.readonly) tags.push('read-only')
			if (a.source !== 'builtin') tags.push(a.source)
			const tagStr = tags.length > 0 ? ` (${tags.join(', ')})` : ''
			return `- ${a.id}: ${a.description}${tagStr}`
		})

		return `Available subagents you can spawn:\n${lines.join('\n')}`
	}
}

registerSingleton(IAgentRegistryService, AgentRegistryService, InstantiationType.Delayed);
