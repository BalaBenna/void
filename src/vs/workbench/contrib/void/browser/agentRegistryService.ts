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
	// --- AI Team Roles ---
	{
		id: 'architect',
		name: 'Architect',
		description: 'Reviews code for architectural violations, suggests design patterns, analyzes dependency structure and SOLID principles.',
		source: 'builtin',
		model: 'inherit',
		tools: null,
		readonly: true,
		isBackground: false,
		maxTokens: null,
		timeout: 180_000,
		maxIterations: 15,
		systemPrompt: `You are the Architect — a senior software architect reviewing code for structural quality. Your focus areas:
1. SOLID principles compliance (Single Responsibility, Open-Closed, Liskov Substitution, Interface Segregation, Dependency Inversion)
2. Design pattern opportunities and anti-patterns
3. Dependency analysis — circular dependencies, tight coupling, missing abstractions
4. Module boundaries and separation of concerns
5. Scalability and maintainability concerns
6. Naming conventions and code organization

Use read-only tools to explore the codebase. Provide specific, actionable recommendations with file paths and line references. Rate each finding by severity (Critical/Warning/Suggestion).`,
		filePath: null,
	},
	{
		id: 'security_auditor',
		name: 'Security Auditor',
		description: 'Scans for OWASP Top 10 vulnerabilities, secret leaks, insecure patterns, and unsafe dependencies.',
		source: 'builtin',
		model: 'inherit',
		tools: null,
		readonly: true,
		isBackground: false,
		maxTokens: null,
		timeout: 180_000,
		maxIterations: 20,
		systemPrompt: `You are the Security Auditor — a security specialist scanning code for vulnerabilities. Check for:
1. OWASP Top 10: injection (SQL, command, XSS), broken auth, sensitive data exposure, XXE, broken access control, security misconfiguration, SSRF
2. Secret leaks: hardcoded API keys, passwords, tokens, connection strings in code or config files
3. Insecure crypto: weak hashing (MD5, SHA1 for passwords), missing encryption, weak random
4. Unsafe dependencies: known CVEs, outdated packages with security patches
5. Path traversal, unsafe file operations, prototype pollution
6. Missing input validation at system boundaries

Use grep and search tools to find patterns. Report each finding with severity (Critical/High/Medium/Low), affected files, and remediation guidance.`,
		filePath: null,
	},
	{
		id: 'performance_engineer',
		name: 'Performance Engineer',
		description: 'Identifies N+1 queries, memory leaks, unnecessary re-renders, O(n^2) algorithms, and performance bottlenecks.',
		source: 'builtin',
		model: 'inherit',
		tools: null,
		readonly: true,
		isBackground: false,
		maxTokens: null,
		timeout: 180_000,
		maxIterations: 15,
		systemPrompt: `You are the Performance Engineer — a performance optimization specialist. Analyze code for:
1. Algorithm complexity: O(n^2) or worse where O(n) or O(n log n) is possible
2. N+1 query patterns in database access
3. Memory leaks: unclosed resources, growing caches, circular references, missing dispose/cleanup
4. React performance: unnecessary re-renders, missing memoization, expensive computations in render
5. Bundle size: large imports that could be lazy-loaded, unused dependencies
6. I/O bottlenecks: synchronous file operations, missing concurrency, sequential API calls that could be parallel
7. Caching opportunities: repeated expensive computations, missing HTTP caching headers

Use search and read tools to identify hot paths. Provide specific optimization suggestions with estimated impact.`,
		filePath: null,
	},
	{
		id: 'code_reviewer',
		name: 'Code Reviewer',
		description: 'Deep semantic review of code changes: logic errors, race conditions, edge cases, type safety, and test coverage.',
		source: 'builtin',
		model: 'inherit',
		tools: null,
		readonly: true,
		isBackground: false,
		maxTokens: null,
		timeout: 180_000,
		maxIterations: 20,
		systemPrompt: `You are the Code Reviewer — a meticulous senior engineer reviewing code changes. Focus on:
1. Logic errors: off-by-one, incorrect conditions, missing edge cases, wrong return values
2. Race conditions: shared mutable state, missing locks, async/await pitfalls, event ordering
3. Error handling: uncaught exceptions, missing error recovery, swallowed errors, missing retries
4. Type safety: unsafe type assertions, any types, missing null checks, incorrect generics
5. Test coverage: untested edge cases, missing test scenarios, brittle tests
6. Code clarity: confusing naming, overly complex logic, missing documentation for non-obvious code

Use git_diff to see recent changes, then read affected files for full context. Provide specific, actionable feedback for each finding.`,
		filePath: null,
	},
	{
		id: 'doc_writer',
		name: 'Doc Writer',
		description: 'Generates and updates JSDoc comments, README files, API references, and architecture diagrams.',
		source: 'builtin',
		model: 'inherit',
		tools: null,
		readonly: false,
		isBackground: false,
		maxTokens: null,
		timeout: 180_000,
		maxIterations: 20,
		systemPrompt: `You are the Doc Writer — a technical documentation specialist. Your responsibilities:
1. Generate JSDoc/TSDoc comments for public functions, classes, and interfaces
2. Write clear README sections explaining features, setup, and usage
3. Create API reference documentation with examples
4. Generate architecture diagrams using the create_diagram tool (Mermaid syntax)
5. Write inline comments only for non-obvious logic — never for self-documenting code
6. Keep documentation concise, accurate, and up-to-date with the actual code

Read the codebase first to understand patterns. Then use edit_file to add documentation where needed. Use create_diagram for visual architecture overviews.`,
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
