import { URI } from '../../../../base/common/uri.js'
import { RawMCPToolCall } from './mcpServiceTypes.js';
import { builtinTools } from './prompt/prompts.js';
import { RawToolParamsObj } from './sendLLMMessageTypes.js';
import { ErrorClassificationResult } from './errorClassificationTypes.js';
import { PipelineResult } from './verificationPipelineTypes.js';



export type TerminalResolveReason = { type: 'timeout' } | { type: 'done', exitCode: number }

export type LintErrorItem = { code: string, message: string, startLineNumber: number, endLineNumber: number }

// Partial of IFileStat
export type ShallowDirectoryItem = {
	uri: URI;
	name: string;
	isDirectory: boolean;
	isSymbolicLink: boolean;
}


export const approvalTypeOfBuiltinToolName: Partial<{ [T in BuiltinToolName]?: 'edits' | 'terminal' | 'MCP tools' }> = {
	'create_file_or_folder': 'edits',
	'delete_file_or_folder': 'edits',
	'rewrite_file': 'edits',
	'edit_file': 'edits',
	'run_command': 'terminal',
	'run_persistent_command': 'terminal',
	'open_persistent_terminal': 'terminal',
	'kill_persistent_terminal': 'terminal',
	'run_verification': 'terminal',
	'git_create_branch': 'terminal',
	'git_commit': 'terminal',
	'git_push': 'terminal',
	'create_pull_request': 'terminal',
	'edit_notebook': 'edits',
	'reapply_edit': 'edits',
	'set_breakpoint': 'edits',
	'remove_breakpoint': 'edits',
	'start_debug_session': 'terminal',
	'debug_step': 'edits',
	'git_stash': 'terminal',
	'git_merge': 'terminal',
	'git_reset': 'terminal',
	'git_cherry_pick': 'terminal',
	'git_rebase': 'terminal',
}


export type ToolApprovalType = NonNullable<(typeof approvalTypeOfBuiltinToolName)[keyof typeof approvalTypeOfBuiltinToolName]>;

// Risk levels for tiered auto-approval
export type ToolRiskLevel = 'safe' | 'moderate' | 'dangerous';

/**
 * Static risk classification for built-in tools.
 * - safe: read-only operations, always auto-approved
 * - moderate: workspace edits, auto-approved in agent mode
 * - dangerous: destructive/external operations, always require user approval
 */
export const riskLevelOfBuiltinToolName: { [T in BuiltinToolName]?: ToolRiskLevel } = {
	// Safe: read-only
	'read_file': 'safe',
	'ls_dir': 'safe',
	'get_dir_tree': 'safe',
	'search_pathnames_only': 'safe',
	'search_for_files': 'safe',
	'search_in_file': 'safe',
	'read_lint_errors': 'safe',
	'web_search': 'safe',
	'fetch_rules': 'safe',
	'codebase_search': 'safe',
	'grep': 'safe',
	'ask_user': 'safe',
	'create_diagram': 'safe',
	'update_memory': 'safe',
	'todo_write': 'safe',
	'spawn_subagent': 'safe',
	'read_debug_state': 'safe',
	'debug_evaluate': 'safe',
	'git_log': 'safe',
	'git_diff': 'safe',
	'git_status': 'safe',
	'git_blame': 'safe',

	// Moderate: workspace edits
	'edit_file': 'moderate',
	'rewrite_file': 'moderate',
	'create_file_or_folder': 'moderate',
	'edit_notebook': 'moderate',
	'reapply_edit': 'moderate',
	'run_verification': 'moderate',
	'git_create_branch': 'moderate',
	'set_breakpoint': 'moderate',
	'remove_breakpoint': 'moderate',
	'start_debug_session': 'moderate',
	'debug_step': 'moderate',
	'git_stash': 'moderate',
	'git_merge': 'moderate',
	'git_cherry_pick': 'moderate',

	// Dangerous: destructive or external-facing
	'git_reset': 'dangerous',
	'git_rebase': 'dangerous',
	'delete_file_or_folder': 'dangerous',
	'run_command': 'moderate', // Elevated to dangerous dynamically based on command content
	'run_persistent_command': 'moderate',
	'open_persistent_terminal': 'moderate',
	'kill_persistent_terminal': 'moderate',
	'git_commit': 'moderate',
	'git_push': 'dangerous',
	'create_pull_request': 'dangerous',
};

/**
 * Dynamically assess risk level for a tool call based on its parameters.
 * Certain commands are elevated from moderate to dangerous.
 */
