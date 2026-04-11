import { CancellationToken } from '../../../../base/common/cancellation.js'
import { URI } from '../../../../base/common/uri.js'
import { IFileService } from '../../../../platform/files/common/files.js'
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js'
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js'
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js'
import { QueryBuilder } from '../../../services/search/common/queryBuilder.js'
import { ISearchService, resultIsMatch } from '../../../services/search/common/search.js'
import { IEditCodeService } from './editCodeServiceInterface.js'
import { ITerminalToolService } from './terminalToolService.js'
import { LintErrorItem, BuiltinToolCallParams, BuiltinToolResultType, BuiltinToolName, TerminalResolveReason, GrepMatchItem, TodoItem } from '../common/toolsServiceTypes.js'
import { IvoidModelService } from '../common/voidModelService.js'
import { EndOfLinePreference } from '../../../../editor/common/model.js'
import { IvoidCommandBarService } from './voidCommandBarServiceInterface.js'
import { computeDirectoryTree1Deep, IDirectoryStrService, stringifyDirectoryTree1Deep } from '../common/directoryStrService.js'
import { IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js'
import { timeout } from '../../../../base/common/async.js'
import { RawToolParamsObj } from '../common/sendLLMMessageTypes.js'
import { MAX_CHILDREN_URIs_PAGE, MAX_FILE_CHARS_PAGE, MAX_TERMINAL_BG_COMMAND_TIME, MAX_TERMINAL_INACTIVE_TIME } from '../common/prompt/prompts.js'
import { IvoidSettingsService } from '../common/voidSettingsService.js'
import { generateUuid } from '../../../../base/common/uuid.js'
import { ISubagentService } from './subagentServiceInterface.js'
import { IRulesService } from './rulesService.js'
import { redactSecrets } from '../common/secretDetection.js'
import { IEmbeddingsService } from './embeddingsService.js'
import { IAgentRegistryService } from './agentRegistryService.js'
import { IErrorClassificationService } from './errorClassificationService.js'
import { IVerificationPipelineService } from './verificationPipelineService.js'
import { ISandboxService } from './sandboxService.js'
import { IMemoryService } from './memoryService.js'
import { MemoryType } from '../common/memoryTypes.js'
import { IDebugService } from '../../debug/common/debug.js'



// tool use for AI
type ValidateBuiltinParams = { [T in BuiltinToolName]: (p: RawToolParamsObj) => BuiltinToolCallParams[T] }
type CallBuiltinTool = { [T in BuiltinToolName]: (p: BuiltinToolCallParams[T]) => Promise<{ result: BuiltinToolResultType[T] | Promise<BuiltinToolResultType[T]>, interruptTool?: () => void }> }
type BuiltinToolResultToString = { [T in BuiltinToolName]: (p: BuiltinToolCallParams[T], result: Awaited<BuiltinToolResultType[T]>) => string }


const isFalsy = (u: unknown) => {
	return !u || u === 'null' || u === 'undefined'
}

const validateStr = (argName: string, value: unknown) => {
	if (value === null) throw new Error(`Invalid LLM output: ${argName} was null.`)
	if (typeof value !== 'string') throw new Error(`Invalid LLM output format: ${argName} must be a string, but its type is "${typeof value}". Full value: ${JSON.stringify(value)}.`)
	return value
}


// We are NOT checking to make sure in workspace
const validateURI = (uriStr: unknown) => {
	if (uriStr === null) throw new Error(`Invalid LLM output: uri was null.`)
	if (typeof uriStr !== 'string') throw new Error(`Invalid LLM output format: Provided uri must be a string, but it's a(n) ${typeof uriStr}. Full value: ${JSON.stringify(uriStr)}.`)

	// Check if it's already a full URI with scheme (e.g., vscode-remote://, file://, etc.)
	// Look for :// pattern which indicates a scheme is present
	// Examples of supported URIs:
	// - vscode-remote://wsl+Ubuntu/home/user/file.txt (WSL)
	// - vscode-remote://ssh-remote+myserver/home/user/file.txt (SSH)
	// - file:///home/user/file.txt (local file with scheme)
	// - /home/user/file.txt (local file path, will be converted to file://)
	// - C:\Users\file.txt (Windows local path, will be converted to file://)
	if (uriStr.includes('://')) {
		try {
			const uri = URI.parse(uriStr)
			return uri
		} catch (e) {
			// If parsing fails, it's a malformed URI
			throw new Error(`Invalid URI format: ${uriStr}. Error: ${e}`)
		}
	} else {
		// No scheme present, treat as file path
		// This handles regular file paths like /home/user/file.txt or C:\Users\file.txt
		const uri = URI.file(uriStr)
		return uri
	}
}

const validateOptionalURI = (uriStr: unknown) => {
	if (isFalsy(uriStr)) return null
	return validateURI(uriStr)
}

const validateOptionalStr = (argName: string, str: unknown) => {
	if (isFalsy(str)) return null
	return validateStr(argName, str)
}


const validatePageNum = (pageNumberUnknown: unknown) => {
	if (!pageNumberUnknown) return 1
	const parsedInt = Number.parseInt(pageNumberUnknown + '')
	if (!Number.isInteger(parsedInt)) throw new Error(`Page number was not an integer: "${pageNumberUnknown}".`)
	if (parsedInt < 1) throw new Error(`Invalid LLM output format: Specified page number must be 1 or greater: "${pageNumberUnknown}".`)
	return parsedInt
}

const validateNumber = (numStr: unknown, opts: { default: number | null }) => {
	if (typeof numStr === 'number')
		return numStr
	if (isFalsy(numStr)) return opts.default

	if (typeof numStr === 'string') {
		const parsedInt = Number.parseInt(numStr + '')
		if (!Number.isInteger(parsedInt)) return opts.default
		return parsedInt
	}

	return opts.default
}

const validateProposedTerminalId = (terminalIdUnknown: unknown) => {
	if (!terminalIdUnknown) throw new Error(`A value for terminalID must be specified, but the value was "${terminalIdUnknown}"`)
	const terminalId = terminalIdUnknown + ''
	return terminalId
}

const validateBoolean = (b: unknown, opts: { default: boolean }) => {
	if (typeof b === 'string') {
		if (b === 'true') return true
		if (b === 'false') return false
	}
	if (typeof b === 'boolean') {
		return b
	}
	return opts.default
}


const checkIfIsFolder = (uriStr: string) => {
	uriStr = uriStr.trim()
	if (uriStr.endsWith('/') || uriStr.endsWith('\\')) return true
	return false
}

export interface IToolsService {
	readonly _serviceBrand: undefined;
	validateParams: ValidateBuiltinParams;
	callTool: CallBuiltinTool;
	stringOfResult: BuiltinToolResultToString;
	respondToAskUser(response: string): void;
}

export const IToolsService = createDecorator<IToolsService>('ToolsService');

export class ToolsService implements IToolsService {

	readonly _serviceBrand: undefined;

	// Scoped per-instance to avoid module-level memory leak
	private readonly _todoStore: Map<string, TodoItem> = new Map();

	public validateParams: ValidateBuiltinParams;
	public callTool: CallBuiltinTool;
	public stringOfResult: BuiltinToolResultToString;

	constructor(
		@IFileService fileService: IFileService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService,
		@ISearchService searchService: ISearchService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IvoidModelService voidModelService: IvoidModelService,
		@IEditCodeService editCodeService: IEditCodeService,
		@ITerminalToolService private readonly terminalToolService: ITerminalToolService,
		@IvoidCommandBarService private readonly commandBarService: IvoidCommandBarService,
		@IDirectoryStrService private readonly directoryStrService: IDirectoryStrService,
		@IMarkerService private readonly markerService: IMarkerService,
		@IvoidSettingsService private readonly voidSettingsService: IvoidSettingsService,
		@ISubagentService private readonly subagentService: ISubagentService,
		@IRulesService private readonly rulesService: IRulesService,
		@IEmbeddingsService private readonly embeddingsService: IEmbeddingsService,
		@IAgentRegistryService private readonly agentRegistryService: IAgentRegistryService,
		@IErrorClassificationService private readonly errorClassificationService: IErrorClassificationService,
		@IVerificationPipelineService private readonly verificationPipelineService: IVerificationPipelineService,
		@ISandboxService private readonly sandboxService: ISandboxService,
		@IMemoryService private readonly memoryService: IMemoryService,
		@IDebugService private readonly debugService: IDebugService,
	) {
		const queryBuilder = instantiationService.createInstance(QueryBuilder);

		this.validateParams = {
			read_file: (params: RawToolParamsObj) => {
				const { uri: uriStr, start_line: startLineUnknown, end_line: endLineUnknown, page_number: pageNumberUnknown } = params
				const uri = validateURI(uriStr)
				const pageNumber = validatePageNum(pageNumberUnknown)

				let startLine = validateNumber(startLineUnknown, { default: null })
				let endLine = validateNumber(endLineUnknown, { default: null })

				if (startLine !== null && startLine < 1) startLine = null
				if (endLine !== null && endLine < 1) endLine = null

				return { uri, startLine, endLine, pageNumber }
			},
			ls_dir: (params: RawToolParamsObj) => {
				const { uri: uriStr, page_number: pageNumberUnknown, ignore_globs: ignoreGlobsUnknown } = params

				const uri = validateURI(uriStr)
				const pageNumber = validatePageNum(pageNumberUnknown)
				let ignoreGlobs: string[] | null = null
				if (ignoreGlobsUnknown && !isFalsy(ignoreGlobsUnknown)) {
					if (Array.isArray(ignoreGlobsUnknown)) {
						ignoreGlobs = ignoreGlobsUnknown.map((g: unknown) => String(g))
					} else if (typeof ignoreGlobsUnknown === 'string') {
						try { ignoreGlobs = JSON.parse(ignoreGlobsUnknown) } catch { ignoreGlobs = [ignoreGlobsUnknown] }
					}
				}
				return { uri, pageNumber, ignoreGlobs }
			},
			get_dir_tree: (params: RawToolParamsObj) => {
				const { uri: uriStr, } = params
				const uri = validateURI(uriStr)
				return { uri }
			},
			search_pathnames_only: (params: RawToolParamsObj) => {
				const {
					query: queryUnknown,
					search_in_folder: includeUnknown,
					glob_pattern: globPatternUnknown,
					page_number: pageNumberUnknown
				} = params

				const queryStr = validateStr('query', queryUnknown)
				const pageNumber = validatePageNum(pageNumberUnknown)
				const includePattern = validateOptionalStr('include_pattern', includeUnknown)
				const globPattern = validateOptionalStr('glob_pattern', globPatternUnknown)

				return { query: queryStr, includePattern, globPattern, pageNumber }

			},
			search_for_files: (params: RawToolParamsObj) => {
				const {
					query: queryUnknown,
					search_in_folder: searchInFolderUnknown,
					is_regex: isRegexUnknown,
					page_number: pageNumberUnknown
				} = params
				const queryStr = validateStr('query', queryUnknown)
				const pageNumber = validatePageNum(pageNumberUnknown)
				const searchInFolder = validateOptionalURI(searchInFolderUnknown)
				const isRegex = validateBoolean(isRegexUnknown, { default: false })
				return {
					query: queryStr,
					isRegex,
					searchInFolder,
					pageNumber
				}
			},
			search_in_file: (params: RawToolParamsObj) => {
				const { uri: uriStr, query: queryUnknown, is_regex: isRegexUnknown } = params;
				const uri = validateURI(uriStr);
				const query = validateStr('query', queryUnknown);
				const isRegex = validateBoolean(isRegexUnknown, { default: false });
				return { uri, query, isRegex };
			},

			read_lint_errors: (params: RawToolParamsObj) => {
				const { uris: urisUnknown, uri: uriUnknown } = params
				// Support both single uri (backward compat) and comma-separated uris
				let uriStrs: string[]
				if (urisUnknown && typeof urisUnknown === 'string') {
					uriStrs = urisUnknown.split(',').map(s => s.trim()).filter(s => s.length > 0)
				} else if (Array.isArray(urisUnknown)) {
					uriStrs = (urisUnknown as unknown[]).map(u => String(u))
				} else if (uriUnknown && typeof uriUnknown === 'string') {
					// backward compat: single uri param
					uriStrs = [uriUnknown]
				} else {
					throw new Error(`Invalid LLM output: uris must be a comma-separated string of file paths.`)
				}
				const uris = uriStrs.map(u => validateURI(u))
				return { uris }
			},

			// ---

			create_file_or_folder: (params: RawToolParamsObj) => {
				const { uri: uriUnknown } = params
				const uri = validateURI(uriUnknown)
				const uriStr = validateStr('uri', uriUnknown)
				const isFolder = checkIfIsFolder(uriStr)
				return { uri, isFolder }
			},

			delete_file_or_folder: (params: RawToolParamsObj) => {
				const { uri: uriUnknown, is_recursive: isRecursiveUnknown } = params
				const uri = validateURI(uriUnknown)
				const isRecursive = validateBoolean(isRecursiveUnknown, { default: false })
				const uriStr = validateStr('uri', uriUnknown)
				const isFolder = checkIfIsFolder(uriStr)
				return { uri, isRecursive, isFolder }
			},

			rewrite_file: (params: RawToolParamsObj) => {
				const { uri: uriStr, new_content: newContentUnknown } = params
				const uri = validateURI(uriStr)
				const newContent = validateStr('newContent', newContentUnknown)
				return { uri, newContent }
			},

			edit_file: (params: RawToolParamsObj) => {
				const { uri: uriStr, search_replace_blocks: searchReplaceBlocksUnknown } = params
				const uri = validateURI(uriStr)
				const searchReplaceBlocks = validateStr('searchReplaceBlocks', searchReplaceBlocksUnknown)
				return { uri, searchReplaceBlocks }
			},

			// ---

			run_command: (params: RawToolParamsObj) => {
				const { command: commandUnknown, cwd: cwdUnknown } = params
				const command = validateStr('command', commandUnknown)
				const cwd = validateOptionalStr('cwd', cwdUnknown)
				const terminalId = generateUuid()
				return { command, cwd, terminalId }
			},
			run_persistent_command: (params: RawToolParamsObj) => {
				const { command: commandUnknown, persistent_terminal_id: persistentTerminalIdUnknown } = params;
				const command = validateStr('command', commandUnknown);
				const persistentTerminalId = validateProposedTerminalId(persistentTerminalIdUnknown)
				return { command, persistentTerminalId };
			},
			open_persistent_terminal: (params: RawToolParamsObj) => {
				const { cwd: cwdUnknown } = params;
				const cwd = validateOptionalStr('cwd', cwdUnknown)
				// No parameters needed; will open a new background terminal
				return { cwd };
			},
			kill_persistent_terminal: (params: RawToolParamsObj) => {
				const { persistent_terminal_id: terminalIdUnknown } = params;
				const persistentTerminalId = validateProposedTerminalId(terminalIdUnknown);
				return { persistentTerminalId };
			},

			web_search: (params: RawToolParamsObj) => {
				const { query: queryUnknown, max_results: maxResultsUnknown } = params
				const query = validateStr('query', queryUnknown)
				const maxResults = validateNumber(maxResultsUnknown, { default: 5 }) ?? 5
				return { query, maxResults: Math.min(maxResults, 10) }
			},

			spawn_subagent: (params: RawToolParamsObj) => {
				const { type: typeUnknown, prompt: promptUnknown, background: backgroundUnknown } = params
				const type = validateStr('type', typeUnknown)
				const agentDef = this.agentRegistryService.getAgent(type)
				if (!agentDef) {
					const validTypes = this.agentRegistryService.getAllAgents().map(a => a.id).join('", "')
					throw new Error(`Invalid agent type "${type}". Available: "${validTypes}"`)
				}
				const prompt = validateStr('prompt', promptUnknown)
				const background = validateBoolean(backgroundUnknown, { default: false })
				return { type, prompt, background }
			},

			fetch_rules: (params: RawToolParamsObj) => {
				const { rule_name: ruleNameUnknown } = params
				const ruleName = validateOptionalStr('rule_name', ruleNameUnknown)
				return { ruleName }
			},

			codebase_search: (params: RawToolParamsObj) => {
				const { query: queryUnknown, target_directory: targetDirUnknown, max_results: maxResultsUnknown } = params
				const query = validateStr('query', queryUnknown)
				const targetDirectory = validateOptionalStr('target_directory', targetDirUnknown)
				const maxResults = validateNumber(maxResultsUnknown, { default: 10 }) ?? 10
				return { query, targetDirectory, maxResults: Math.min(maxResults, 25) }
			},

			run_verification: (params: RawToolParamsObj) => {
				const { cwd: cwdUnknown, steps: stepsUnknown } = params
				const cwd = validateOptionalStr('cwd', cwdUnknown)
				const steps = validateOptionalStr('steps', stepsUnknown)
				return { cwd, steps }
			},

			git_create_branch: (params: RawToolParamsObj) => {
				const branchName = validateStr('branch_name', params.branch_name)
				return { branchName }
			},
			git_commit: (params: RawToolParamsObj) => {
				const message = validateStr('message', params.message)
				const files = validateOptionalStr('files', params.files)
				return { message, files }
			},
			git_push: (params: RawToolParamsObj) => {
				const remote = validateStr('remote', params.remote) ?? 'origin'
				const branch = validateOptionalStr('branch', params.branch)
				return { remote, branch }
			},
			create_pull_request: (params: RawToolParamsObj) => {
				const title = validateStr('title', params.title)
				const body = validateStr('body', params.body)
				const baseBranch = validateOptionalStr('base_branch', params.base_branch)
				return { title, body, baseBranch }
			},

			create_diagram: (params: RawToolParamsObj) => {
				const content = validateStr('content', params.content)
				return { content }
			},
			edit_notebook: (params: RawToolParamsObj) => {
				const uri = validateURI(params.uri)
				const cellIndex = validateNumber(params.cell_index, { default: 0 }) ?? 0
				const isNewCell = String(params.is_new_cell) === 'true'
				const cellLanguage = validateStr('cell_language', params.cell_language) ?? 'python'
				const oldString = validateOptionalStr('old_string', params.old_string) ?? ''
				const newString = validateStr('new_string', params.new_string) ?? ''
				return { uri, cellIndex, isNewCell, cellLanguage, oldString, newString }
			},
			reapply_edit: (params: RawToolParamsObj) => {
				const uri = validateURI(params.uri)
				return { uri }
			},
			ask_user: (params: RawToolParamsObj) => {
				const question = validateStr('question', params.question)
				if (!question) throw new Error('ask_user requires a question parameter')
				return { question }
			},

			grep: (params: RawToolParamsObj) => {
				const pattern = validateStr('pattern', params.pattern)
				const path = validateOptionalStr('path', params.path)
				const include = validateOptionalStr('include', params.include)
				const outputMode = validateOptionalStr('output_mode', params.output_mode) ?? 'content'
				const contextLines = validateNumber(params.context_lines, { default: 2 }) ?? 2
				const caseInsensitive = validateBoolean(params.case_insensitive, { default: false })
				const maxResults = validateNumber(params.max_results, { default: 50 }) ?? 50
				return { pattern, path, include, outputMode, contextLines, caseInsensitive, maxResults }
			},

			update_memory: (params: RawToolParamsObj) => {
				const action = validateStr('action', params.action)
				const title = validateStr('title', params.title)
				const content = validateOptionalStr('content', params.content)
				const memoryId = validateOptionalStr('memory_id', params.memory_id)
				const memoryType = validateOptionalStr('memory_type', params.memory_type)
				const tags = validateOptionalStr('tags', params.tags)
				const context = validateOptionalStr('context', params.context)
				return { action, title, content, memoryId, memoryType, tags, context }
			},

			todo_write: (params: RawToolParamsObj) => {
				const todosRaw = validateStr('todos', params.todos)
				const merge = validateBoolean(params.merge, { default: false })
				return { todos: todosRaw, merge }
			},

			set_breakpoint: (params: RawToolParamsObj) => {
				const uri = validateURI(params.uri)
				const line = validateNumber(params.line, { default: null })
				if (line === null) throw new Error('line is required')
				const condition = params.condition ? String(params.condition) : null
				return { uri, line, condition }
			},

			remove_breakpoint: (params: RawToolParamsObj) => {
				const uri = validateURI(params.uri)
				const line = validateNumber(params.line, { default: null })
				if (line === null) throw new Error('line is required')
				return { uri, line }
			},

			read_debug_state: (_params: RawToolParamsObj) => {
				return {}
			},

			start_debug_session: (params: RawToolParamsObj) => {
				const configName = params.configName?.trim() || null
				const filePath = params.filePath?.trim() || null
				return { configName, filePath }
			},

			debug_step: (params: RawToolParamsObj) => {
				const stepType = params.stepType?.trim() || 'stepOver'
				if (!['stepOver', 'stepInto', 'stepOut', 'continue'].includes(stepType)) {
					throw new Error(`Invalid stepType: ${stepType}. Must be one of: stepOver, stepInto, stepOut, continue`)
				}
				return { stepType }
			},

			debug_evaluate: (params: RawToolParamsObj) => {
				const expression = params.expression?.trim()
				if (!expression) throw new Error('expression is required')
				const frameId = params.frameId?.trim() || null
				return { expression, frameId }
			},

			// --- extended git operations ---
			git_log: (params: RawToolParamsObj) => ({
				maxCount: validateNumber(params.maxCount, { default: 20 }) ?? 20,
				filePath: params.filePath?.trim() || null,
				author: params.author?.trim() || null,
				since: params.since?.trim() || null,
				until: params.until?.trim() || null,
				grep: params.grep?.trim() || null,
			}),
			git_diff: (params: RawToolParamsObj) => ({
				target: params.target?.trim() || null,
				filePath: params.filePath?.trim() || null,
				staged: params.staged === 'true',
			}),
			git_status: () => ({}),
			git_stash: (params: RawToolParamsObj) => {
				const action = params.action?.trim() || 'list'
				if (!['save', 'pop', 'list', 'drop', 'apply'].includes(action))
					throw new Error(`Invalid stash action: ${action}. Must be one of: save, pop, list, drop, apply`)
				return { action, message: params.message?.trim() || null, stashIndex: validateNumber(params.stashIndex, { default: 0 }) ?? 0 }
			},
			git_blame: (params: RawToolParamsObj) => {
				const filePath = params.filePath?.trim()
				if (!filePath) throw new Error('filePath is required')
				return { filePath, startLine: validateNumber(params.startLine, { default: null }), endLine: validateNumber(params.endLine, { default: null }) }
			},
			git_merge: (params: RawToolParamsObj) => {
				const branch = params.branch?.trim()
				if (!branch) throw new Error('branch is required')
				return { branch, noFf: params.noFf === 'true' }
			},
			git_reset: (params: RawToolParamsObj) => {
				const target = params.target?.trim()
				if (!target) throw new Error('target is required')
				const mode = params.mode?.trim() || 'mixed'
				if (!['soft', 'mixed', 'hard'].includes(mode))
					throw new Error(`Invalid reset mode: ${mode}. Must be one of: soft, mixed, hard`)
				return { target, mode }
			},
			git_cherry_pick: (params: RawToolParamsObj) => {
				const commit = params.commit?.trim()
				if (!commit) throw new Error('commit SHA is required')
				return { commit }
			},
			git_rebase: (params: RawToolParamsObj) => ({
				onto: params.onto?.trim() || null,
				abort: params.abort === 'true',
			}),

		}


		this.callTool = {
			read_file: async ({ uri, startLine, endLine, pageNumber }) => {
				await voidModelService.initializeModel(uri)
				const { model } = await voidModelService.getModelSafe(uri)
				if (model === null) { throw new Error(`No contents; File does not exist.`) }

				let contents: string
				if (startLine === null && endLine === null) {
					contents = model.getValue(EndOfLinePreference.LF)
				}
				else {
					const startLineNumber = startLine === null ? 1 : startLine
					const endLineNumber = endLine === null ? model.getLineCount() : endLine
					contents = model.getValueInRange({ startLineNumber, startColumn: 1, endLineNumber, endColumn: Number.MAX_SAFE_INTEGER }, EndOfLinePreference.LF)
				}

				const totalNumLines = model.getLineCount()

				const fromIdx = MAX_FILE_CHARS_PAGE * (pageNumber - 1)
				const toIdx = MAX_FILE_CHARS_PAGE * pageNumber - 1
				const fileContents = contents.slice(fromIdx, toIdx + 1) // paginate
				const hasNextPage = (contents.length - 1) - toIdx >= 1
				const totalFileLen = contents.length
				return { result: { fileContents, totalFileLen, hasNextPage, totalNumLines } }
			},

			ls_dir: async ({ uri, pageNumber, ignoreGlobs }) => {
				const dirResult = await computeDirectoryTree1Deep(fileService, uri, pageNumber)
				if (ignoreGlobs && ignoreGlobs.length > 0 && dirResult.children) {
					dirResult.children = dirResult.children.filter(child => {
						return !ignoreGlobs.some(glob => {
							const pattern = glob.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '.')
							return new RegExp(`^${pattern}$`).test(child.name)
						})
					})
				}
				return { result: dirResult }
			},

			get_dir_tree: async ({ uri }) => {
				const str = await this.directoryStrService.getDirectoryStrTool(uri)
				return { result: { str } }
			},

			search_pathnames_only: async ({ query: queryStr, includePattern, globPattern, pageNumber }) => {

				const query = queryBuilder.file(workspaceContextService.getWorkspace().folders.map(f => f.uri), {
					filePattern: globPattern ?? queryStr,
					includePattern: includePattern ?? undefined,
					sortByScore: true, // makes results 10x better
				})
				const data = await searchService.fileSearch(query, CancellationToken.None)

				const fromIdx = MAX_CHILDREN_URIs_PAGE * (pageNumber - 1)
				const toIdx = MAX_CHILDREN_URIs_PAGE * pageNumber - 1
				const uris = data.results
					.slice(fromIdx, toIdx + 1) // paginate
					.map(({ resource, results }) => resource)

				const hasNextPage = (data.results.length - 1) - toIdx >= 1
				return { result: { uris, hasNextPage } }
			},

			search_for_files: async ({ query: queryStr, isRegex, searchInFolder, pageNumber }) => {
				const searchFolders = searchInFolder === null ?
					workspaceContextService.getWorkspace().folders.map(f => f.uri)
					: [searchInFolder]

				const query = queryBuilder.text({
					pattern: queryStr,
					isRegExp: isRegex,
				}, searchFolders)

				const data = await searchService.textSearch(query, CancellationToken.None)

				const fromIdx = MAX_CHILDREN_URIs_PAGE * (pageNumber - 1)
				const toIdx = MAX_CHILDREN_URIs_PAGE * pageNumber - 1
				const uris = data.results
					.slice(fromIdx, toIdx + 1) // paginate
					.map(({ resource, results }) => resource)

				const hasNextPage = (data.results.length - 1) - toIdx >= 1
				return { result: { queryStr, uris, hasNextPage } }
			},
			search_in_file: async ({ uri, query, isRegex }) => {
				await voidModelService.initializeModel(uri);
				const { model } = await voidModelService.getModelSafe(uri);
				if (model === null) { throw new Error(`No contents; File does not exist.`); }
				const contents = model.getValue(EndOfLinePreference.LF);
				const contentOfLine = contents.split('\n');
				const totalLines = contentOfLine.length;
				const regex = isRegex ? new RegExp(query) : null;
				const lines: number[] = []
				for (let i = 0; i < totalLines; i++) {
					const line = contentOfLine[i];
					if ((isRegex && regex!.test(line)) || (!isRegex && line.includes(query))) {
						const matchLine = i + 1;
						lines.push(matchLine);
					}
				}
				return { result: { lines } };
			},

			read_lint_errors: async ({ uris }) => {
				await timeout(1000)
				const allLintErrors = uris.map(uri => {
					const { lintErrors } = this._getLintErrors(uri)
					return { uri: uri.toString(), lintErrors: lintErrors ?? [] }
				})
				return { result: { allLintErrors } }
			},

			// ---

			create_file_or_folder: async ({ uri, isFolder }) => {
				if (isFolder)
					await fileService.createFolder(uri)
				else {
					await fileService.createFile(uri)
				}
				return { result: {} }
			},

			delete_file_or_folder: async ({ uri, isRecursive }) => {
				await fileService.del(uri, { recursive: isRecursive })
				return { result: {} }
			},

			rewrite_file: async ({ uri, newContent }) => {
				await voidModelService.initializeModel(uri)
				if (this.commandBarService.getStreamState(uri) === 'streaming') {
					throw new Error(`Another LLM is currently making changes to this file. Please stop streaming for now and ask the user to resume later.`)
				}
				await editCodeService.callBeforeApplyOrEdit(uri)
				editCodeService.instantlyRewriteFile({ uri, newContent })
				// at end, get lint errors
				const lintErrorsPromise = Promise.resolve().then(async () => {
					await timeout(2000)
					const { lintErrors } = this._getLintErrors(uri)
					return { lintErrors }
				})
				return { result: lintErrorsPromise }
			},

			edit_file: async ({ uri, searchReplaceBlocks }) => {
				await voidModelService.initializeModel(uri)
				if (this.commandBarService.getStreamState(uri) === 'streaming') {
					throw new Error(`Another LLM is currently making changes to this file. Please stop streaming for now and ask the user to resume later.`)
				}
				await editCodeService.callBeforeApplyOrEdit(uri)
				editCodeService.instantlyApplySearchReplaceBlocks({ uri, searchReplaceBlocks })

				// at end, get lint errors
				const lintErrorsPromise = Promise.resolve().then(async () => {
					await timeout(2000)
					const { lintErrors } = this._getLintErrors(uri)
					return { lintErrors }
				})

				return { result: lintErrorsPromise }
			},
			// ---
			run_command: async ({ command, cwd, terminalId }) => {
				// Route through E2B cloud sandbox if enabled
				if (this.sandboxService.isE2BMode()) {
					const e2bResult = await this.sandboxService.runInE2B(command, cwd ?? undefined);
					const output = `$ ${command}\n${e2bResult.stdout}${e2bResult.stderr ? '\n[stderr] ' + e2bResult.stderr : ''}`;
					const resolveReason: TerminalResolveReason = { type: 'done', exitCode: e2bResult.exitCode };
					const errorClassification = this.errorClassificationService.classifyOutput(output, command, resolveReason);
					return {
						result: Promise.resolve({ result: output, resolveReason, errorClassification }),
						interruptTool: () => { /* E2B commands can't be interrupted locally */ },
					};
				}

				const { resPromise, interrupt } = await this.terminalToolService.runCommand(command, { type: 'temporary', cwd, terminalId })
				const classifiedPromise = resPromise.then(res => {
					const errorClassification = this.errorClassificationService.classifyOutput(res.result, command, res.resolveReason)
					return { ...res, errorClassification }
				})
				return { result: classifiedPromise, interruptTool: interrupt }
			},
			run_persistent_command: async ({ command, persistentTerminalId }) => {
				const { resPromise, interrupt } = await this.terminalToolService.runCommand(command, { type: 'persistent', persistentTerminalId })
				const classifiedPromise = resPromise.then(res => {
					const errorClassification = this.errorClassificationService.classifyOutput(res.result, command, res.resolveReason)
					return { ...res, errorClassification }
				})
				return { result: classifiedPromise, interruptTool: interrupt }
			},
			open_persistent_terminal: async ({ cwd }) => {
				const persistentTerminalId = await this.terminalToolService.createPersistentTerminal({ cwd })
				return { result: { persistentTerminalId } }
			},
			kill_persistent_terminal: async ({ persistentTerminalId }) => {
				// Close the background terminal by sending exit
				await this.terminalToolService.killPersistentTerminal(persistentTerminalId)
				return { result: {} }
			},

			web_search: async ({ query, maxResults }) => {
				const tavilyApiKey = this.voidSettingsService.state.globalSettings.tavilyApiKey
				if (!tavilyApiKey) {
					throw new Error('Tavily API key not configured. Please add your Tavily API key in Settings > Web Search.')
				}

				const response = await fetch('https://api.tavily.com/search', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						api_key: tavilyApiKey,
						query,
						max_results: maxResults,
						include_answer: false,
						include_raw_content: false,
					}),
				})

				if (!response.ok) {
					const errorText = await response.text()
					throw new Error(`Tavily API error (${response.status}): ${errorText}`)
				}

				const data = await response.json()
				const results = (data.results || []).map((r: any) => ({
					title: r.title || '',
					url: r.url || '',
					content: r.content || '',
				}))

				return { result: { results, query } }
			},

			spawn_subagent: async ({ type, prompt, background }) => {
				const execution = await this.subagentService.spawnSubagent('', type as any, prompt, background);
				return {
					result: {
						executionId: execution.id,
						status: execution.status,
						result: execution.result ?? 'Subagent is running in the background.',
					}
				}
			},

			fetch_rules: async ({ ruleName }) => {
				if (ruleName) {
					const rule = this.rulesService.getRuleByName(ruleName)
					if (!rule) {
						return { result: { rules: [] } }
					}
					return { result: { rules: [{ name: rule.name, description: rule.description, content: rule.content, source: rule.source, applyIntelligently: rule.applyIntelligently }] } }
				}
				// Return list of all rules (without content)
				const allRules = this.rulesService.getAllRules()
				return {
					result: {
						rules: allRules.map(r => ({
							name: r.name,
							description: r.description,
							source: r.source,
							applyIntelligently: r.applyIntelligently,
							alwaysApply: r.alwaysApply,
						}))
					}
				}
			},

			codebase_search: async ({ query, targetDirectory, maxResults }) => {
				// Auto-index workspace on first search if not yet indexed
				if (!this.embeddingsService.isIndexed()) {
					await this.embeddingsService.indexWorkspace()
				}

				const searchResults = this.embeddingsService.search(query, targetDirectory, maxResults)
				return {
					result: {
						results: searchResults.map(r => ({
							uri: r.uri.toString(),
							startLine: r.startLine,
							endLine: r.endLine,
							content: r.content,
							score: r.score,
							symbolName: r.symbolName,
						}))
					}
				}
			},

			run_verification: async ({ cwd, steps }) => {
				const pipelineResult = await this.verificationPipelineService.runPipeline(cwd, steps)
				return { result: { pipelineResult } }
			},

			git_create_branch: async ({ branchName }) => {
				const folders = workspaceContextService.getWorkspace().folders
				const cwd = folders[0]?.uri.fsPath || '.'
				const cmd = await this.callTool.run_command({ command: `git checkout -b ${branchName}`, cwd, terminalId: '__void_git' })
				const result = await cmd.result
				return { result: { branchName, success: !result.resolveReason || result.resolveReason.type === 'done' } }
			},
			git_commit: async ({ message, files }) => {
				const folders = workspaceContextService.getWorkspace().folders
				const cwd = folders[0]?.uri.fsPath || '.'
				const stageCmd = files
					? `git add ${files.split(',').map(f => f.trim()).join(' ')}`
					: 'git add -A'
				await (await this.callTool.run_command({ command: stageCmd, cwd, terminalId: '__void_git' })).result
				const commitCmd = await this.callTool.run_command({ command: `git commit -m "${message.replace(/"/g, '\\"')}"`, cwd, terminalId: '__void_git' })
				const result = await commitCmd.result
				const hashMatch = result.result.match(/\[[\w-]+\s+([a-f0-9]+)\]/)
				return { result: { commitHash: hashMatch?.[1] || 'unknown', message } }
			},
			git_push: async ({ remote, branch }) => {
				const folders = workspaceContextService.getWorkspace().folders
				const cwd = folders[0]?.uri.fsPath || '.'
				const branchArg = branch ? ` ${branch}` : ''
				const cmd = await this.callTool.run_command({ command: `git push -u ${remote}${branchArg}`, cwd, terminalId: '__void_git' })
				const result = await cmd.result
				return { result: { success: !result.resolveReason || result.resolveReason.type === 'done', output: result.result } }
			},
			create_pull_request: async ({ title, body, baseBranch }) => {
				const folders = workspaceContextService.getWorkspace().folders
				const cwd = folders[0]?.uri.fsPath || '.'
				const baseArg = baseBranch ? ` --base ${baseBranch}` : ''
				const cmd = await this.callTool.run_command({
					command: `gh pr create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}"${baseArg}`,
					cwd, terminalId: '__void_git',
				})
				const result = await cmd.result
				const urlMatch = result.result.match(/(https:\/\/github\.com\/\S+\/pull\/\d+)/)
				const numMatch = result.result.match(/pull\/(\d+)/)
				return { result: { url: urlMatch?.[1] || '', number: numMatch ? parseInt(numMatch[1]) : 0, success: !!urlMatch } }
			},

			create_diagram: async ({ content }) => {
				// Diagram is rendered in the chat UI via the mermaid renderer in ChatMarkdownRender
				// The tool just validates and returns the content for display
				return { result: { content, success: true } }
			},

			edit_notebook: async ({ uri, cellIndex, isNewCell, cellLanguage, oldString, newString }) => {
				try {
					await voidModelService.initializeModel(uri)
					const { model } = await voidModelService.getModelSafe(uri)
					if (!model) throw new Error('Notebook file not found')

					const text = model.getValue()
					const notebook = JSON.parse(text)
					const cells = notebook.cells || []

					if (isNewCell) {
						const newCell = {
							cell_type: cellLanguage === 'markdown' ? 'markdown' : 'code',
							metadata: {},
							source: newString.split('\n').map((l: string, i: number, arr: string[]) => i < arr.length - 1 ? l + '\n' : l),
							outputs: [],
						}
						cells.splice(cellIndex, 0, newCell)
					} else {
						if (cellIndex >= cells.length) throw new Error(`Cell index ${cellIndex} out of range (${cells.length} cells)`)
						const cell = cells[cellIndex]
						const cellSource = Array.isArray(cell.source) ? cell.source.join('') : cell.source
						if (oldString && cellSource.includes(oldString)) {
							const newSource = cellSource.replace(oldString, newString)
							cell.source = newSource.split('\n').map((l: string, i: number, arr: string[]) => i < arr.length - 1 ? l + '\n' : l)
						} else if (!oldString) {
							cell.source = newString.split('\n').map((l: string, i: number, arr: string[]) => i < arr.length - 1 ? l + '\n' : l)
						} else {
							throw new Error('old_string not found in cell')
						}
					}

					notebook.cells = cells
					const newContent = JSON.stringify(notebook, null, 1)
					// Write back via rewrite_file
					await this.callTool.rewrite_file({ uri, newContent })
					return { result: { success: true, message: isNewCell ? `Created new cell at index ${cellIndex}` : `Edited cell ${cellIndex}` } }
				} catch (e: any) {
					return { result: { success: false, message: e?.message || 'Failed to edit notebook' } }
				}
			},

			reapply_edit: async ({ uri }) => {
				try {
					// Re-read the file and attempt to apply the last edit more carefully
					// This triggers a slow-apply (full rewrite) instead of fast-apply (search/replace)
					await voidModelService.initializeModel(uri)
					const { model } = await voidModelService.getModelSafe(uri)
					if (!model) throw new Error('File not found')
					return { result: { success: true, message: `File ${uri.fsPath} ready for reapply. Use rewrite_file for a clean rewrite.` } }
				} catch (e: any) {
					return { result: { success: false, message: e?.message || 'Failed to reapply' } }
				}
			},

			ask_user: async ({ question }) => {
				// Returns a promise that resolves when the user responds via the UI
				const result = await new Promise<{ userResponse: string }>((resolve) => {
					this._pendingAskUserResolve = resolve
				})
				return { result }
			},

			grep: async ({ pattern, path, include, outputMode, contextLines, caseInsensitive, maxResults }) => {
				const searchFolders = path
					? [validateURI(path)]
					: workspaceContextService.getWorkspace().folders.map(f => f.uri)

				const query = queryBuilder.text({
					pattern,
					isRegExp: true,
					isCaseSensitive: !caseInsensitive,
				}, searchFolders, {
					includePattern: include ?? undefined,
				})

				const data = await searchService.textSearch(query, CancellationToken.None)
				const matches: GrepMatchItem[] = []
				let totalMatches = 0

				for (const fileResult of data.results) {
					if (!fileResult.results) continue
					for (const match of fileResult.results) {
						if (!resultIsMatch(match)) continue
						totalMatches++
						if (matches.length >= maxResults) continue
						const lineNumber = match.rangeLocations[0]?.source.startLineNumber ?? 0
						matches.push({
							file: fileResult.resource.fsPath,
							line: lineNumber,
							content: match.previewText.trim(),
							contextBefore: [],
							contextAfter: [],
						})
					}
				}

				return { result: { matches, totalMatches, truncated: totalMatches > maxResults } }
			},

			update_memory: async ({ action, title, content, memoryId, memoryType, tags, context }) => {
				if (action === 'list') {
					const all = await this.memoryService.getAllMemories()
					const listing = all.map(m => `[${m.id}] (${m.type}) ${m.content}`).join('\n')
					return { result: { success: true, memoryId: '', message: all.length === 0 ? 'No memories stored.' : listing } }
				}

				if (action === 'delete') {
					if (!memoryId) throw new Error('memory_id is required for delete action')
					await this.memoryService.removeMemory(memoryId)
					return { result: { success: true, memoryId, message: `Memory deleted: ${memoryId}` } }
				}

				// create or update
				const validTypes: MemoryType[] = ['project_fact', 'decision', 'pattern', 'preference']
				const mType: MemoryType = validTypes.includes(memoryType as MemoryType) ? (memoryType as MemoryType) : 'project_fact'
				const tagsList = tags ? tags.split(',').map(t => t.trim()).filter(t => t.length > 0) : []

				if (action === 'update' && memoryId) {
					await this.memoryService.removeMemory(memoryId)
				}

				const memory = await this.memoryService.addMemory({
					type: mType,
					content: content ?? title,
					context: context ?? '',
					tags: tagsList,
				})

				return { result: { success: true, memoryId: memory.id, message: `Memory ${action === 'update' ? 'updated' : 'created'}: ${title}` } }
			},

			todo_write: async ({ todos: todosStr, merge }) => {
				let parsedTodos: any[]
				try {
					parsedTodos = JSON.parse(todosStr)
					if (!Array.isArray(parsedTodos)) throw new Error('todos must be a JSON array')
				} catch (e: any) {
					throw new Error(`Invalid todos JSON: ${e.message}`)
				}

				const newTodos: TodoItem[] = parsedTodos.map((t: any) => ({
					id: t.id ?? generateUuid(),
					content: t.content ?? '',
					status: t.status ?? 'pending',
				}))

				if (merge) {
					// Merge: update existing by id, add new ones
					for (const todo of newTodos) {
						this._todoStore.set(todo.id, todo)
					}
				} else {
					// Replace: clear and set new
					this._todoStore.clear()
					for (const todo of newTodos) {
						this._todoStore.set(todo.id, todo)
					}
				}

				return { result: { todos: Array.from(this._todoStore.values()) } }
			},

			// --- Debug Agent Tools ---
			set_breakpoint: async ({ uri, line, condition }) => {
				const breakpointData = [{
					lineNumber: line,
					column: undefined,
					enabled: true,
					condition: condition ?? undefined,
				}]
				const breakpoints = await this.debugService.addBreakpoints(uri, breakpointData)
				const bp = breakpoints[0]
				return { result: { success: !!bp, breakpointId: bp?.getId() ?? generateUuid() } }
			},

			remove_breakpoint: async ({ uri, line }) => {
				const debugModel = this.debugService.getModel()
				const breakpoints = debugModel.getBreakpoints({ uri, lineNumber: line })
				if (breakpoints.length === 0) {
					return { result: { success: false } }
				}
				await this.debugService.removeBreakpoints(breakpoints[0].getId())
				return { result: { success: true } }
			},

			read_debug_state: async () => {
				const debugModel = this.debugService.getModel()
				const sessions = debugModel.getSessions()
				const activeSession = sessions.length > 0 ? sessions[0] : null

				// Get breakpoints
				const breakpoints = debugModel.getBreakpoints()
				const bpStrings = breakpoints.map((bp: any) => {
					const loc = `${bp.uri.fsPath}:${bp.lineNumber}`
					const cond = bp.condition ? ` (when: ${bp.condition})` : ''
					const enabled = bp.enabled ? '' : ' [disabled]'
					return `${loc}${cond}${enabled}`
				})

				if (!activeSession) {
					return {
						result: {
							hasActiveSession: false,
							sessionName: null,
							callStack: [],
							variables: [],
							breakpoints: bpStrings,
						}
					}
				}

				// Get call stack from first thread
				const threads = activeSession.getAllThreads()
				const callStack: string[] = []
				const variables: string[] = []

				if (threads.length > 0) {
					const thread = threads[0]
					const frames = thread.getCallStack()
					for (const frame of frames) {
						callStack.push(`${frame.name} (${frame.source?.name ?? 'unknown'}:${frame.range.startLineNumber})`)
					}

					// Get variables from top frame
					if (frames.length > 0) {
						const scopes = await frames[0].getScopes()
						for (const scope of scopes) {
							const children = await scope.getChildren()
							for (const child of children) {
								variables.push(`${child.name}: ${child.value}`)
							}
						}
					}
				}

				return {
					result: {
						hasActiveSession: true,
						sessionName: activeSession.name,
						callStack,
						variables: variables.slice(0, 50), // Limit to prevent huge outputs
						breakpoints: bpStrings,
					}
				}
			},

			start_debug_session: async ({ configName, filePath }) => {
				try {
					// Try to find a launch configuration by name
					if (configName) {
						const debugModel = this.debugService.getModel()
						const configs = this.debugService.getConfigurationManager().getLaunches()
						for (const launch of configs) {
							const launchConfigs = launch.getConfigurationNames()
							if (launchConfigs.includes(configName)) {
								const config = launch.getConfiguration(configName)
								if (config) {
									const success = await this.debugService.startDebugging(launch, config.name)
									const sessions = debugModel.getSessions()
									const sessionId = sessions.length > 0 ? sessions[sessions.length - 1].getId() : null
									return { result: { success, sessionId, message: success ? `Debug session started: ${configName}` : `Failed to start debug session: ${configName}` } }
								}
							}
						}
						return { result: { success: false, sessionId: null, message: `Launch configuration "${configName}" not found. Check .vscode/launch.json.` } }
					}

					// If a file path is provided, try to debug it directly
					if (filePath) {
						const uri = URI.file(filePath)
						const configs = this.debugService.getConfigurationManager().getLaunches()
						const launch = configs.length > 0 ? configs[0] : undefined
						const success = await this.debugService.startDebugging(launch, { type: 'node', request: 'launch', name: `Debug ${filePath}`, program: uri.fsPath } as any)
						const debugModel = this.debugService.getModel()
						const sessions = debugModel.getSessions()
						const sessionId = sessions.length > 0 ? sessions[sessions.length - 1].getId() : null
						return { result: { success, sessionId, message: success ? `Debug session started for ${filePath}` : `Failed to start debug session for ${filePath}` } }
					}

					return { result: { success: false, sessionId: null, message: 'Provide either configName or filePath to start a debug session.' } }
				} catch (e) {
					return { result: { success: false, sessionId: null, message: `Error starting debug session: ${e}` } }
				}
			},

			debug_step: async ({ stepType }) => {
				const debugModel = this.debugService.getModel()
				const sessions = debugModel.getSessions()
				if (sessions.length === 0) {
					return { result: { success: false, message: 'No active debug session. Use start_debug_session first.' } }
				}

				const activeSession = sessions[0]
				const threads = activeSession.getAllThreads()
				if (threads.length === 0) {
					return { result: { success: false, message: 'No threads available in the debug session.' } }
				}

				const thread = threads[0]
				try {
					switch (stepType) {
						case 'stepOver':
							await thread.next()
							return { result: { success: true, message: 'Stepped over to next line.' } }
						case 'stepInto':
							await thread.stepIn()
							return { result: { success: true, message: 'Stepped into function.' } }
						case 'stepOut':
							await thread.stepOut()
							return { result: { success: true, message: 'Stepped out of function.' } }
						case 'continue':
							await thread.continue()
							return { result: { success: true, message: 'Resumed execution.' } }
						default:
							return { result: { success: false, message: `Unknown step type: ${stepType}` } }
					}
				} catch (e) {
					return { result: { success: false, message: `Step failed: ${e}` } }
				}
			},

			debug_evaluate: async ({ expression, frameId }) => {
				const debugModel = this.debugService.getModel()
				const sessions = debugModel.getSessions()
				if (sessions.length === 0) {
					return { result: { success: false, result: 'No active debug session.', type: null } }
				}

				const activeSession = sessions[0]
				try {
					// Determine frame ID
					let evalFrameId: number | undefined
					if (frameId) {
						evalFrameId = parseInt(frameId, 10)
					} else {
						// Use top frame of first thread
						const threads = activeSession.getAllThreads()
						if (threads.length > 0) {
							const frames = threads[0].getCallStack()
							if (frames.length > 0) {
								evalFrameId = frames[0].frameId
							}
						}
					}

					const evalResult = await activeSession.evaluate(expression, evalFrameId ?? 0, 'repl')
					if (evalResult) {
						return { result: { success: true, result: evalResult.body.result, type: evalResult.body.type ?? null } }
					}
					return { result: { success: false, result: 'Evaluation returned no result.', type: null } }
				} catch (e) {
					return { result: { success: false, result: `Evaluation error: ${e}`, type: null } }
				}
			},

			// --- Extended Git Operations ---
			git_log: async ({ maxCount, filePath, author, since, until, grep }) => {
				const args = ['git', 'log', `--max-count=${maxCount}`, '--oneline', '--decorate']
				if (author) args.push(`--author=${author}`)
				if (since) args.push(`--since=${since}`)
				if (until) args.push(`--until=${until}`)
				if (grep) args.push(`--grep=${grep}`)
				if (filePath) args.push('--', filePath)
				const cmd = await this.callTool.run_command({ command: args.join(' '), cwd: null, terminalId: '__void_git' })
				const result = await cmd.result
				return { result: { output: result.result } }
			},

			git_diff: async ({ target, filePath, staged }) => {
				const args = ['git', 'diff']
				if (staged) args.push('--cached')
				if (target) args.push(target)
				if (filePath) args.push('--', filePath)
				const cmd = await this.callTool.run_command({ command: args.join(' '), cwd: null, terminalId: '__void_git' })
				const result = await cmd.result
				return { result: { output: result.result } }
			},

			git_status: async () => {
				const cmd = await this.callTool.run_command({ command: 'git status', cwd: null, terminalId: '__void_git' })
				const result = await cmd.result
				return { result: { output: result.result } }
			},

			git_stash: async ({ action, message, stashIndex }) => {
				let gitCmd = 'git stash'
				switch (action) {
					case 'save': gitCmd += message ? ` push -m "${message}"` : ' push'; break
					case 'pop': gitCmd += ` pop stash@{${stashIndex}}`; break
					case 'apply': gitCmd += ` apply stash@{${stashIndex}}`; break
					case 'drop': gitCmd += ` drop stash@{${stashIndex}}`; break
					case 'list': gitCmd += ' list'; break
				}
				const cmd = await this.callTool.run_command({ command: gitCmd, cwd: null, terminalId: '__void_git' })
				const result = await cmd.result
				return { result: { output: result.result, success: !result.resolveReason || result.resolveReason.type === 'done' } }
			},

			git_blame: async ({ filePath, startLine, endLine }) => {
				let gitCmd = `git blame ${filePath}`
				if (startLine && endLine) gitCmd += ` -L ${startLine},${endLine}`
				else if (startLine) gitCmd += ` -L ${startLine},`
				const cmd = await this.callTool.run_command({ command: gitCmd, cwd: null, terminalId: '__void_git' })
				const result = await cmd.result
				return { result: { output: result.result } }
			},

			git_merge: async ({ branch, noFf }) => {
				const gitCmd = `git merge ${noFf ? '--no-ff ' : ''}${branch}`
				const cmd = await this.callTool.run_command({ command: gitCmd, cwd: null, terminalId: '__void_git' })
				const result = await cmd.result
				return { result: { output: result.result, success: !result.resolveReason || result.resolveReason.type === 'done' } }
			},

			git_reset: async ({ target, mode }) => {
				const gitCmd = `git reset --${mode} ${target}`
				const cmd = await this.callTool.run_command({ command: gitCmd, cwd: null, terminalId: '__void_git' })
				const result = await cmd.result
				return { result: { output: result.result, success: !result.resolveReason || result.resolveReason.type === 'done' } }
			},

			git_cherry_pick: async ({ commit }) => {
				const gitCmd = `git cherry-pick ${commit}`
				const cmd = await this.callTool.run_command({ command: gitCmd, cwd: null, terminalId: '__void_git' })
				const result = await cmd.result
				return { result: { output: result.result, success: !result.resolveReason || result.resolveReason.type === 'done' } }
			},

			git_rebase: async ({ onto, abort }) => {
				const gitCmd = abort ? 'git rebase --abort' : `git rebase ${onto}`
				const cmd = await this.callTool.run_command({ command: gitCmd, cwd: null, terminalId: '__void_git' })
				const result = await cmd.result
				return { result: { output: result.result, success: !result.resolveReason || result.resolveReason.type === 'done' } }
			},
		}


		const nextPageStr = (hasNextPage: boolean) => hasNextPage ? '\n\n(more on next page...)' : ''

		const stringifyLintErrors = (lintErrors: LintErrorItem[]) => {
			return lintErrors
				.map((e, i) => `Error ${i + 1}:\nLines Affected: ${e.startLineNumber}-${e.endLineNumber}\nError message:${e.message}`)
				.join('\n\n')
				.substring(0, MAX_FILE_CHARS_PAGE)
		}

		// given to the LLM after the call for successful tool calls
		this.stringOfResult = {
			read_file: (params, result) => {
				return `${params.uri.fsPath}\n\`\`\`\n${result.fileContents}\n\`\`\`${nextPageStr(result.hasNextPage)}${result.hasNextPage ? `\nMore info because truncated: this file has ${result.totalNumLines} lines, or ${result.totalFileLen} characters.` : ''}`
			},
			ls_dir: (params, result) => {
				const dirTreeStr = stringifyDirectoryTree1Deep(params, result)
				return dirTreeStr // + nextPageStr(result.hasNextPage) // already handles num results remaining
			},
			get_dir_tree: (params, result) => {
				return result.str
			},
			search_pathnames_only: (params, result) => {
				return result.uris.map(uri => uri.fsPath).join('\n') + nextPageStr(result.hasNextPage)
			},
			search_for_files: (params, result) => {
				return result.uris.map(uri => uri.fsPath).join('\n') + nextPageStr(result.hasNextPage)
			},
			search_in_file: (params, result) => {
				const { model } = voidModelService.getModel(params.uri)
				if (!model) return '<Error getting string of result>'
				const lines = result.lines.map(n => {
					const lineContent = model.getValueInRange({ startLineNumber: n, startColumn: 1, endLineNumber: n, endColumn: Number.MAX_SAFE_INTEGER }, EndOfLinePreference.LF)
					return `Line ${n}:\n\`\`\`\n${lineContent}\n\`\`\``
				}).join('\n\n');
				return lines;
			},
			read_lint_errors: (params, result) => {
				if (!result.allLintErrors || result.allLintErrors.length === 0) return 'No lint errors found.'
				const parts = result.allLintErrors.map(entry => {
					if (entry.lintErrors.length === 0) return `${entry.uri}: No lint errors.`
					return `${entry.uri}:\n${stringifyLintErrors(entry.lintErrors)}`
				})
				return parts.join('\n\n')
			},
			// ---
			create_file_or_folder: (params, result) => {
				return `URI ${params.uri.fsPath} successfully created.`
			},
			delete_file_or_folder: (params, result) => {
				return `URI ${params.uri.fsPath} successfully deleted.`
			},
			edit_file: (params, result) => {
				const lintErrsString = (
					this.voidSettingsService.state.globalSettings.includeToolLintErrors ?
						(result.lintErrors ? ` Lint errors found after change:\n${stringifyLintErrors(result.lintErrors)}.\nIf this is related to a change made while calling this tool, you might want to fix the error.`
							: ` No lint errors found.`)
						: '')

				return `Change successfully made to ${params.uri.fsPath}.${lintErrsString}`
			},
			rewrite_file: (params, result) => {
				const lintErrsString = (
					this.voidSettingsService.state.globalSettings.includeToolLintErrors ?
						(result.lintErrors ? ` Lint errors found after change:\n${stringifyLintErrors(result.lintErrors)}.\nIf this is related to a change made while calling this tool, you might want to fix the error.`
							: ` No lint errors found.`)
						: '')

				return `Change successfully made to ${params.uri.fsPath}.${lintErrsString}`
			},
			run_command: (params, result) => {
				const { resolveReason, result: result_, errorClassification } = result
				const redact = this.voidSettingsService.state.globalSettings.secretDetectionEnabled
				const output = redact ? redactSecrets(result_) : result_
				let str: string
				// success
				if (resolveReason.type === 'done') {
					str = `${output}\n(exit code ${resolveReason.exitCode})`
				}
				// normal command
				else if (resolveReason.type === 'timeout') {
					str = `${output}\nTerminal command ran, but was automatically killed by void after ${MAX_TERMINAL_INACTIVE_TIME}s of inactivity and did not finish successfully. To try with more time, open a persistent terminal and run the command there.`
				}
				else {
					throw new Error(`Unexpected internal error: Terminal command did not resolve with a valid reason.`)
				}
				// Append classification warning when errors detected with exit code 0
				if (errorClassification?.hasErrors && resolveReason.type === 'done' && resolveReason.exitCode === 0) {
					str += `\n\n[Warning: errors detected in output despite exit code 0: ${errorClassification.summary}]`
				}
				return str
			},

			run_persistent_command: (params, result) => {
				const { resolveReason, result: result_, } = result
				const { persistentTerminalId } = params
				const redact = this.voidSettingsService.state.globalSettings.secretDetectionEnabled
				const output = redact ? redactSecrets(result_) : result_
				// success
				if (resolveReason.type === 'done') {
					return `${output}\n(exit code ${resolveReason.exitCode})`
				}
				// bg command
				if (resolveReason.type === 'timeout') {
					return `${output}\nTerminal command is running in terminal ${persistentTerminalId}. The given outputs are the results after ${MAX_TERMINAL_BG_COMMAND_TIME} seconds.`
				}
				throw new Error(`Unexpected internal error: Terminal command did not resolve with a valid reason.`)
			},

			open_persistent_terminal: (_params, result) => {
				const { persistentTerminalId } = result;
				return `Successfully created persistent terminal. persistentTerminalId="${persistentTerminalId}"`;
			},
			kill_persistent_terminal: (params, _result) => {
				return `Successfully closed terminal "${params.persistentTerminalId}".`;
			},

			web_search: (params, result) => {
				if (result.results.length === 0) {
					return `No results found for query: "${params.query}"`
				}
				return result.results.map((r, i) =>
					`${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.content}`
				).join('\n\n')
			},

			spawn_subagent: (params, result) => {
				return `Subagent (${params.type}) completed:\n${result.result}`
			},

			fetch_rules: (params, result) => {
				if (result.rules.length === 0) {
					return params.ruleName ? `No rule found with name "${params.ruleName}".` : 'No rules found in .void/rules/ directory.'
				}
				if (params.ruleName && result.rules[0].content) {
					const r = result.rules[0]
					return `Rule: ${r.name}\nDescription: ${r.description}\n\n${r.content}`
				}
				return `Available rules:\n${result.rules.map((r, i) => `${i + 1}. ${r.name} — ${r.description}`).join('\n')}`
			},

			codebase_search: (params, result) => {
				if (result.results.length === 0) {
					return `No results found for query: "${params.query}"`
				}
				return result.results.map((r, i) => {
					const symbol = r.symbolName ? ` (${r.symbolName})` : ''
					const truncatedContent = r.content.length > 500 ? r.content.substring(0, 500) + '...' : r.content
					return `${i + 1}. ${r.uri}:${r.startLine}-${r.endLine}${symbol} [score: ${r.score.toFixed(2)}]\n${truncatedContent}`
				}).join('\n\n')
			},

			run_verification: (_params, result) => {
				const { pipelineResult } = result
				const header = pipelineResult.allPassed ? 'All verification steps passed.' : 'Verification pipeline failed.'
				const stepLines = pipelineResult.results.map(r => {
					const status = r.passed ? 'PASS' : (r.step.optional ? 'FAIL (optional)' : 'FAIL')
					const duration = `${(r.durationMs / 1000).toFixed(1)}s`
					const exitInfo = r.exitCode !== null ? ` (exit code ${r.exitCode})` : ''
					let line = `  ${status} - ${r.step.name}: ${r.step.command} [${duration}]${exitInfo}`
					if (!r.passed && r.output) {
						// Include last 500 chars of output for failed steps
						const trimmedOutput = r.output.length > 500 ? '...' + r.output.slice(-500) : r.output
						line += `\n    Output: ${trimmedOutput}`
					}
					return line
				}).join('\n')
				return `${header}\n${stepLines}`
			},

			git_create_branch: (_params, result) => {
				return result.success ? `Created and switched to branch: ${result.branchName}` : `Failed to create branch: ${result.branchName}`
			},
			git_commit: (_params, result) => {
				return `Committed: ${result.commitHash} - ${result.message}`
			},
			git_push: (_params, result) => {
				return result.success ? `Push successful:\n${result.output}` : `Push failed:\n${result.output}`
			},
			create_pull_request: (_params, result) => {
				return result.success ? `Pull request created: ${result.url}` : 'Failed to create pull request'
			},
			create_diagram: (_params, result) => {
				return result.success ? `\`\`\`mermaid\n${result.content}\n\`\`\`` : 'Failed to create diagram'
			},
			edit_notebook: (_params, result) => {
				return result.success ? result.message : `Error: ${result.message}`
			},
			reapply_edit: (_params, result) => {
				return result.success ? result.message : `Error: ${result.message}`
			},
			ask_user: (_params, result) => {
				return `User responded: ${result.userResponse}`
			},
			grep: (params, result) => {
				if (result.matches.length === 0) return 'No matches found.'
				if (params.outputMode === 'files_with_matches') {
					const files = [...new Set(result.matches.map(m => m.file))]
					return files.join('\n')
				}
				if (params.outputMode === 'count') {
					const counts: Record<string, number> = {}
					for (const m of result.matches) {
						counts[m.file] = (counts[m.file] || 0) + 1
					}
					return Object.entries(counts).map(([f, c]) => `${f}: ${c}`).join('\n')
				}
				// content mode
				const lines = result.matches.map(m => {
					const ctx: string[] = []
					if (m.contextBefore.length > 0) ctx.push(...m.contextBefore.map(l => `  ${l}`))
					ctx.push(`${m.file}:${m.line}: ${m.content}`)
					if (m.contextAfter.length > 0) ctx.push(...m.contextAfter.map(l => `  ${l}`))
					return ctx.join('\n')
				}).join('\n')
				const truncNote = result.truncated ? `\n\n(${result.totalMatches} total matches, showing first ${result.matches.length})` : ''
				return lines + truncNote
			},
			update_memory: (_params, result) => {
				return result.success ? result.message : `Failed to update memory: ${result.message}`
			},
			todo_write: (_params, result) => {
				if (result.todos.length === 0) return 'No todos written.'
				return result.todos.map(t => `[${t.status}] ${t.id}: ${t.content}`).join('\n')
			},

			// --- Debug Tools ---
			set_breakpoint: (params, result) => {
				return result.success
					? `Breakpoint set at ${params.uri.fsPath}:${params.line}${params.condition ? ` (condition: ${params.condition})` : ''}`
					: `Failed to set breakpoint at ${params.uri.fsPath}:${params.line}`
			},

			remove_breakpoint: (params, result) => {
				return result.success
					? `Breakpoint removed from ${params.uri.fsPath}:${params.line}`
					: `No breakpoint found at ${params.uri.fsPath}:${params.line}`
			},

			// --- Extended Git ---
			git_log: (_params, result) => result.output || 'No commits found.',
			git_diff: (_params, result) => result.output || 'No differences.',
			git_status: (_params, result) => result.output || 'Working tree clean.',
			git_stash: (_params, result) => result.output || 'Stash operation completed.',
			git_blame: (_params, result) => result.output,
			git_merge: (_params, result) => result.output || 'Merge completed.',
			git_reset: (_params, result) => result.output || 'Reset completed.',
			git_cherry_pick: (_params, result) => result.output || 'Cherry-pick completed.',
			git_rebase: (_params, result) => result.output || 'Rebase completed.',

			start_debug_session: (_params, result) => {
				return result.message
			},

			debug_step: (_params, result) => {
				return result.message
			},

			debug_evaluate: (params, result) => {
				if (result.success) {
					return `${params.expression} = ${result.result}${result.type ? ` (${result.type})` : ''}`
				}
				return result.result
			},

			read_debug_state: (_params, result) => {
				if (!result.hasActiveSession) {
					const bps = result.breakpoints.length > 0
						? `\nBreakpoints:\n${result.breakpoints.join('\n')}`
						: '\nNo breakpoints set.'
					return `No active debug session.${bps}`
				}
				let output = `Debug Session: ${result.sessionName}\n`
				output += `\nCall Stack:\n${result.callStack.length > 0 ? result.callStack.join('\n') : '  (empty)'}`
				output += `\n\nVariables:\n${result.variables.length > 0 ? result.variables.join('\n') : '  (none available)'}`
				output += `\n\nBreakpoints:\n${result.breakpoints.length > 0 ? result.breakpoints.join('\n') : '  (none set)'}`
				return output
			},
		}



	}

	// Pending ask_user resolver — called by chatThreadService when user submits a response
	private _pendingAskUserResolve: ((result: { userResponse: string }) => void) | null = null;

	respondToAskUser(response: string) {
		if (this._pendingAskUserResolve) {
			this._pendingAskUserResolve({ userResponse: response })
			this._pendingAskUserResolve = null
		}
	}


	private _getLintErrors(uri: URI): { lintErrors: LintErrorItem[] | null } {
		const lintErrors = this.markerService
			.read({ resource: uri })
			.filter(l => l.severity === MarkerSeverity.Error || l.severity === MarkerSeverity.Warning)
			.slice(0, 100)
			.map(l => ({
				code: typeof l.code === 'string' ? l.code : l.code?.value || '',
				message: (l.severity === MarkerSeverity.Error ? '(error) ' : '(warning) ') + l.message,
				startLineNumber: l.startLineNumber,
				endLineNumber: l.endLineNumber,
			} satisfies LintErrorItem))

		if (!lintErrors.length) return { lintErrors: null }
		return { lintErrors, }
	}


}

registerSingleton(IToolsService, ToolsService, InstantiationType.Eager);