export function assessToolRisk(toolName: BuiltinToolName, params: RawToolParamsObj): ToolRiskLevel {
	const staticRisk = riskLevelOfBuiltinToolName[toolName] ?? 'moderate'

	// Dynamic escalation for terminal commands
	if (toolName === 'run_command' || toolName === 'run_persistent_command') {
		const command = (params?.command ?? '') as string
		const lower = command.toLowerCase().trim()

		// Dangerous patterns
		const dangerousPatterns = [
			/\brm\s+(-rf?|--recursive)\b/,
			/\brm\s+-[a-zA-Z]*f/,
			/\bsudo\b/,
			/\bchmod\s+[0-7]{3,4}\b/,
			/\bgit\s+push\s+--force\b/,
			/\bgit\s+reset\s+--hard\b/,
			/\bdrop\s+(?:table|database)\b/i,
			/\btruncate\s+table\b/i,
			/\bdd\s+if=/,
			/\bmkfs\b/,
			/\bcurl\b.*\|\s*(?:bash|sh)\b/,
			/\bwget\b.*\|\s*(?:bash|sh)\b/,
		]

		for (const pattern of dangerousPatterns) {
			if (pattern.test(lower)) return 'dangerous'
		}
	}

	// Delete file escalation
	if (toolName === 'delete_file_or_folder') {
		const isRecursive = params?.is_recursive
		if (isRecursive === 'true') return 'dangerous'
	}

	return staticRisk
}


export const toolApprovalTypes = new Set<ToolApprovalType>([
	...Object.values(approvalTypeOfBuiltinToolName),
	'MCP tools',
])




// PARAMS OF TOOL CALL
export type BuiltinToolCallParams = {
	'read_file': { uri: URI, startLine: number | null, endLine: number | null, pageNumber: number },
	'ls_dir': { uri: URI, pageNumber: number, ignoreGlobs: string[] | null },
	'get_dir_tree': { uri: URI },
	'search_pathnames_only': { query: string, includePattern: string | null, globPattern: string | null, pageNumber: number },
	'search_for_files': { query: string, isRegex: boolean, searchInFolder: URI | null, pageNumber: number },
	'search_in_file': { uri: URI, query: string, isRegex: boolean },
	'read_lint_errors': { uris: URI[] },
	// ---
	'rewrite_file': { uri: URI, newContent: string },
	'edit_file': { uri: URI, searchReplaceBlocks: string },
	'create_file_or_folder': { uri: URI, isFolder: boolean },
	'delete_file_or_folder': { uri: URI, isRecursive: boolean, isFolder: boolean },
	// ---
	'run_command': { command: string; cwd: string | null, terminalId: string },
	'open_persistent_terminal': { cwd: string | null },
	'run_persistent_command': { command: string; persistentTerminalId: string },
	'kill_persistent_terminal': { persistentTerminalId: string },
	// --- web search ---
	'web_search': { query: string, maxResults: number },
	// --- subagent ---
	'spawn_subagent': { type: string, prompt: string, background: boolean },
	// --- rules ---
	'fetch_rules': { ruleName: string | null },
	// --- codebase search ---
	'codebase_search': { query: string, targetDirectory: string | null, maxResults: number },
	// --- verification pipeline ---
	'run_verification': { cwd: string | null, steps: string | null },
	// --- git operations ---
	'git_create_branch': { branchName: string },
	'git_commit': { message: string, files: string | null },
	'git_push': { remote: string, branch: string | null },
	'create_pull_request': { title: string, body: string, baseBranch: string | null },
	// --- diagram ---
	'create_diagram': { content: string },
	// --- notebook ---
	'edit_notebook': { uri: URI, cellIndex: number, isNewCell: boolean, cellLanguage: string, oldString: string, newString: string },
	// --- reapply ---
	'reapply_edit': { uri: URI },
	// --- clarification ---
	'ask_user': { question: string },
	// --- grep (ripgrep-powered search) ---
	'grep': { pattern: string, path: string | null, include: string | null, outputMode: string, contextLines: number, caseInsensitive: boolean, maxResults: number },
	// --- memory ---
	'update_memory': { action: string, title: string, content: string | null, memoryId: string | null, memoryType: string | null, tags: string | null, context: string | null },
	// --- todo/task tracking ---
	'todo_write': { todos: string, merge: boolean },
	// --- debug agent tools ---
	'set_breakpoint': { uri: URI, line: number, condition: string | null },
	'remove_breakpoint': { uri: URI, line: number },
	'read_debug_state': {},
	'start_debug_session': { configName: string | null, filePath: string | null },
	'debug_step': { stepType: string },
	'debug_evaluate': { expression: string, frameId: string | null },
	// --- extended git operations ---
	'git_log': { maxCount: number, filePath: string | null, author: string | null, since: string | null, until: string | null, grep: string | null },
	'git_diff': { target: string | null, filePath: string | null, staged: boolean },
	'git_status': {},
	'git_stash': { action: string, message: string | null, stashIndex: number },
	'git_blame': { filePath: string, startLine: number | null, endLine: number | null },
	'git_merge': { branch: string, noFf: boolean },
	'git_reset': { target: string, mode: string },
	'git_cherry_pick': { commit: string },
	'git_rebase': { onto: string | null, abort: boolean },
}

export type WebSearchResultItem = { title: string, url: string, content: string }

export type CodebaseSearchResultItem = { uri: string, startLine: number, endLine: number, content: string, score: number, symbolName: string | null }

export type GrepMatchItem = { file: string, line: number, content: string, contextBefore: string[], contextAfter: string[] }

export type TodoItem = { id: string, content: string, status: 'pending' | 'in_progress' | 'completed' | 'cancelled' }

// RESULT OF TOOL CALL
export type BuiltinToolResultType = {
	'read_file': { fileContents: string, totalFileLen: number, totalNumLines: number, hasNextPage: boolean },
	'ls_dir': { children: ShallowDirectoryItem[] | null, hasNextPage: boolean, hasPrevPage: boolean, itemsRemaining: number },
	'get_dir_tree': { str: string, },
	'search_pathnames_only': { uris: URI[], hasNextPage: boolean },
	'search_for_files': { uris: URI[], hasNextPage: boolean },
	'search_in_file': { lines: number[]; },
	'read_lint_errors': { allLintErrors: { uri: string, lintErrors: LintErrorItem[] }[] },
	// ---
	'rewrite_file': Promise<{ lintErrors: LintErrorItem[] | null }>,
	'edit_file': Promise<{ lintErrors: LintErrorItem[] | null }>,
	'create_file_or_folder': {},
	'delete_file_or_folder': {},
	// ---
	'run_command': { result: string; resolveReason: TerminalResolveReason; errorClassification?: ErrorClassificationResult },
	'run_persistent_command': { result: string; resolveReason: TerminalResolveReason; errorClassification?: ErrorClassificationResult },
	'open_persistent_terminal': { persistentTerminalId: string },
	'kill_persistent_terminal': {},
	// --- web search ---
	'web_search': { results: WebSearchResultItem[], query: string },
	// --- subagent ---
	'spawn_subagent': { executionId: string, status: string, result: string },
	// --- rules ---
	'fetch_rules': { rules: { name: string, description: string, content?: string }[] },
	// --- codebase search ---
	'codebase_search': { results: CodebaseSearchResultItem[] },
	// --- verification pipeline ---
	'run_verification': { pipelineResult: PipelineResult },
	// --- git operations ---
	'git_create_branch': { branchName: string, success: boolean },
	'git_commit': { commitHash: string, message: string },
	'git_push': { success: boolean, output: string },
	'create_pull_request': { url: string, number: number, success: boolean },
	// --- diagram ---
	'create_diagram': { content: string, success: boolean },
	// --- notebook ---
	'edit_notebook': { success: boolean, message: string },
	// --- reapply ---
	'reapply_edit': { success: boolean, message: string },
	// --- clarification ---
	'ask_user': { userResponse: string },
	// --- grep ---
	'grep': { matches: GrepMatchItem[], totalMatches: number, truncated: boolean },
	// --- memory ---
	'update_memory': { success: boolean, memoryId: string, message: string },
	// --- todo ---
	'todo_write': { todos: TodoItem[] },
	// --- debug agent ---
	'set_breakpoint': { success: boolean, breakpointId: string },
	'remove_breakpoint': { success: boolean },
	'read_debug_state': { hasActiveSession: boolean, sessionName: string | null, callStack: string[], variables: string[], breakpoints: string[] },
	'start_debug_session': { success: boolean, sessionId: string | null, message: string },
	'debug_step': { success: boolean, message: string },
	'debug_evaluate': { success: boolean, result: string, type: string | null },
	// --- extended git ---
	'git_log': { output: string },
	'git_diff': { output: string },
	'git_status': { output: string },
	'git_stash': { output: string, success: boolean },
	'git_blame': { output: string },
	'git_merge': { output: string, success: boolean },
	'git_reset': { output: string, success: boolean },
	'git_cherry_pick': { output: string, success: boolean },
	'git_rebase': { output: string, success: boolean },
}


export type ToolCallParams<T extends BuiltinToolName | (string & {})> = T extends BuiltinToolName ? BuiltinToolCallParams[T] : RawToolParamsObj
export type ToolResult<T extends BuiltinToolName | (string & {})> = T extends BuiltinToolName ? BuiltinToolResultType[T] : RawMCPToolCall

export type BuiltinToolName = keyof BuiltinToolResultType

type BuiltinToolParamNameOfTool<T extends BuiltinToolName> = keyof (typeof builtinTools)[T]['params']
export type BuiltinToolParamName = { [T in BuiltinToolName]: BuiltinToolParamNameOfTool<T> }[BuiltinToolName]


export type ToolName = BuiltinToolName | (string & {})
export type ToolParamName<T extends ToolName> = T extends BuiltinToolName ? BuiltinToolParamNameOfTool<T> : string
