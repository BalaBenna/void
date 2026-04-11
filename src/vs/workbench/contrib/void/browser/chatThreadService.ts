/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IChatThreadService, ThreadType, ThreadsState, ThreadStreamState, IsRunningType, ChatThreads, WhenMounted } from './chatThreadServiceInterface.js';
export { IChatThreadService, ThreadType, ThreadsState, ThreadStreamState, IsRunningType } from './chatThreadServiceInterface.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

import { URI } from '../../../../base/common/uri.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { chat_userMessageContent, isABuiltinToolName } from '../common/prompt/prompts.js';
import { AnthropicReasoning, getErrorMessage, RawToolCallObj, RawToolParamsObj } from '../common/sendLLMMessageTypes.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ChatMode, FeatureName, ModelSelection, ModelSelectionOptions } from '../common/voidSettingsTypes.js';
import { IvoidSettingsService } from '../common/voidSettingsService.js';
import { approvalTypeOfBuiltinToolName, assessToolRisk, BuiltinToolCallParams, BuiltinToolResultType, ToolCallParams, ToolName, ToolResult } from '../common/toolsServiceTypes.js';
import { IToolsService } from './toolsService.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { BranchPoint, ChatMessage, CheckpointEntry, CodespanLocationLink, ImageAttachment, PlanItem, StagingSelectionItem, ToolMessage } from '../common/chatThreadServiceTypes.js';
import { Position } from '../../../../editor/common/core/position.js';
import { IMetricsService } from '../common/metricsService.js';
import { shorten } from '../../../../base/common/labels.js';
import { IvoidModelService } from '../common/voidModelService.js';
import { findLast, findLastIdx } from '../../../../base/common/arraysFind.js';
import { IEditCodeService } from './editCodeServiceInterface.js';
import { voidFileSnapshot } from '../common/editCodeServiceTypes.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { truncate } from '../../../../base/common/strings.js';
import { THREAD_STORAGE_KEY } from '../common/storageKeys.js';
import { IConvertToLLMMessageService } from './convertToLLMMessageService.js';
import { timeout } from '../../../../base/common/async.js';
import { deepClone } from '../../../../base/common/objects.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IDirectoryStrService } from '../common/directoryStrService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IMCPService } from '../common/mcpService.js';
import { RawMCPToolCall } from '../common/mcpServiceTypes.js';
import { IAgentEventService } from './agentEventService.js';
import { IModelRouterService } from './modelRouterService.js';
import { IMemoryService } from './memoryService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { ISelfHealingService } from './selfHealingService.js';
import { ITerminalCaptureService } from './terminalCaptureService.js';
import { IVerificationPipelineService } from './verificationPipelineService.js';


// related to retrying when LLM message has error
const CHAT_RETRIES = 3
const RETRY_DELAY = 2500


const findStagingSelectionIndex = (currentSelections: StagingSelectionItem[] | undefined, newSelection: StagingSelectionItem): number | null => {
	if (!currentSelections) return null

	for (let i = 0; i < currentSelections.length; i += 1) {
		const s = currentSelections[i]

		// Branch selections don't have URIs, handle separately
		if (s.type === 'Branch' || newSelection.type === 'Branch') {
			if (s.type === 'Branch' && newSelection.type === 'Branch') return i
			continue
		}

		if (s.uri?.fsPath !== newSelection.uri?.fsPath) continue

		if (s.type === 'File' && newSelection.type === 'File') {
			return i
		}
		if (s.type === 'CodeSelection' && newSelection.type === 'CodeSelection') {
			if (s.uri?.fsPath !== newSelection.uri?.fsPath) continue
			// if there's any collision return true
			const [oldStart, oldEnd] = s.range
			const [newStart, newEnd] = newSelection.range
			if (oldStart !== newStart || oldEnd !== newEnd) continue
			return i
		}
		if (s.type === 'Folder' && newSelection.type === 'Folder') {
			return i
		}
	}
	return null
}


/*

Store a checkpoint of all "before" files on each x.
x's show up before user messages and LLM edit tool calls.

x     A          (edited A -> A')
(... user modified changes ...)
User message

x     A' B C     (edited A'->A'', B->B', C->C')
LLM Edit
x
LLM Edit
x
LLM Edit


INVARIANT:
A checkpoint appears before every LLM message, and before every user message (before user really means directly after LLM is done).
*/


type UserMessageState = (ChatMessage & { role: 'user' })['state']
const defaultMessageState: UserMessageState = {
	stagingSelections: [],
	isBeingEdited: false,
}

const newThreadObject = () => {
	const now = new Date().toISOString()
	return {
		id: generateUuid(),
		createdAt: now,
		lastModified: now,
		messages: [],
		state: {
			currCheckpointIdx: null,
			stagingSelections: [],
			focusedMessageIdx: undefined,
			linksOfMessageIdx: {},
		},
		filesWithUserChanges: new Set()
	} satisfies ThreadType
}






class ChatThreadService extends Disposable implements IChatThreadService {
	_serviceBrand: undefined;

	// this fires when the current thread changes at all (a switch of currentThread, or a message added to it, etc)
	private readonly _onDidChangeCurrentThread = new Emitter<void>();
	readonly onDidChangeCurrentThread: Event<void> = this._onDidChangeCurrentThread.event;

	private readonly _onDidChangeStreamState = new Emitter<{ threadId: string }>();
	readonly onDidChangeStreamState: Event<{ threadId: string }> = this._onDidChangeStreamState.event;

	readonly streamState: ThreadStreamState = {}

	// Message queue: queued messages waiting to be sent when the thread is no longer busy
	private _messageQueue: Map<string, Array<{ userMessage: string, _chatSelections?: StagingSelectionItem[], webSearchEnabled?: boolean, images?: ImageAttachment[] }>> = new Map()
	state: ThreadsState // allThreads is persisted, currentThread is not

	// Plan file URI -> { threadId, planMessageIdx } mapping
	private readonly _planFileMappings = new Map<string, { threadId: string; planMessageIdx: number }>()

	// used in checkpointing
	// private readonly _userModifiedFilesToCheckInCheckpoints = new LRUCache<string, null>(50)



	constructor(
		@IStorageService private readonly _storageService: IStorageService,
		@IvoidModelService private readonly _voidModelService: IvoidModelService,
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
		@IToolsService private readonly _toolsService: IToolsService,
		@IvoidSettingsService private readonly _settingsService: IvoidSettingsService,
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
		@IMetricsService private readonly _metricsService: IMetricsService,
		@IEditCodeService private readonly _editCodeService: IEditCodeService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IConvertToLLMMessageService private readonly _convertToLLMMessagesService: IConvertToLLMMessageService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IDirectoryStrService private readonly _directoryStringService: IDirectoryStrService,
		@IFileService private readonly _fileService: IFileService,
		@IMCPService private readonly _mcpService: IMCPService,
		@IAgentEventService private readonly _agentEventService: IAgentEventService,
		@IModelRouterService private readonly _modelRouterService: IModelRouterService,
		@IMemoryService private readonly _memoryService: IMemoryService,
		@IEditorService private readonly _editorService: IEditorService,
		@ISelfHealingService private readonly _selfHealingService: ISelfHealingService,
		@ITerminalCaptureService private readonly _terminalCaptureService: ITerminalCaptureService,
		@IVerificationPipelineService private readonly _verificationPipelineService: IVerificationPipelineService,
	) {
		super()
		this.state = { allThreads: {}, currentThreadId: null as unknown as string } // default state

		const readThreads = this._readAllThreads() || {}

		const allThreads = readThreads
		this.state = {
			allThreads: allThreads,
			currentThreadId: null as unknown as string, // gets set in startNewThread()
		}

		// always be in a thread
		this.openNewThread()

		// Subscribe to terminal errors for auto-fix flow
		this._register(this._terminalCaptureService.onDidDetectError(error => {
			const threadId = this.state.currentThreadId
			const isRunning = this.streamState[threadId]?.isRunning
			if (!isRunning || isRunning === 'idle') {
				// Agent is idle - auto-populate chat with terminal error context
				const terminalSelection: StagingSelectionItem = {
					type: 'Terminal',
					terminalId: error.terminalId,
					content: error.fullOutput,
				}
				this.addNewStagingSelection(terminalSelection)
			}
		}))

		// keep track of user-modified files
		// const disposablesOfModelId: { [modelId: string]: IDisposable[] } = {}
		// this._register(
		// 	this._modelService.onModelAdded(e => {
		// 		if (!(e.id in disposablesOfModelId)) disposablesOfModelId[e.id] = []
		// 		disposablesOfModelId[e.id].push(
		// 			e.onDidChangeContent(() => { this._userModifiedFilesToCheckInCheckpoints.set(e.uri.fsPath, null) })
		// 		)
		// 	})
		// )
		// this._register(this._modelService.onModelRemoved(e => {
		// 	if (!(e.id in disposablesOfModelId)) return
		// 	disposablesOfModelId[e.id].forEach(d => d.dispose())
		// }))

	}

	async focusCurrentChat() {
		const threadId = this.state.currentThreadId
		const thread = this.state.allThreads[threadId]
		if (!thread) return
		const s = await thread.state.mountedInfo?.whenMounted
		if (!this.isCurrentlyFocusingMessage()) {
			s?.textAreaRef.current?.focus()
		}
	}
	async blurCurrentChat() {
		const threadId = this.state.currentThreadId
		const thread = this.state.allThreads[threadId]
		if (!thread) return
		const s = await thread.state.mountedInfo?.whenMounted
		if (!this.isCurrentlyFocusingMessage()) {
			s?.textAreaRef.current?.blur()
		}
	}



	dangerousSetState = (newState: ThreadsState) => {
		this.state = newState
		this._onDidChangeCurrentThread.fire()
	}
	resetState = () => {
		this.state = { allThreads: {}, currentThreadId: null as unknown as string } // see constructor
		this.openNewThread()
		this._onDidChangeCurrentThread.fire()
	}

	// !!! this is important for properly restoring URIs from storage
	// should probably re-use code from void/src/vs/base/common/marshalling.ts instead. but this is simple enough
	private _convertThreadDataFromStorage(threadsStr: string): ChatThreads {
		return JSON.parse(threadsStr, (key, value) => {
			if (value && typeof value === 'object' && value.$mid === 1) { // $mid is the MarshalledId. $mid === 1 means it is a URI
				return URI.from(value); // TODO URI.revive instead of this?
			}
			return value;
		});
	}

	private _readAllThreads(): ChatThreads | null {
		const threadsStr = this._storageService.get(THREAD_STORAGE_KEY, StorageScope.APPLICATION);
		if (!threadsStr) {
			return null
		}
		const threads = this._convertThreadDataFromStorage(threadsStr);

		return threads
	}

	private _storeAllThreads(threads: ChatThreads) {
		const serializedThreads = JSON.stringify(threads);
		this._storageService.store(
			THREAD_STORAGE_KEY,
			serializedThreads,
			StorageScope.APPLICATION,
			StorageTarget.USER
		);
	}


	// this should be the only place this.state = ... appears besides constructor
	private _setState(state: Partial<ThreadsState>, doNotRefreshMountInfo?: boolean) {
		const newState = {
			...this.state,
			...state
		}

		this.state = newState

		this._onDidChangeCurrentThread.fire()


		// if we just switched to a thread, update its current stream state if it's not streaming to possibly streaming
		const threadId = newState.currentThreadId
		const streamState = this.streamState[threadId]
		if (streamState?.isRunning === undefined && !streamState?.error) {

			// set streamState
			const messages = newState.allThreads[threadId]?.messages
			const lastMessage = messages && messages[messages.length - 1]
			// if awaiting user but stream state doesn't indicate it (happens if restart void)
			if (lastMessage && lastMessage.role === 'tool' && lastMessage.type === 'tool_request')
				this._setStreamState(threadId, { isRunning: 'awaiting_user', })

			// if running now but stream state doesn't indicate it (happens if restart void), cancel that last tool
			if (lastMessage && lastMessage.role === 'tool' && lastMessage.type === 'running_now') {

				this._updateLatestTool(threadId, { role: 'tool', type: 'rejected', content: lastMessage.content, id: lastMessage.id, rawParams: lastMessage.rawParams, result: null, name: lastMessage.name, params: lastMessage.params, mcpServerName: lastMessage.mcpServerName })
			}

		}


		// if we did not just set the state to true, set mount info
		if (doNotRefreshMountInfo) return

		let whenMountedResolver: (w: WhenMounted) => void
		const whenMountedPromise = new Promise<WhenMounted>((res) => whenMountedResolver = res)

		this._setThreadState(threadId, {
			mountedInfo: {
				whenMounted: whenMountedPromise,
				mountedIsResolvedRef: { current: false },
				_whenMountedResolver: (w: WhenMounted) => {
					whenMountedResolver(w)
					const mountInfo = this.state.allThreads[threadId]?.state.mountedInfo
					if (mountInfo) mountInfo.mountedIsResolvedRef.current = true
				},
			}
		}, true) // do not trigger an update



	}


	private _setStreamState(threadId: string, state: ThreadStreamState[string]) {
		this.streamState[threadId] = state
		this._onDidChangeStreamState.fire({ threadId })
	}


	// ---------- streaming ----------



	private _currentModelSelectionProps = () => {
		// these settings should not change throughout the loop (eg anthropic breaks if you change its thinking mode and it's using tools)
		const featureName: FeatureName = 'Chat'
		const modelSelection = this._settingsService.state.modelSelectionOfFeature[featureName]
		const modelSelectionOptions = modelSelection ? this._settingsService.state.optionsOfModelSelection[featureName][modelSelection.providerName]?.[modelSelection.modelName] : undefined
		return { modelSelection, modelSelectionOptions }
	}



	private _swapOutLatestStreamingToolWithResult = (threadId: string, tool: ChatMessage & { role: 'tool' }) => {
		const messages = this.state.allThreads[threadId]?.messages
		if (!messages) return false
		const lastMsg = messages[messages.length - 1]
		if (!lastMsg) return false

		if (lastMsg.role === 'tool' && lastMsg.type !== 'invalid_params') {
			this._editMessageInThread(threadId, messages.length - 1, tool)
			return true
		}
		return false
	}
	private _updateLatestTool = (threadId: string, tool: ChatMessage & { role: 'tool' }) => {
		const swapped = this._swapOutLatestStreamingToolWithResult(threadId, tool)
		if (swapped) return
		this._addMessageToThread(threadId, tool)
	}

	approveLatestToolRequest(threadId: string) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return // should never happen

		const lastMsg = thread.messages[thread.messages.length - 1]
		if (!(lastMsg.role === 'tool' && lastMsg.type === 'tool_request')) return // should never happen

		const callThisToolFirst: ToolMessage<ToolName> = lastMsg

		this._wrapRunAgentToNotify(
			this._runChatAgent({ callThisToolFirst, threadId, ...this._currentModelSelectionProps() })
			, threadId
		)
	}
	rejectLatestToolRequest(threadId: string) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return // should never happen

		const lastMsg = thread.messages[thread.messages.length - 1]

		let params: ToolCallParams<ToolName>
		if (lastMsg.role === 'tool' && lastMsg.type !== 'invalid_params') {
			params = lastMsg.params
		}
		else return

		const { name, id, rawParams, mcpServerName } = lastMsg

		const errorMessage = this.toolErrMsgs.rejected
		this._updateLatestTool(threadId, { role: 'tool', type: 'rejected', params: params, name: name, content: errorMessage, result: null, id, rawParams, mcpServerName })
		this._setStreamState(threadId, undefined)
	}

	respondToAskUser(threadId: string, userResponse: string) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		// The ask_user tool is waiting for user input — resolve it so the agent loop continues
		this._toolsService.respondToAskUser(userResponse)
	}

	private _computeMCPServerOfToolName = (toolName: string) => {
		return this._mcpService.getMCPTools()?.find(t => t.name === toolName)?.mcpServerName
	}

	async abortRunning(threadId: string) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return // should never happen

		// add assistant message
		if (this.streamState[threadId]?.isRunning === 'LLM') {
			const { displayContentSoFar, reasoningSoFar, toolCallSoFar } = this.streamState[threadId].llmInfo
			this._addMessageToThread(threadId, { role: 'assistant', displayContent: displayContentSoFar, reasoning: reasoningSoFar, anthropicReasoning: null })
			if (toolCallSoFar) this._addMessageToThread(threadId, { role: 'interrupted_streaming_tool', name: toolCallSoFar.name, mcpServerName: this._computeMCPServerOfToolName(toolCallSoFar.name) })
		}
		// add tool that's running
		else if (this.streamState[threadId]?.isRunning === 'tool') {
			const { toolName, toolParams, id, content: content_, rawParams, mcpServerName } = this.streamState[threadId].toolInfo
			const content = content_ || this.toolErrMsgs.interrupted
			this._updateLatestTool(threadId, { role: 'tool', name: toolName, params: toolParams, id, content, rawParams, type: 'rejected', result: null, mcpServerName })
		}
		// reject the tool for the user if relevant
		else if (this.streamState[threadId]?.isRunning === 'awaiting_user') {
			this.rejectLatestToolRequest(threadId)
		}
		else if (this.streamState[threadId]?.isRunning === 'idle') {
			// do nothing
		}

		this._addUserCheckpoint({ threadId })

		// interrupt any effects
		const interrupt = await this.streamState[threadId]?.interrupt
		if (typeof interrupt === 'function')
			interrupt()


		this._setStreamState(threadId, undefined)
	}



	private readonly toolErrMsgs = {
		rejected: 'Tool call was rejected by the user.',
		interrupted: 'Tool call was interrupted by the user.',
		errWhenStringifying: (error: any) => `Tool call succeeded, but there was an error stringifying the output.\n${getErrorMessage(error)}`
	}


	// private readonly _currentlyRunningToolInterruptor: { [threadId: string]: (() => void) | undefined } = {}


	// returns true when the tool call is waiting for user approval
	private _runToolCall = async (
		threadId: string,
		toolName: ToolName,
		toolId: string,
		mcpServerName: string | undefined,
		opts: { preapproved: true, unvalidatedToolParams: RawToolParamsObj, validatedParams: ToolCallParams<ToolName> } | { preapproved: false, unvalidatedToolParams: RawToolParamsObj },
	): Promise<{ awaitingUserApproval?: boolean, interrupted?: boolean }> => {

		// compute these below
		let toolParams: ToolCallParams<ToolName>
		let toolResult: ToolResult<ToolName>
		let toolResultStr: string

		// Check if it's a built-in tool
		const isBuiltInTool = isABuiltinToolName(toolName)


		if (!opts.preapproved) { // skip this if pre-approved
			// 1. validate tool params
			try {
				if (isBuiltInTool) {
					const params = this._toolsService.validateParams[toolName](opts.unvalidatedToolParams)
					toolParams = params
				}
				else {
					toolParams = opts.unvalidatedToolParams
				}
			}
			catch (error) {
				const errorMessage = getErrorMessage(error)
				this._addMessageToThread(threadId, { role: 'tool', type: 'invalid_params', rawParams: opts.unvalidatedToolParams, result: null, name: toolName, content: errorMessage, id: toolId, mcpServerName })
				return {}
			}
			// once validated, add checkpoint for edit
			if (toolName === 'edit_file') { this._addToolEditCheckpoint({ threadId, uri: (toolParams as BuiltinToolCallParams['edit_file']).uri }) }
			if (toolName === 'rewrite_file') { this._addToolEditCheckpoint({ threadId, uri: (toolParams as BuiltinToolCallParams['rewrite_file']).uri }) }

			// 2. if tool requires approval, use tiered risk assessment

			const approvalType = isBuiltInTool ? approvalTypeOfBuiltinToolName[toolName] : 'MCP tools'
			if (approvalType) {
				const autoApprove = this._settingsService.state.globalSettings.autoApprove[approvalType]

				// Tiered risk assessment: safe tools auto-approve, moderate follow settings, dangerous always ask
				let needsApproval = !autoApprove
				if (isBuiltInTool) {
					const riskLevel = assessToolRisk(toolName, opts.unvalidatedToolParams)
					if (riskLevel === 'safe') {
						needsApproval = false // Always auto-approve safe (read-only) tools
					} else if (riskLevel === 'dangerous') {
						needsApproval = true // Always require approval for dangerous tools
					}
					// 'moderate' follows the existing autoApprove setting
				}

				// add a tool_request because we use it for UI if a tool is loading
				this._addMessageToThread(threadId, { role: 'tool', type: 'tool_request', content: needsApproval ? '(Awaiting user permission...)' : '(Auto-approved)', result: null, name: toolName, params: toolParams, id: toolId, rawParams: opts.unvalidatedToolParams, mcpServerName })
				if (needsApproval) {
					return { awaitingUserApproval: true }
				}
			}
		}
		else {
			toolParams = opts.validatedParams
		}






		// 3. call the tool
		// this._setStreamState(threadId, { isRunning: 'tool' }, 'merge')
		const runningTool = { role: 'tool', type: 'running_now', name: toolName, params: toolParams, content: '(value not received yet...)', result: null, id: toolId, rawParams: opts.unvalidatedToolParams, mcpServerName } as const
		this._updateLatestTool(threadId, runningTool)


		let interrupted = false
		let resolveInterruptor: (r: () => void) => void = () => { }
		const interruptorPromise = new Promise<() => void>(res => { resolveInterruptor = res })
		try {

			// set stream state
			this._setStreamState(threadId, { isRunning: 'tool', interrupt: interruptorPromise, toolInfo: { toolName, toolParams, id: toolId, content: 'interrupted...', rawParams: opts.unvalidatedToolParams, mcpServerName } })

			if (isBuiltInTool) {
				const { result, interruptTool } = await this._toolsService.callTool[toolName](toolParams as any)
				const interruptor = () => { interrupted = true; interruptTool?.() }
				resolveInterruptor(interruptor)

				toolResult = await result
			}
			else {
				const mcpTools = this._mcpService.getMCPTools()
				const mcpTool = mcpTools?.find(t => t.name === toolName)
				if (!mcpTool) { throw new Error(`MCP tool ${toolName} not found`) }

				resolveInterruptor(() => { })

				toolResult = (await this._mcpService.callMCPTool({
					serverName: mcpTool.mcpServerName ?? 'unknown_mcp_server',
					toolName: toolName,
					params: toolParams
				})).result
			}

			if (interrupted) { return { interrupted: true } } // the tool result is added where we interrupt, not here
		}
		catch (error) {
			resolveInterruptor(() => { }) // resolve for the sake of it
			if (interrupted) { return { interrupted: true } } // the tool result is added where we interrupt, not here

			const errorMessage = getErrorMessage(error)
			this._updateLatestTool(threadId, { role: 'tool', type: 'tool_error', params: toolParams, result: errorMessage, name: toolName, content: errorMessage, id: toolId, rawParams: opts.unvalidatedToolParams, mcpServerName })
			return {}
		}

		// 4. stringify the result to give to the LLM
		try {
			if (isBuiltInTool) {
				toolResultStr = this._toolsService.stringOfResult[toolName](toolParams as any, toolResult as any)
			}
			// For MCP tools, handle the result based on its type
			else {
				toolResultStr = this._mcpService.stringifyResult(toolResult as RawMCPToolCall)
			}
		} catch (error) {
			const errorMessage = this.toolErrMsgs.errWhenStringifying(error)
			this._updateLatestTool(threadId, { role: 'tool', type: 'tool_error', params: toolParams, result: errorMessage, name: toolName, content: errorMessage, id: toolId, rawParams: opts.unvalidatedToolParams, mcpServerName })
			return {}
		}

		// 5. add to history and keep going
		this._updateLatestTool(threadId, { role: 'tool', type: 'success', params: toolParams, result: toolResult, name: toolName, content: toolResultStr, id: toolId, rawParams: opts.unvalidatedToolParams, mcpServerName })
		return {}
	};




	private async _runChatAgent({
		threadId,
		modelSelection,
		modelSelectionOptions,
		callThisToolFirst,
		webSearchEnabled,
		chatModeOverride,
	}: {
		threadId: string,
		modelSelection: ModelSelection | null,
		modelSelectionOptions: ModelSelectionOptions | undefined,

		callThisToolFirst?: ToolMessage<ToolName> & { type: 'tool_request' },
		webSearchEnabled?: boolean,
		chatModeOverride?: ChatMode,
	}) {


		let interruptedWhenIdle = false
		const idleInterruptor = Promise.resolve(() => { interruptedWhenIdle = true })
		// _runToolCall does not need setStreamState({idle}) before it, but it needs it after it. (handles its own setStreamState)

		// above just defines helpers, below starts the actual function
		const chatMode = chatModeOverride ?? this._settingsService.state.globalSettings.chatMode // should not change as we loop even if user changes it, so it goes here
		const { overridesOfModel } = this._settingsService.state

		// Phase 7: Model Router — auto-select model based on conversation complexity
		const messagesForRouter = this.state.allThreads[threadId]?.messages ?? []
		modelSelection = this._modelRouterService.selectModel(messagesForRouter, modelSelection)

		// Phase 1: Agent Loop Hardening
		const maxIterations = this._settingsService.state.globalSettings.maxAgentIterations ?? 50
		const lintRetryLimit = this._settingsService.state.globalSettings.lintRetryLimit ?? 3

		// Phase 1.2: Error Recovery - track lint retries per file and tool call repetitions
		const lintRetryCountByFile = new Map<string, number>()
		const recentToolCalls: { name: string; paramsHash: string; resultCategory: string | null; timestamp: number }[] = []
		const MAX_RECENT_TOOL_CALLS = 10
		const REPEAT_THRESHOLD = 3

		let nMessagesSent = 0
		let shouldSendAnotherMessage = true
		let isRunningWhenEnd: IsRunningType = undefined
		// Emit loop start event
		this._agentEventService.emitSimple('loop_start', threadId, 0, maxIterations)

		// before enter loop, call tool
		if (callThisToolFirst) {
			const { interrupted } = await this._runToolCall(threadId, callThisToolFirst.name, callThisToolFirst.id, callThisToolFirst.mcpServerName, { preapproved: true, unvalidatedToolParams: callThisToolFirst.rawParams, validatedParams: callThisToolFirst.params })
			if (interrupted) {
				this._setStreamState(threadId, undefined)
				this._addUserCheckpoint({ threadId })

			}
		}
		this._setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' })  // just decorative, for clarity


		// tool use loop — Phase 1.1: enforce max iteration limit
		while (shouldSendAnotherMessage && nMessagesSent < maxIterations) {
			// false by default each iteration
			shouldSendAnotherMessage = false
			isRunningWhenEnd = undefined
			nMessagesSent += 1

			this._setStreamState(threadId, { isRunning: 'idle', interrupt: idleInterruptor })

			let chatMessages = this.state.allThreads[threadId]?.messages ?? []

			let currentModelSelection = modelSelection

			const { messages, separateSystemMessage } = await this._convertToLLMMessagesService.prepareLLMChatMessages({
				chatMessages,
				modelSelection: currentModelSelection,
				chatMode,
				webSearchEnabled,
			})

			if (interruptedWhenIdle) {
				this._setStreamState(threadId, undefined)
				return
			}

			let shouldRetryLLM = true
			let nAttempts = 0
			const triedModels = new Set<string>()
			if (modelSelection) triedModels.add(this._modelRouterService.modelKey(modelSelection))
			while (shouldRetryLLM) {
				shouldRetryLLM = false
				nAttempts += 1

				type ResTypes =
					| { type: 'llmDone', toolCall?: RawToolCallObj, info: { fullText: string, fullReasoning: string, anthropicReasoning: AnthropicReasoning[] | null } }
					| { type: 'llmError', error?: { message: string; fullError: Error | null; } }
					| { type: 'llmAborted' }

				let resMessageIsDonePromise: (res: ResTypes) => void // resolves when user approves this tool use (or if tool doesn't require approval)
				const messageIsDonePromise = new Promise<ResTypes>((res, rej) => { resMessageIsDonePromise = res })

				// Global proxy config is automatically injected by ILLMMessageService

				const llmStartTime = Date.now()
				const llmCancelToken = this._llmMessageService.sendLLMMessage({
					messagesType: 'chatMessages',
					chatMode,
					messages: messages,
					modelSelection: currentModelSelection,
					modelSelectionOptions,
					overridesOfModel,
					logging: { loggingName: `Chat - ${chatMode}`, loggingExtras: { threadId, nMessagesSent, chatMode } },
					separateSystemMessage: separateSystemMessage,
					onText: ({ fullText, fullReasoning, toolCall }) => {
						this._setStreamState(threadId, { isRunning: 'LLM', llmInfo: { displayContentSoFar: fullText, reasoningSoFar: fullReasoning, toolCallSoFar: toolCall ?? null }, interrupt: Promise.resolve(() => { if (llmCancelToken) this._llmMessageService.abort(llmCancelToken) }) })
					},
					onFinalMessage: async ({ fullText, fullReasoning, toolCall, anthropicReasoning, }) => {
						resMessageIsDonePromise({ type: 'llmDone', toolCall, info: { fullText, fullReasoning, anthropicReasoning } }) // resolve with tool calls
					},
					onError: async (error) => {
						resMessageIsDonePromise({ type: 'llmError', error: error })
					},
					onAbort: () => {
						// stop the loop to free up the promise, but don't modify state (already handled by whatever stopped it)
						resMessageIsDonePromise({ type: 'llmAborted' })
						this._metricsService.capture('Agent Loop Done (Aborted)', { nMessagesSent, chatMode })
					},
				})

				// mark as streaming
				if (!llmCancelToken) {
					this._setStreamState(threadId, { isRunning: undefined, error: { message: 'There was an unexpected error when sending your chat message.', fullError: null } })
					break
				}

				this._setStreamState(threadId, { isRunning: 'LLM', llmInfo: { displayContentSoFar: '', reasoningSoFar: '', toolCallSoFar: null }, interrupt: Promise.resolve(() => this._llmMessageService.abort(llmCancelToken)) })
				const llmRes = await messageIsDonePromise // wait for message to complete

				// if something else started running in the meantime
				if (this.streamState[threadId]?.isRunning !== 'LLM') {
					// console.log('Chat thread interrupted by a newer chat thread', this.streamState[threadId]?.isRunning)
					return
				}

				// llm res aborted
				if (llmRes.type === 'llmAborted') {
					this._setStreamState(threadId, undefined)
					return
				}
				// llm res error
				else if (llmRes.type === 'llmError') {
					// Record error latency
					if (currentModelSelection) {
						this._modelRouterService.recordLatency(currentModelSelection, Date.now() - llmStartTime, false)
					}

					// Try fallback model first
					if (currentModelSelection) {
						const fallback = this._modelRouterService.getNextFallback(currentModelSelection, triedModels)
						if (fallback) {
							currentModelSelection = fallback
							shouldRetryLLM = true
							nAttempts = 0 // reset attempts for new model
							this._setStreamState(threadId, { isRunning: 'idle', interrupt: idleInterruptor })
							await timeout(500) // brief pause before fallback
							if (interruptedWhenIdle) {
								this._setStreamState(threadId, undefined)
								return
							}
							continue // retry with fallback model
						}
					}

					// No fallback available, retry same model
					if (nAttempts < CHAT_RETRIES) {
						shouldRetryLLM = true
						this._setStreamState(threadId, { isRunning: 'idle', interrupt: idleInterruptor })
						await timeout(RETRY_DELAY)
						if (interruptedWhenIdle) {
							this._setStreamState(threadId, undefined)
							return
						}
						else
							continue // retry
					}
					// error, but too many attempts
					else {
						const { error } = llmRes
						const { displayContentSoFar, reasoningSoFar, toolCallSoFar } = this.streamState[threadId].llmInfo
						this._addMessageToThread(threadId, { role: 'assistant', displayContent: displayContentSoFar, reasoning: reasoningSoFar, anthropicReasoning: null })
						if (toolCallSoFar) this._addMessageToThread(threadId, { role: 'interrupted_streaming_tool', name: toolCallSoFar.name, mcpServerName: this._computeMCPServerOfToolName(toolCallSoFar.name) })

						this._setStreamState(threadId, { isRunning: undefined, error })
						this._addUserCheckpoint({ threadId })
						return
					}
				}

				// llm res success — record latency and cost
				if (currentModelSelection) {
					this._modelRouterService.recordLatency(currentModelSelection, Date.now() - llmStartTime, true)
				}
				const { toolCall, info } = llmRes

				this._addMessageToThread(threadId, { role: 'assistant', displayContent: info.fullText, reasoning: info.fullReasoning, anthropicReasoning: info.anthropicReasoning })

				// Live progress: if this is a plan execution (chatModeOverride used), parse COMPLETED TASK N markers
				if (chatModeOverride === 'build' && info.fullText) {
					this._updatePlanProgressFromResponse(threadId, info.fullText)
				}

				// In plan mode, if there's no tool call, parse the response for plan items
				if (chatMode === 'plan' && !toolCall && info.fullText) {
					const planItems = this._parsePlanItems(info.fullText)
					if (planItems.length > 0) {
						this._addMessageToThread(threadId, {
							role: 'plan',
							content: info.fullText,
							displayContent: info.fullText,
							items: planItems,
							status: 'draft',
						})

						// Generate .md plan file and open it in the editor
						const thread = this.state.allThreads[threadId]
						if (thread) {
							const planMessageIdx = thread.messages.length - 1
							this._generatePlanFile(threadId, planMessageIdx, planItems, info.fullText)
						}
					}
				}

				this._setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' }) // just decorative for clarity

				// call tool if there is one
				if (toolCall) {
					// Phase 1.2: Infinite loop detection - track recent tool calls
					const paramsHash = JSON.stringify(toolCall.rawParams)
					recentToolCalls.push({ name: toolCall.name, paramsHash, resultCategory: null, timestamp: Date.now() })
					if (recentToolCalls.length > MAX_RECENT_TOOL_CALLS) recentToolCalls.shift()

					// Check for repeated identical tool calls
					if (recentToolCalls.length >= REPEAT_THRESHOLD) {
						const last = recentToolCalls[recentToolCalls.length - 1]
						const repeatCount = recentToolCalls.filter(tc => tc.name === last.name && tc.paramsHash === last.paramsHash).length
						if (repeatCount >= REPEAT_THRESHOLD) {
							this._agentEventService.emitSimple('error_recovery', threadId, nMessagesSent, maxIterations, { reason: 'infinite_loop_detected', toolName: toolCall.name })
							this._addMessageToThread(threadId, {
								role: 'user',
								content: 'You are repeating the same action. Please try a different approach or ask the user for guidance.',
								displayContent: '[System: Infinite loop detected - agent prompted to change approach]',
								selections: [],
								state: { stagingSelections: [], isBeingEdited: false },
							})
							shouldSendAnotherMessage = true
							this._setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' })
							continue // skip tool call, send the injection message instead
						}
					}

					// Phase 1.2: Lint retry cap - track read_lint_errors per file
					if (toolCall.name === 'read_lint_errors' && (toolCall.rawParams?.uri || toolCall.rawParams?.uris)) {
						const filePath = String(toolCall.rawParams.uris ?? toolCall.rawParams.uri)
						const count = (lintRetryCountByFile.get(filePath) ?? 0) + 1
						lintRetryCountByFile.set(filePath, count)
						if (count > lintRetryLimit) {
							this._agentEventService.emitSimple('error_recovery', threadId, nMessagesSent, maxIterations, { reason: 'lint_retry_limit', file: filePath })
							this._addMessageToThread(threadId, {
								role: 'user',
								content: `Lint retry limit reached for ${filePath}. Moving on to other tasks.`,
								displayContent: `[System: Lint retry limit reached for ${filePath}]`,
								selections: [],
								state: { stagingSelections: [], isBeingEdited: false },
							})
							shouldSendAnotherMessage = true
							this._setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' })
							continue // skip tool call
						}
					}

					// Emit tool start event
					this._agentEventService.emitSimple('tool_start', threadId, nMessagesSent, maxIterations, { toolName: toolCall.name })

					const mcpTools = this._mcpService.getMCPTools()
					const mcpTool = mcpTools?.find(t => t.name === toolCall.name)

					const { awaitingUserApproval, interrupted } = await this._runToolCall(threadId, toolCall.name, toolCall.id, mcpTool?.mcpServerName, { preapproved: false, unvalidatedToolParams: toolCall.rawParams })

					// Emit tool end event
					this._agentEventService.emitSimple('tool_end', threadId, nMessagesSent, maxIterations, { toolName: toolCall.name })

					if (interrupted) {
						this._setStreamState(threadId, undefined)
						return
					}
					if (awaitingUserApproval) { isRunningWhenEnd = 'awaiting_user' }
					else {
						shouldSendAnotherMessage = true

						// Self-healing: enrich terminal error results with file context
						const selfHealingConfig = this._settingsService.state.globalSettings.selfHealingConfig
						if (toolCall.name === 'run_command' || toolCall.name === 'run_persistent_command') {
							const thread = this.state.allThreads[threadId]
							const lastMsg = thread?.messages.at(-1)
							if (lastMsg && lastMsg.role === 'tool' && lastMsg.type === 'success' && lastMsg.result) {
								const toolResult = lastMsg.result as BuiltinToolResultType['run_command']
								const classification = toolResult.errorClassification

								// Update the tool call record with error category
								const lastRecord = recentToolCalls[recentToolCalls.length - 1]
								if (lastRecord && classification?.primaryCategory) {
									lastRecord.resultCategory = classification.primaryCategory
								}

								if (classification?.hasErrors && selfHealingConfig.enabled && selfHealingConfig.autoReadErrorContext) {
									try {
										const fileContext = await this._selfHealingService.buildErrorContext(classification.errors)
										if (fileContext) {
											const healingPrompt = this._selfHealingService.generateHealingPrompt(classification, fileContext, 0)
											lastMsg.content = lastMsg.content + '\n\n' + healingPrompt
											this._agentEventService.emitSimple('self_healing_context_injected', threadId, nMessagesSent, maxIterations, { category: classification.primaryCategory })
										}
									} catch {
										// Silently fail — don't break the agent loop
									}
								}

								// Circuit breaker: same error category 3+ times in recent calls
								if (classification?.primaryCategory && classification.primaryCategory !== 'unknown') {
									const sameCount = recentToolCalls.slice(-5)
										.filter(tc => tc.resultCategory === classification.primaryCategory).length
									if (sameCount >= 3) {
										this._agentEventService.emitSimple('circuit_breaker_tripped', threadId, nMessagesSent, maxIterations,
											{ category: classification.primaryCategory })
										this._addMessageToThread(threadId, {
											role: 'user',
											content: `You have encountered the same type of error (${classification.primaryCategory}) 3 times. Stop attempting to fix it automatically and explain the issue to the user.`,
											displayContent: `[System: Circuit breaker - repeated ${classification.primaryCategory} errors]`,
											selections: [],
											state: { stagingSelections: [], isBeingEdited: false },
										})
										shouldSendAnotherMessage = true
										this._setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' })
										continue
									}
								}
							}
						}

						// Oscillation detection (A-B-A-B pattern)
						if (recentToolCalls.length >= 4) {
							const last4 = recentToolCalls.slice(-4)
							const isOscillating = (
								last4[0].name === last4[2].name && last4[0].paramsHash === last4[2].paramsHash &&
								last4[1].name === last4[3].name && last4[1].paramsHash === last4[3].paramsHash &&
								last4[0].name !== last4[1].name
							)
							if (isOscillating) {
								this._agentEventService.emitSimple('error_recovery', threadId, nMessagesSent, maxIterations,
									{ reason: 'oscillation_detected' })
								this._addMessageToThread(threadId, {
									role: 'user',
									content: 'You are stuck in an edit-test oscillation loop. The same errors keep recurring. Step back, re-read the relevant files, and try a fundamentally different approach. If stuck, ask the user.',
									displayContent: '[System: Edit-test oscillation detected]',
									selections: [],
									state: { stagingSelections: [], isBeingEdited: false },
								})
								shouldSendAnotherMessage = true
								this._setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' })
								continue
							}
						}
					}

					this._setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' }) // just decorative, for clarity
				}

				// Emit iteration event
				this._agentEventService.emitSimple('loop_iteration', threadId, nMessagesSent, maxIterations)

			} // end while (attempts)
		} // end while (send message)

		// Phase 1.1: If we hit the iteration limit, inject a message and stop
		if (nMessagesSent >= maxIterations && shouldSendAnotherMessage) {
			this._agentEventService.emitSimple('iteration_limit', threadId, nMessagesSent, maxIterations)
			this._addMessageToThread(threadId, {
				role: 'user',
				content: `Agent iteration limit reached (${maxIterations} iterations). Stopping the agent loop. You can continue by sending another message.`,
				displayContent: `[System: Agent reached iteration limit of ${maxIterations}]`,
				selections: [],
				state: { stagingSelections: [], isBeingEdited: false },
			})
			isRunningWhenEnd = undefined
		}

		// Cascade Mode: Auto-verify after agent completes work
		const { cascadeMode } = this._settingsService.state.globalSettings
		if (cascadeMode && (chatMode === 'auto' || chatMode === 'build') && !isRunningWhenEnd && nMessagesSent >= 2) {
			try {
				const workspaceFolders = this._workspaceContextService.getWorkspace().folders
				const cwd = workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : null
				const pipelineResult = await this._verificationPipelineService.runPipeline(cwd, null)

				if (pipelineResult.results.length > 0) {
					const resultSummary = pipelineResult.results.map(r =>
						`${r.passed ? 'PASS' : 'FAIL'}: ${r.step.name} (${r.durationMs}ms)${r.output ? `\n  ${r.output.substring(0, 200)}` : ''}`
					).join('\n')

					const statusEmoji = pipelineResult.allPassed ? 'All checks passed' : 'Some checks failed'

					this._addMessageToThread(threadId, {
						role: 'user',
						content: `[Cascade Verification]\n${statusEmoji}\n\n${resultSummary}`,
						displayContent: `[Verification: ${statusEmoji}]\n${resultSummary}`,
						selections: [],
						state: { stagingSelections: [], isBeingEdited: false },
					})

					// If verification failed, re-enter the agent loop to fix (up to 3 cascade retries)
					if (!pipelineResult.allPassed && pipelineResult.firstFailure) {
						const cascadeRetries = (this as any).__cascadeRetryCount ?? 0
						if (cascadeRetries < 3) {
							(this as any).__cascadeRetryCount = cascadeRetries + 1
							this._addMessageToThread(threadId, {
								role: 'user',
								content: `The verification pipeline detected failures (attempt ${cascadeRetries + 1}/3). Please analyze and fix the issues:\n\n${pipelineResult.firstFailure.output || 'Check failed: ' + pipelineResult.firstFailure.step.name}`,
								displayContent: `[Cascade: Auto-fixing verification failures (attempt ${cascadeRetries + 1}/3)]`,
								selections: [],
								state: { stagingSelections: [], isBeingEdited: false },
							})
							// Re-enter the agent loop to fix the failures
							await this._runChatAgent({ threadId, modelSelection, modelSelectionOptions, webSearchEnabled, chatModeOverride: chatMode })
							return // The recursive call handles the rest
						} else {
							// Max retries reached, stop and inform
							(this as any).__cascadeRetryCount = 0
							this._addMessageToThread(threadId, {
								role: 'user',
								content: `Cascade verification failed after 3 attempts. Manual intervention needed.\n\nLast failure: ${pipelineResult.firstFailure.output || pipelineResult.firstFailure.step.name}`,
								displayContent: '[Cascade: Max retries reached, stopping]',
								selections: [],
								state: { stagingSelections: [], isBeingEdited: false },
							})
						}
					} else if (pipelineResult.allPassed) {
						// Reset cascade retry count on success
						(this as any).__cascadeRetryCount = 0
					}
				}
			} catch {
				// Silently fail — verification is optional enhancement
			}
		}

		// if awaiting user approval, keep isRunning true, else end isRunning
		this._setStreamState(threadId, { isRunning: isRunningWhenEnd })

		// add checkpoint before the next user message
		if (!isRunningWhenEnd) this._addUserCheckpoint({ threadId })

		// Emit loop end event
		this._agentEventService.emitSimple('loop_end', threadId, nMessagesSent, maxIterations)

		// capture number of messages sent
		this._metricsService.capture('Agent Loop Done', { nMessagesSent, chatMode, hitIterationLimit: nMessagesSent >= maxIterations })

		// Phase 8: Memory extraction — after agent loop, extract memories from conversation
		const memoryConfig = this._settingsService.state.globalSettings.memoryConfig
		if (memoryConfig.enabled && memoryConfig.autoExtract && nMessagesSent >= 3 && !isRunningWhenEnd) {
			this._extractMemoriesFromThread(threadId).catch(() => { /* silently fail */ })
		}
	}

	/**
	 * Phase 8: Extract memories from a completed agent conversation.
	 * Sends a summarization request to the LLM to extract key facts, decisions, and patterns.
	 */
	private async _extractMemoriesFromThread(threadId: string): Promise<void> {
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		// Build a conversation summary from user and assistant messages
		const threadMessages = thread.messages
		const summaryParts: string[] = []
		for (const msg of threadMessages) {
			if (msg.role === 'user' && msg.displayContent) {
				summaryParts.push(`User: ${msg.displayContent}`)
			} else if (msg.role === 'assistant' && msg.displayContent) {
				if (msg.displayContent.length > 0) {
					summaryParts.push(`Assistant: ${msg.displayContent.substring(0, 500)}`)
				}
			}
		}
		if (summaryParts.length < 2) return

		const conversationSummary = summaryParts.join('\n')

		// Use sendLLMMessage to extract memories
		const modelSelection = this._currentModelSelectionProps().modelSelection
		if (!modelSelection) return

		const extractionPrompt = `Analyze this conversation and extract key information worth remembering for future sessions. Return a JSON array of objects with: type ("project_fact" | "decision" | "pattern" | "preference"), content (concise description), context (brief context), tags (array of keywords). Only include truly important and reusable information. Return 0-5 items. If nothing is worth remembering, return an empty array [].

Conversation:
${conversationSummary.substring(0, 3000)}

Return ONLY the JSON array, no other text.`

		// Prepare messages via the convert service
		const { messages: llmMessages, separateSystemMessage } = this._convertToLLMMessagesService.prepareLLMSimpleMessages({
			simpleMessages: [{ role: 'user', content: extractionPrompt }],
			systemMessage: 'You are a memory extraction assistant. Extract key facts from conversations as JSON.',
			modelSelection,
			featureName: 'Chat',
		})

		return new Promise<void>((resolve) => {
			let fullResponse = ''
			this._llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				messages: llmMessages,
				separateSystemMessage,
				chatMode: null,
				logging: { loggingName: 'memoryExtraction' },
				modelSelection,
				modelSelectionOptions: undefined,
				overridesOfModel: this._settingsService.state.overridesOfModel,
				onText: ({ fullText }) => { fullResponse = fullText },
				onFinalMessage: () => {
					this._memoryService.extractAndStoreFromSummary(fullResponse).then(() => resolve()).catch(() => resolve())
				},
				onError: () => { resolve() },
				onAbort: () => { resolve() },
			})
		})
	}

	private _parsePlanItems(text: string): PlanItem[] {
		const items: PlanItem[] = []
		const lines = text.split('\n')
		for (const line of lines) {
			const uncheckedMatch = line.match(/^\s*-\s*\[\s*\]\s*(.+)/)
			const checkedMatch = line.match(/^\s*-\s*\[\s*[xX]\s*\]\s*(.+)/)
			const rawText = checkedMatch?.[1]?.trim() ?? uncheckedMatch?.[1]?.trim()
			if (!rawText) continue

			const completed = !!checkedMatch

			// Parse size label: **[S]**, [S], **[M]**, [M], **[L]**, [L]
			let size: PlanItem['size']
			let itemText = rawText
			const sizeMatch = itemText.match(/^(?:\*\*)?(\[([SML])\])(?:\*\*)?\s*/)
			if (sizeMatch) {
				size = sizeMatch[2] as 'S' | 'M' | 'L'
				itemText = itemText.slice(sizeMatch[0].length)
			}

			// Extract file paths from backtick-wrapped strings containing a dot extension
			const fileMatches = itemText.match(/`([^`]+\.[a-zA-Z0-9]+)`/g)
			const files = fileMatches?.map(m => m.slice(1, -1)) ?? []

			items.push({
				id: generateUuid(),
				text: itemText,
				completed,
				status: completed ? 'complete' : 'pending',
				files: files.length > 0 ? files : undefined,
				size,
			})
		}
		return items
	}

	private _updatePlanProgressFromResponse(threadId: string, responseText: string) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		// Find the executing plan message
		const planIdx = thread.messages.findIndex(m => m.role === 'plan' && m.status === 'executing')
		if (planIdx === -1) return

		const planMessage = thread.messages[planIdx]
		if (planMessage.role !== 'plan') return

		// Parse COMPLETED TASK N markers
		const completedMatches = responseText.matchAll(/COMPLETED TASK (\d+)/gi)
		let updated = false
		const items = [...planMessage.items]

		for (const match of completedMatches) {
			const taskNum = parseInt(match[1], 10) - 1 // 0-indexed
			if (taskNum >= 0 && taskNum < items.length && items[taskNum].status !== 'complete') {
				items[taskNum] = { ...items[taskNum], completed: true, status: 'complete' }
				updated = true
			}
		}

		if (updated) {
			this._editMessageInThread(threadId, planIdx, { ...planMessage, items })
			this._updatePlanFileCheckboxes(threadId, planIdx, items)
		}
	}

	getPlanFileMapping(uri: URI): { threadId: string; planMessageIdx: number } | undefined {
		return this._planFileMappings.get(uri.toString())
	}

	private async _generatePlanFile(threadId: string, planMessageIdx: number, planItems: PlanItem[], fullText: string) {
		const folders = this._workspaceContextService.getWorkspace().folders
		if (folders.length === 0) return

		const rootUri = folders[0].uri
		const plansDir = URI.joinPath(rootUri, '.void', 'plans')

		// Ensure .void/plans directory exists
		try { await this._fileService.createFolder(plansDir) }
		catch { /* already exists */ }

		// Build markdown content with frontmatter
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
		const fileName = `${timestamp}-plan.md`
		const planFileUri = URI.joinPath(plansDir, fileName)

		const taskLines = planItems.map(item => {
			const check = item.completed ? '[x]' : '[ ]'
			const sizeLabel = item.size ? `**[${item.size}]** ` : ''
			const fileRefs = item.files?.map(f => `\`${f}\``).join(', ') || ''
			const fileSuffix = fileRefs ? ` (${fileRefs})` : ''
			return `- ${check} ${sizeLabel}${item.text}${fileSuffix}`
		}).join('\n')

		const mdContent = [
			'---',
			`threadId: ${threadId}`,
			`planMessageIdx: ${planMessageIdx}`,
			`status: draft`,
			'---',
			'',
			'# Plan',
			'',
			'## Tasks',
			taskLines,
			'',
			'## Details',
			fullText,
			'',
		].join('\n')

		try {
			await this._fileService.writeFile(planFileUri, VSBuffer.fromString(mdContent))

			// Track the mapping
			this._planFileMappings.set(planFileUri.toString(), { threadId, planMessageIdx })

			// Open the file in the editor
			await this._editorService.openEditor({ resource: planFileUri })
		} catch (e) {
			console.error('Failed to generate plan file:', e)
		}
	}

	private async _updatePlanFileStatus(threadId: string, planMessageIdx: number, status: string) {
		for (const [uriStr, mapping] of this._planFileMappings) {
			if (mapping.threadId === threadId && mapping.planMessageIdx === planMessageIdx) {
				const uri = URI.parse(uriStr)
				try {
					const content = (await this._fileService.readFile(uri)).value.toString()
					const updated = content.replace(/^status: .+$/m, `status: ${status}`)
					await this._fileService.writeFile(uri, VSBuffer.fromString(updated))
				} catch { /* file may have been deleted */ }
				break
			}
		}
	}

	private async _updatePlanFileCheckboxes(threadId: string, planIdx: number, items: PlanItem[]) {
		for (const [uriStr, mapping] of this._planFileMappings) {
			if (mapping.threadId === threadId && mapping.planMessageIdx === planIdx) {
				const uri = URI.parse(uriStr)
				try {
					const content = (await this._fileService.readFile(uri)).value.toString()
					const lines = content.split('\n')
					let taskLineIdx = 0
					for (let i = 0; i < lines.length; i++) {
						if (lines[i].match(/^\s*-\s*\[[ xX]\]/)) {
							if (taskLineIdx < items.length && items[taskLineIdx].completed) {
								lines[i] = lines[i].replace(/\[\s*\]/, '[x]')
							}
							taskLineIdx++
						}
					}
					await this._fileService.writeFile(uri, VSBuffer.fromString(lines.join('\n')))
				} catch { /* file may have been deleted */ }
				break
			}
		}
	}

	executePlan(threadId: string, planMessageIdx: number) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		const planMessage = thread.messages[planMessageIdx]
		if (!planMessage || planMessage.role !== 'plan') return
		if (planMessage.status !== 'draft') return

		// Update plan status to executing
		this._editMessageInThread(threadId, planMessageIdx, {
			...planMessage,
			status: 'executing',
			items: planMessage.items.map(item => ({ ...item, status: 'pending' as const })),
		})
		this._updatePlanFileStatus(threadId, planMessageIdx, 'executing')

		// Compose numbered task list for the LLM
		const taskList = planMessage.items.map((item, i) =>
			`${i + 1}. ${item.text}`
		).join('\n')

		const planInstruction = `Execute the following implementation plan. Complete each task in order. After completing each task, output "COMPLETED TASK N" (where N is the task number) before moving to the next.\n\nTasks:\n${taskList}`

		// Add checkpoint before execution
		this._addUserCheckpoint({ threadId })

		// Add synthetic user message
		const userHistoryElt: ChatMessage = {
			role: 'user',
			content: planInstruction,
			displayContent: 'Executing plan...',
			selections: null,
			state: defaultMessageState,
		}
		this._addMessageToThread(threadId, userHistoryElt)
		this._setThreadState(threadId, { currCheckpointIdx: null })

		// Run agent with chatModeOverride: 'build' so LLM gets full tool access
		const agentPromise = this._runChatAgent({
			threadId,
			...this._currentModelSelectionProps(),
			chatModeOverride: 'build',
		})

		this._wrapRunAgentToNotify(agentPromise, threadId)

		agentPromise.then(() => {
			// After execution, mark remaining incomplete items as completed
			const currentThread = this.state.allThreads[threadId]
			if (!currentThread) return
			const currentPlan = currentThread.messages[planMessageIdx]
			if (currentPlan && currentPlan.role === 'plan') {
				const completedItems = currentPlan.items.map(item => ({
					...item,
					completed: true,
					status: item.status === 'failed' ? 'failed' as const : 'complete' as const,
				}))
				this._editMessageInThread(threadId, planMessageIdx, {
					...currentPlan,
					status: 'completed',
					items: completedItems,
				})
				this._updatePlanFileStatus(threadId, planMessageIdx, 'completed')
				this._updatePlanFileCheckboxes(threadId, planMessageIdx, completedItems)
			}
		})

		// Scroll to bottom
		this.state.allThreads[threadId]?.state.mountedInfo?.whenMounted.then(m => {
			m.scrollToBottom()
		})
	}

	executePlanStepByStep(threadId: string, planMessageIdx: number) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		const planMessage = thread.messages[planMessageIdx]
		if (!planMessage || planMessage.role !== 'plan') return
		if (planMessage.status !== 'draft') return

		// Store execution state
		this._currentPlanExecution = { threadId, planMessageIdx, currentTaskIndex: 0 }

		// Update plan status to executing
		this._editMessageInThread(threadId, planMessageIdx, {
			...planMessage,
			status: 'executing',
			items: planMessage.items.map(item => ({ ...item, status: 'pending' as const })),
		})

		this._executeNextPlanStep(threadId)
	}

	continuePlanExecution(threadId: string) {
		if (!this._currentPlanExecution || this._currentPlanExecution.threadId !== threadId) return
		this._executeNextPlanStep(threadId)
	}

	private _currentPlanExecution: { threadId: string, planMessageIdx: number, currentTaskIndex: number } | null = null

	private _executeNextPlanStep(threadId: string) {
		if (!this._currentPlanExecution || this._currentPlanExecution.threadId !== threadId) return

		const { planMessageIdx, currentTaskIndex } = this._currentPlanExecution
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		const planMessage = thread.messages[planMessageIdx]
		if (!planMessage || planMessage.role !== 'plan') return

		// Find next uncompleted task
		let nextIdx = currentTaskIndex
		while (nextIdx < planMessage.items.length && (planMessage.items[nextIdx].status === 'complete' || planMessage.items[nextIdx].status === 'skipped')) {
			nextIdx++
		}

		if (nextIdx >= planMessage.items.length) {
			// All tasks done
			this._editMessageInThread(threadId, planMessageIdx, {
				...planMessage,
				status: 'completed',
				items: planMessage.items.map(item => ({
					...item,
					completed: true,
					status: item.status === 'failed' ? 'failed' as const : 'complete' as const,
				})),
			})
			this._currentPlanExecution = null
			return
		}

		const task = planMessage.items[nextIdx]

		// Mark current task as in_progress
		const updatedItems = [...planMessage.items]
		updatedItems[nextIdx] = { ...task, status: 'in_progress' }
		this._editMessageInThread(threadId, planMessageIdx, {
			...planMessage,
			items: updatedItems,
		})

		// Add checkpoint and synthetic user message
		this._addUserCheckpoint({ threadId })
		const instruction = `Execute ONLY the following task (task ${nextIdx + 1} of ${planMessage.items.length}):\n\n${task.text}\n\nDo not proceed to any other tasks. When done, output "COMPLETED TASK ${nextIdx + 1}".`
		const userHistoryElt: ChatMessage = {
			role: 'user',
			content: instruction,
			displayContent: `Step ${nextIdx + 1}: ${task.text}`,
			selections: null,
			state: defaultMessageState,
		}
		this._addMessageToThread(threadId, userHistoryElt)
		this._setThreadState(threadId, { currCheckpointIdx: null })

		// Update tracking index
		this._currentPlanExecution.currentTaskIndex = nextIdx + 1

		const agentPromise = this._runChatAgent({
			threadId,
			...this._currentModelSelectionProps(),
			chatModeOverride: 'build',
		})

		this._wrapRunAgentToNotify(agentPromise, threadId)

		agentPromise.then(() => {
			// Mark this step complete
			const currentThread = this.state.allThreads[threadId]
			if (!currentThread) return
			const currentPlan = currentThread.messages[planMessageIdx]
			if (currentPlan && currentPlan.role === 'plan') {
				const items = [...currentPlan.items]
				items[nextIdx] = { ...items[nextIdx], completed: true, status: 'complete' }
				this._editMessageInThread(threadId, planMessageIdx, { ...currentPlan, items })
			}

			// Check if more steps remain
			if (this._currentPlanExecution && this._currentPlanExecution.currentTaskIndex < planMessage.items.length) {
				// Pause - set stream state to awaiting_user so Continue button shows
				this._setStreamState(threadId, { isRunning: 'awaiting_user' })
			} else {
				// All done
				const ct = this.state.allThreads[threadId]
				if (!ct) return
				const finalPlan = ct.messages[planMessageIdx]
				if (finalPlan && finalPlan.role === 'plan') {
					this._editMessageInThread(threadId, planMessageIdx, {
						...finalPlan,
						status: 'completed',
					})
				}
				this._currentPlanExecution = null
			}
		})

		// Scroll to bottom
		this.state.allThreads[threadId]?.state.mountedInfo?.whenMounted.then(m => {
			m.scrollToBottom()
		})
	}


	private _addCheckpoint(threadId: string, checkpoint: CheckpointEntry) {
		this._addMessageToThread(threadId, checkpoint)
		// // update latest checkpoint idx to the one we just added
		// const newThread = this.state.allThreads[threadId]
		// if (!newThread) return // should never happen
		// const currCheckpointIdx = newThread.messages.length - 1
		// this._setThreadState(threadId, { currCheckpointIdx: currCheckpointIdx })
	}



	private _editMessageInThread(threadId: string, messageIdx: number, newMessage: ChatMessage,) {
		const { allThreads } = this.state
		const oldThread = allThreads[threadId]
		if (!oldThread) return // should never happen
		// update state and store it
		const newThreads = {
			...allThreads,
			[oldThread.id]: {
				...oldThread,
				lastModified: new Date().toISOString(),
				messages: [
					...oldThread.messages.slice(0, messageIdx),
					newMessage,
					...oldThread.messages.slice(messageIdx + 1, Infinity),
				],
			}
		}
		this._storeAllThreads(newThreads)
		this._setState({ allThreads: newThreads }) // the current thread just changed (it had a message added to it)
	}


	private _getCheckpointInfo = (checkpointMessage: ChatMessage & { role: 'checkpoint' }, fsPath: string, opts: { includeUserModifiedChanges: boolean }) => {
		const voidFileSnapshot = checkpointMessage.voidFileSnapshotOfURI ? checkpointMessage.voidFileSnapshotOfURI[fsPath] ?? null : null
		if (!opts.includeUserModifiedChanges) { return { voidFileSnapshot, } }

		const userModifiedvoidFileSnapshot = fsPath in checkpointMessage.userModifications.voidFileSnapshotOfURI ? checkpointMessage.userModifications.voidFileSnapshotOfURI[fsPath] ?? null : null
		return { voidFileSnapshot: userModifiedvoidFileSnapshot ?? voidFileSnapshot, }
	}

	private _computeNewCheckpointInfo({ threadId }: { threadId: string }) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		const lastCheckpointIdx = findLastIdx(thread.messages, (m) => m.role === 'checkpoint') ?? -1
		if (lastCheckpointIdx === -1) return

		const voidFileSnapshotOfURI: { [fsPath: string]: voidFileSnapshot | undefined } = {}

		// add a change for all the URIs in the checkpoint history
		const { lastIdxOfURI } = this._getCheckpointsBetween({ threadId, loIdx: 0, hiIdx: lastCheckpointIdx, }) ?? {}
		for (const fsPath in lastIdxOfURI ?? {}) {
			const { model } = this._voidModelService.getModelFromFsPath(fsPath)
			if (!model) continue
			const checkpoint2 = thread.messages[lastIdxOfURI[fsPath]] || null
			if (!checkpoint2) continue
			if (checkpoint2.role !== 'checkpoint') continue
			const res = this._getCheckpointInfo(checkpoint2, fsPath, { includeUserModifiedChanges: false })
			if (!res) continue
			const { voidFileSnapshot: oldvoidFileSnapshot } = res

			// if there was any change to the str or diffAreaSnapshot, update. rough approximation of equality, oldDiffAreasSnapshot === diffAreasSnapshot is not perfect
			const voidFileSnapshot = this._editCodeService.getvoidFileSnapshot(URI.file(fsPath))
			if (oldvoidFileSnapshot === voidFileSnapshot) continue
			voidFileSnapshotOfURI[fsPath] = voidFileSnapshot
		}

		// // add a change for all user-edited files (that aren't in the history)
		// for (const fsPath of this._userModifiedFilesToCheckInCheckpoints.keys()) {
		// 	if (fsPath in lastIdxOfURI) continue // if already visisted, don't visit again
		// 	const { model } = this._voidModelService.getModelFromFsPath(fsPath)
		// 	if (!model) continue
		// 	currStrOfFsPath[fsPath] = model.getValue(EndOfLinePreference.LF)
		// }

		return { voidFileSnapshotOfURI }
	}


	private async _populateBranchSelections(selections: StagingSelectionItem[]): Promise<StagingSelectionItem[]> {
		const hasBranch = selections.some(s => s.type === 'Branch')
		if (!hasBranch) return selections

		const workspaceFolders = this._workspaceContextService.getWorkspace().folders
		const cwd = workspaceFolders[0]?.uri.fsPath
		if (!cwd) return selections

		return Promise.all(selections.map(async (s) => {
			if (s.type !== 'Branch' || s.branchDiffContent) return s
			try {
				const branchCmd = await this._toolsService.callTool.run_command({
					command: 'git branch --show-current',
					cwd,
					terminalId: '__void_branch_context',
				})
				const branchResult = await branchCmd.result
				const branchName = branchResult.result.trim()

				const diffCmd = await this._toolsService.callTool.run_command({
					command: `git diff main...HEAD --stat && echo "---VOID_BRANCH_SEP---" && git diff main...HEAD`,
					cwd,
					terminalId: '__void_branch_diff',
				})
				const diffResult = await diffCmd.result
				const parts = diffResult.result.split('---VOID_BRANCH_SEP---')
				const stat = (parts[0] || '').trim()
				const diff = (parts[1] || '').trim()
				const branchDiffContent = `Changed files:\n${stat}\n\nDiff:\n${diff}`

				return { ...s, branchName: branchName || s.branchName, branchDiffContent } as StagingSelectionItem
			} catch {
				return { ...s, branchDiffContent: '(Unable to retrieve branch diff)' } as StagingSelectionItem
			}
		}))
	}

	private _addUserCheckpoint({ threadId }: { threadId: string }) {
		const { voidFileSnapshotOfURI } = this._computeNewCheckpointInfo({ threadId }) ?? {}
		this._addCheckpoint(threadId, {
			role: 'checkpoint',
			type: 'user_edit',
			voidFileSnapshotOfURI: voidFileSnapshotOfURI ?? {},
			userModifications: { voidFileSnapshotOfURI: {}, },
		})
	}
	// call this right after LLM edits a file
	private _addToolEditCheckpoint({ threadId, uri, }: { threadId: string, uri: URI }) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return
		const { model } = this._voidModelService.getModel(uri)
		if (!model) return // should never happen
		const diffAreasSnapshot = this._editCodeService.getvoidFileSnapshot(uri)
		this._addCheckpoint(threadId, {
			role: 'checkpoint',
			type: 'tool_edit',
			voidFileSnapshotOfURI: { [uri.fsPath]: diffAreasSnapshot },
			userModifications: { voidFileSnapshotOfURI: {} },
		})
	}


	private _getCheckpointBeforeMessage = ({ threadId, messageIdx }: { threadId: string, messageIdx: number }): [CheckpointEntry, number] | undefined => {
		const thread = this.state.allThreads[threadId]
		if (!thread) return undefined
		for (let i = messageIdx; i >= 0; i--) {
			const message = thread.messages[i]
			if (message.role === 'checkpoint') {
				return [message, i]
			}
		}
		return undefined
	}

	private _getCheckpointsBetween({ threadId, loIdx, hiIdx }: { threadId: string, loIdx: number, hiIdx: number }) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return { lastIdxOfURI: {} } // should never happen
		const lastIdxOfURI: { [fsPath: string]: number } = {}
		for (let i = loIdx; i <= hiIdx; i += 1) {
			const message = thread.messages[i]
			if (message?.role !== 'checkpoint') continue
			for (const fsPath in message.voidFileSnapshotOfURI) { // do not include userModified.beforeStrOfURI here, jumping should not include those changes
				lastIdxOfURI[fsPath] = i
			}
		}
		return { lastIdxOfURI }
	}

	private _readCurrentCheckpoint(threadId: string): [CheckpointEntry, number] | undefined {
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		const { currCheckpointIdx } = thread.state
		if (currCheckpointIdx === null) return

		const checkpoint = thread.messages[currCheckpointIdx]
		if (!checkpoint) return
		if (checkpoint.role !== 'checkpoint') return
		return [checkpoint, currCheckpointIdx]
	}
	private _addUserModificationsToCurrCheckpoint({ threadId }: { threadId: string }) {
		const { voidFileSnapshotOfURI } = this._computeNewCheckpointInfo({ threadId }) ?? {}
		const res = this._readCurrentCheckpoint(threadId)
		if (!res) return
		const [checkpoint, checkpointIdx] = res
		this._editMessageInThread(threadId, checkpointIdx, {
			...checkpoint,
			userModifications: { voidFileSnapshotOfURI: voidFileSnapshotOfURI ?? {}, },
		})
	}


	private _makeUsStandOnCheckpoint({ threadId }: { threadId: string }) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return
		if (thread.state.currCheckpointIdx === null) {
			const lastMsg = thread.messages[thread.messages.length - 1]
			if (lastMsg?.role !== 'checkpoint')
				this._addUserCheckpoint({ threadId })
			this._setThreadState(threadId, { currCheckpointIdx: thread.messages.length - 1 })
		}
	}

	jumpToCheckpointBeforeMessageIdx({ threadId, messageIdx, jumpToUserModified }: { threadId: string, messageIdx: number, jumpToUserModified: boolean }) {

		// if null, add a new temp checkpoint so user can jump forward again
		this._makeUsStandOnCheckpoint({ threadId })

		const thread = this.state.allThreads[threadId]
		if (!thread) return
		if (this.streamState[threadId]?.isRunning) return

		const c = this._getCheckpointBeforeMessage({ threadId, messageIdx })
		if (c === undefined) return // should never happen

		const fromIdx = thread.state.currCheckpointIdx
		if (fromIdx === null) return // should never happen

		const [_, toIdx] = c
		if (toIdx === fromIdx) return

		// console.log(`going from ${fromIdx} to ${toIdx}`)

		// update the user's checkpoint
		this._addUserModificationsToCurrCheckpoint({ threadId })

		/*
if undoing

A,B,C are all files.
x means a checkpoint where the file changed.

A B C D E F G H I
  x x x x x   x           <-- you can't always go up to find the "before" version; sometimes you need to go down
  | | | | |   | x
--x-|-|-|-x---x-|-----     <-- to
	| | | | x   x
	| | x x |
	| |   | |
----x-|---x-x-------     <-- from
	  x

We need to revert anything that happened between to+1 and from.
**We do this by finding the last x from 0...`to` for each file and applying those contents.**
We only need to do it for files that were edited since `to`, ie files between to+1...from.
*/
		if (toIdx < fromIdx) {
			const { lastIdxOfURI } = this._getCheckpointsBetween({ threadId, loIdx: toIdx + 1, hiIdx: fromIdx })

			const idxes = function* () {
				for (let k = toIdx; k >= 0; k -= 1) { // first go up
					yield k
				}
				for (let k = toIdx + 1; k < thread.messages.length; k += 1) { // then go down
					yield k
				}
			}

			for (const fsPath in lastIdxOfURI) {
				// find the first instance of this file starting at toIdx (go up to latest file; if there is none, go down)
				for (const k of idxes()) {
					const message = thread.messages[k]
					if (message.role !== 'checkpoint') continue
					const res = this._getCheckpointInfo(message, fsPath, { includeUserModifiedChanges: jumpToUserModified })
					if (!res) continue
					const { voidFileSnapshot } = res
					if (!voidFileSnapshot) continue
					this._editCodeService.restorevoidFileSnapshot(URI.file(fsPath), voidFileSnapshot)
					break
				}
			}
		}

		/*
if redoing

A B C D E F G H I J
  x x x x x   x     x
  | | | | |   | x x x
--x-|-|-|-x---x-|-|---     <-- from
	| | | | x   x
	| | x x |
	| |   | |
----x-|---x-x-----|---     <-- to
	  x           x


We need to apply latest change for anything that happened between from+1 and to.
We only need to do it for files that were edited since `from`, ie files between from+1...to.
*/
		if (toIdx > fromIdx) {
			const { lastIdxOfURI } = this._getCheckpointsBetween({ threadId, loIdx: fromIdx + 1, hiIdx: toIdx })
			for (const fsPath in lastIdxOfURI) {
				// apply lowest down content for each uri
				for (let k = toIdx; k >= fromIdx + 1; k -= 1) {
					const message = thread.messages[k]
					if (message.role !== 'checkpoint') continue
					const res = this._getCheckpointInfo(message, fsPath, { includeUserModifiedChanges: jumpToUserModified })
					if (!res) continue
					const { voidFileSnapshot } = res
					if (!voidFileSnapshot) continue
					this._editCodeService.restorevoidFileSnapshot(URI.file(fsPath), voidFileSnapshot)
					break
				}
			}
		}

		this._setThreadState(threadId, { currCheckpointIdx: toIdx })
	}


	async branchFromCheckpoint(threadId: string, checkpointMessageIdx: number): Promise<BranchPoint | null> {
		const thread = this.state.allThreads[threadId]
		if (!thread) return null

		const message = thread.messages[checkpointMessageIdx]
		if (!message || message.role !== 'checkpoint') return null

		// 1. Fork the thread up to the checkpoint
		const newThreadId = this.forkThread(threadId, checkpointMessageIdx)
		if (!newThreadId) return null

		// 2. Restore file snapshots from the checkpoint
		this.jumpToCheckpointBeforeMessageIdx({ threadId: newThreadId, messageIdx: checkpointMessageIdx, jumpToUserModified: false })

		// 3. Create a git branch
		const branchName = `grace-branch-${Date.now()}`
		try {
			const { result } = await (this as any).callTool?.run_command?.({ command: `git checkout -b ${branchName}`, cwd: null, waitMs: null, useShell: null }) ?? { result: '' }
			if (result && !result.includes('error')) {
				// success
			}
		} catch {
			// Git branch creation is optional — continue even if it fails
		}

		// 4. Switch to the new thread
		this.switchToThread(newThreadId)

		const branchPoint: BranchPoint = {
			parentThreadId: threadId,
			checkpointIndex: checkpointMessageIdx,
			branchThreadId: newThreadId,
			branchName,
			createdAt: Date.now(),
		}

		return branchPoint
	}

	private _wrapRunAgentToNotify(p: Promise<void>, threadId: string) {
		const notify = ({ error }: { error: string | null }) => {
			const thread = this.state.allThreads[threadId]
			if (!thread) return
			const userMsg = findLast(thread.messages, m => m.role === 'user')
			if (!userMsg) return
			if (userMsg.role !== 'user') return
			const messageContent = truncate(userMsg.displayContent, 50, '...')

			this._notificationService.notify({
				severity: error ? Severity.Warning : Severity.Info,
				message: error ? `Error: ${error} ` : `A new Chat result is ready.`,
				source: messageContent,
				sticky: true,
				actions: {
					primary: [{
						id: 'void.goToChat',
						enabled: true,
						label: `Jump to Chat`,
						tooltip: '',
						class: undefined,
						run: () => {
							this.switchToThread(threadId)
							// scroll to bottom
							this.state.allThreads[threadId]?.state.mountedInfo?.whenMounted.then(m => {
								m.scrollToBottom()
							})
						}
					}]
				},
			})
		}

		p.then(() => {
			if (threadId !== this.state.currentThreadId) notify({ error: null })
		}).catch((e) => {
			if (threadId !== this.state.currentThreadId) notify({ error: getErrorMessage(e) })
			throw e
		})
	}

	dismissStreamError(threadId: string): void {
		this._setStreamState(threadId, undefined)
	}


	private async _addUserMessageAndStreamResponse({ userMessage, _chatSelections, threadId, webSearchEnabled, images }: { userMessage: string, _chatSelections?: StagingSelectionItem[], threadId: string, webSearchEnabled?: boolean, images?: ImageAttachment[] }) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return // should never happen

		// interrupt existing stream
		if (this.streamState[threadId]?.isRunning) {
			await this.abortRunning(threadId)
		}

		// add dummy before this message to keep checkpoint before user message idea consistent
		if (thread.messages.length === 0) {
			this._addUserCheckpoint({ threadId })
		}


		// add user's message to chat history
		const instructions = userMessage
		let currSelns: StagingSelectionItem[] = _chatSelections ?? thread.state.stagingSelections

		// Auto-include active file context when no explicit selections exist
		if (currSelns.length === 0) {
			const activeResource = this._editorService.activeEditor?.resource
			if (activeResource && activeResource.scheme === 'file') {
				currSelns = [{
					type: 'File',
					uri: activeResource,
					language: '',
					state: { wasAddedAsCurrentFile: true },
				}]
			}
		}

		// populate branch diff content for any @Branch selections
		const populatedSelns = await this._populateBranchSelections(currSelns)

		const userMessageContent = await chat_userMessageContent(instructions, populatedSelns, { directoryStrService: this._directoryStringService, fileService: this._fileService }) // user message + names of files (NOT content)
		const userHistoryElt: ChatMessage = { role: 'user', content: userMessageContent, displayContent: instructions, selections: currSelns, images: images && images.length > 0 ? images : undefined, state: defaultMessageState }
		this._addMessageToThread(threadId, userHistoryElt)

		this._setThreadState(threadId, { currCheckpointIdx: null }) // no longer at a checkpoint because started streaming

		this._wrapRunAgentToNotify(
			this._runChatAgent({ threadId, ...this._currentModelSelectionProps(), webSearchEnabled }),
			threadId,
		)

		// scroll to bottom
		this.state.allThreads[threadId]?.state.mountedInfo?.whenMounted.then(m => {
			m.scrollToBottom()
		})
	}


	async addUserMessageAndStreamResponse({ userMessage, _chatSelections, threadId, webSearchEnabled, images, immediate }: { userMessage: string, _chatSelections?: StagingSelectionItem[], threadId: string, webSearchEnabled?: boolean, images?: ImageAttachment[], immediate?: boolean }) {
		const thread = this.state.allThreads[threadId];
		if (!thread) return

		// Queue message if thread is busy (unless immediate=true from Cmd+Enter)
		const isRunning = this.streamState[threadId]?.isRunning
		if (isRunning && isRunning !== 'idle' && !immediate) {
			if (!this._messageQueue.has(threadId)) this._messageQueue.set(threadId, [])
			this._messageQueue.get(threadId)!.push({ userMessage, _chatSelections, webSearchEnabled, images })
			return
		}

		// if there's a current checkpoint, delete all messages after it
		if (thread.state.currCheckpointIdx !== null) {
			const checkpointIdx = thread.state.currCheckpointIdx;
			const newMessages = thread.messages.slice(0, checkpointIdx + 1);

			// Update the thread with truncated messages
			const newThreads = {
				...this.state.allThreads,
				[threadId]: {
					...thread,
					lastModified: new Date().toISOString(),
					messages: newMessages,
				}
			};
			this._storeAllThreads(newThreads);
			this._setState({ allThreads: newThreads });
		}

		// If immediate and already running, abort first
		if (immediate && isRunning && isRunning !== 'idle') {
			await this.abortRunning(threadId)
		}

		// Now call the original method to add the user message and stream the response
		await this._addUserMessageAndStreamResponse({ userMessage, _chatSelections, threadId, webSearchEnabled, images });

		// After streaming completes, process queued messages
		this._processMessageQueue(threadId)
	}

	private async _processMessageQueue(threadId: string): Promise<void> {
		const queue = this._messageQueue.get(threadId)
		if (!queue || queue.length === 0) return
		const next = queue.shift()!
		if (queue.length === 0) this._messageQueue.delete(threadId)
		await this._addUserMessageAndStreamResponse({ ...next, threadId })
		this._processMessageQueue(threadId)
	}

	editUserMessageAndStreamResponse: IChatThreadService['editUserMessageAndStreamResponse'] = async ({ userMessage, messageIdx, threadId }) => {

		const thread = this.state.allThreads[threadId]
		if (!thread) return // should never happen

		if (thread.messages?.[messageIdx]?.role !== 'user') {
			throw new Error(`Error: editing a message with role !=='user'`)
		}

		// get prev and curr selections before clearing the message
		const currSelns = thread.messages[messageIdx].state.stagingSelections || [] // staging selections for the edited message

		// clear messages up to the index
		const slicedMessages = thread.messages.slice(0, messageIdx)
		this._setState({
			allThreads: {
				...this.state.allThreads,
				[thread.id]: {
					...thread,
					messages: slicedMessages
				}
			}
		})

		// re-add the message and stream it
		this._addUserMessageAndStreamResponse({ userMessage, _chatSelections: currSelns, threadId })
	}

	// ---------- the rest ----------

	private _getAllSeenFileURIs(threadId: string) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return []

		const fsPathsSet = new Set<string>()
		const uris: URI[] = []
		const addURI = (uri: URI) => {
			if (!fsPathsSet.has(uri.fsPath)) uris.push(uri)
			fsPathsSet.add(uri.fsPath)
			uris.push(uri)
		}

		for (const m of thread.messages) {
			// URIs of user selections
			if (m.role === 'user') {
				for (const sel of m.selections ?? []) {
					if (sel.uri) addURI(sel.uri)
				}
			}
			// URIs of files that have been read
			else if (m.role === 'tool' && m.type === 'success' && m.name === 'read_file') {
				const params = m.params as BuiltinToolCallParams['read_file']
				addURI(params.uri)
			}
		}
		return uris
	}



	getRelativeStr = (uri: URI) => {
		const isInside = this._workspaceContextService.isInsideWorkspace(uri)
		if (isInside) {
			const f = this._workspaceContextService.getWorkspace().folders.find(f => uri.fsPath.startsWith(f.uri.fsPath))
			if (f) { return uri.fsPath.replace(f.uri.fsPath, '') }
			else { return undefined }
		}
		else {
			return undefined
		}
	}


	// gets the location of codespan link so the user can click on it
	generateCodespanLink: IChatThreadService['generateCodespanLink'] = async ({ codespanStr: _codespanStr, threadId }) => {

		// process codespan to understand what we are searching for
		// TODO account for more complicated patterns eg `ITextEditorService.openEditor()`
		const functionOrMethodPattern = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/; // `fUnCt10n_name`
		const functionParensPattern = /^([^\s(]+)\([^)]*\)$/; // `functionName( args )`

		let target = _codespanStr // the string to search for
		let codespanType: 'file-or-folder' | 'function-or-class'
		if (target.includes('.') || target.includes('/')) {

			codespanType = 'file-or-folder'
			target = _codespanStr

		} else if (functionOrMethodPattern.test(target)) {

			codespanType = 'function-or-class'
			target = _codespanStr

		} else if (functionParensPattern.test(target)) {
			const match = target.match(functionParensPattern)
			if (match && match[1]) {

				codespanType = 'function-or-class'
				target = match[1]

			}
			else { return null }
		}
		else {
			return null
		}

		// get history of all AI and user added files in conversation + store in reverse order (MRU)
		const prevUris = this._getAllSeenFileURIs(threadId).reverse()

		if (codespanType === 'file-or-folder') {
			const doesUriMatchTarget = (uri: URI) => uri.path.includes(target)

			// check if any prevFiles are the `target`
			for (const [idx, uri] of prevUris.entries()) {
				if (doesUriMatchTarget(uri)) {

					// shorten it

					// TODO make this logic more general
					const prevUriStrs = prevUris.map(uri => uri.fsPath)
					const shortenedUriStrs = shorten(prevUriStrs)
					let displayText = shortenedUriStrs[idx]
					const ellipsisIdx = displayText.lastIndexOf('…/');
					if (ellipsisIdx >= 0) {
						displayText = displayText.slice(ellipsisIdx + 2)
					}

					return { uri, displayText }
				}
			}

			// else search codebase for `target`
			let uris: URI[] = []
			try {
				const { result } = await this._toolsService.callTool['search_pathnames_only']({ query: target, includePattern: null, globPattern: null, pageNumber: 0 })
				const { uris: uris_ } = await result
				uris = uris_
			} catch (e) {
				return null
			}

			for (const [idx, uri] of uris.entries()) {
				if (doesUriMatchTarget(uri)) {

					// TODO make this logic more general
					const prevUriStrs = prevUris.map(uri => uri.fsPath)
					const shortenedUriStrs = shorten(prevUriStrs)
					let displayText = shortenedUriStrs[idx]
					const ellipsisIdx = displayText.lastIndexOf('…/');
					if (ellipsisIdx >= 0) {
						displayText = displayText.slice(ellipsisIdx + 2)
					}


					return { uri, displayText }
				}
			}

		}


		if (codespanType === 'function-or-class') {


			// check all prevUris for the target
			for (const uri of prevUris) {

				const modelRef = await this._voidModelService.getModelSafe(uri)
				const { model } = modelRef
				if (!model) continue

				const matches = model.findMatches(
					target,
					false, // searchOnlyEditableRange
					false, // isRegex
					true,  // matchCase
					null, //' ',   // wordSeparators
					true   // captureMatches
				);

				const firstThree = matches.slice(0, 3);

				// take first 3 occurences, attempt to goto definition on them
				for (const match of firstThree) {
					const position = new Position(match.range.startLineNumber, match.range.startColumn);
					const definitionProviders = this._languageFeaturesService.definitionProvider.ordered(model);

					for (const provider of definitionProviders) {

						const _definitions = await provider.provideDefinition(model, position, CancellationToken.None);

						if (!_definitions) continue;

						const definitions = Array.isArray(_definitions) ? _definitions : [_definitions];

						for (const definition of definitions) {

							return {
								uri: definition.uri,
								selection: {
									startLineNumber: definition.range.startLineNumber,
									startColumn: definition.range.startColumn,
									endLineNumber: definition.range.endLineNumber,
									endColumn: definition.range.endColumn,
								},
								displayText: _codespanStr,
							};

							// const defModelRef = await this._textModelService.createModelReference(definition.uri);
							// const defModel = defModelRef.object.textEditorModel;

							// try {
							// 	const symbolProviders = this._languageFeaturesService.documentSymbolProvider.ordered(defModel);

							// 	for (const symbolProvider of symbolProviders) {
							// 		const symbols = await symbolProvider.provideDocumentSymbols(
							// 			defModel,
							// 			CancellationToken.None
							// 		);

							// 		if (symbols) {
							// 			const symbol = symbols.find(s => {
							// 				const symbolRange = s.range;
							// 				return symbolRange.startLineNumber <= definition.range.startLineNumber &&
							// 					symbolRange.endLineNumber >= definition.range.endLineNumber &&
							// 					(symbolRange.startLineNumber !== definition.range.startLineNumber || symbolRange.startColumn <= definition.range.startColumn) &&
							// 					(symbolRange.endLineNumber !== definition.range.endLineNumber || symbolRange.endColumn >= definition.range.endColumn);
							// 			});

							// 			// if we got to a class/function get the full range and return
							// 			if (symbol?.kind === SymbolKind.Function || symbol?.kind === SymbolKind.Method || symbol?.kind === SymbolKind.Class) {
							// 				return {
							// 					uri: definition.uri,
							// 					selection: {
							// 						startLineNumber: definition.range.startLineNumber,
							// 						startColumn: definition.range.startColumn,
							// 						endLineNumber: definition.range.endLineNumber,
							// 						endColumn: definition.range.endColumn,
							// 					}
							// 				};
							// 			}
							// 		}
							// 	}
							// } finally {
							// 	defModelRef.dispose();
							// }
						}
					}
				}
			}

			// unlike above do not search codebase (doesnt make sense)

		}

		return null

	}

	getCodespanLink({ codespanStr, messageIdx, threadId }: { codespanStr: string, messageIdx: number, threadId: string }): CodespanLocationLink | undefined {
		const thread = this.state.allThreads[threadId]
		if (!thread) return undefined;

		const links = thread.state.linksOfMessageIdx?.[messageIdx]
		if (!links) return undefined;

		const link = links[codespanStr]

		return link
	}

	async addCodespanLink({ newLinkText, newLinkLocation, messageIdx, threadId }: { newLinkText: string, newLinkLocation: CodespanLocationLink, messageIdx: number, threadId: string }) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		this._setState({

			allThreads: {
				...this.state.allThreads,
				[threadId]: {
					...thread,
					state: {
						...thread.state,
						linksOfMessageIdx: {
							...thread.state.linksOfMessageIdx,
							[messageIdx]: {
								...thread.state.linksOfMessageIdx?.[messageIdx],
								[newLinkText]: newLinkLocation
							}
						}
					}

				}
			}
		})
	}


	getCurrentThread(): ThreadType {
		const state = this.state
		const thread = state.allThreads[state.currentThreadId]
		if (!thread) throw new Error(`Current thread should never be undefined`)
		return thread
	}

	getCurrentFocusedMessageIdx() {
		const thread = this.getCurrentThread()

		// get the focusedMessageIdx
		const focusedMessageIdx = thread.state.focusedMessageIdx
		if (focusedMessageIdx === undefined) return;

		// check that the message is actually being edited
		const focusedMessage = thread.messages[focusedMessageIdx]
		if (focusedMessage.role !== 'user') return;
		if (!focusedMessage.state) return;

		return focusedMessageIdx
	}

	isCurrentlyFocusingMessage() {
		return this.getCurrentFocusedMessageIdx() !== undefined
	}

	switchToThread(threadId: string) {
		this._setState({ currentThreadId: threadId })
	}


	openNewThread() {
		// if a thread with 0 messages already exists, switch to it
		const { allThreads: currentThreads } = this.state
		for (const threadId in currentThreads) {
			if (currentThreads[threadId]!.messages.length === 0) {
				// switch to the existing empty thread and exit
				this.switchToThread(threadId)
				return
			}
		}
		// otherwise, start a new thread
		const newThread = newThreadObject()

		// update state
		const newThreads: ChatThreads = {
			...currentThreads,
			[newThread.id]: newThread
		}
		this._storeAllThreads(newThreads)
		this._setState({ allThreads: newThreads, currentThreadId: newThread.id })
	}


	deleteThread(threadId: string): void {
		const { allThreads: currentThreads } = this.state

		// delete the thread
		const newThreads = { ...currentThreads };
		delete newThreads[threadId];

		// Clean up stream state to prevent memory leak
		delete this.streamState[threadId];

		// store the updated threads
		this._storeAllThreads(newThreads);
		this._setState({ ...this.state, allThreads: newThreads })
	}

	duplicateThread(threadId: string) {
		const { allThreads: currentThreads } = this.state
		const threadToDuplicate = currentThreads[threadId]
		if (!threadToDuplicate) return
		const newThread = {
			...deepClone(threadToDuplicate),
			id: generateUuid(),
		}
		const newThreads = {
			...currentThreads,
			[newThread.id]: newThread,
		}
		this._storeAllThreads(newThreads)
		this._setState({ allThreads: newThreads })
	}


	forkThread(threadId: string, fromMessageIdx: number): string | null {
		const { allThreads: currentThreads } = this.state
		const threadToFork = currentThreads[threadId]
		if (!threadToFork) return null

		const forkedThread = {
			...deepClone(threadToFork),
			id: generateUuid(),
			messages: deepClone(threadToFork.messages.slice(0, fromMessageIdx + 1)),
			lastModified: new Date().toISOString(),
		}

		const newThreads = {
			...currentThreads,
			[forkedThread.id]: forkedThread,
		}
		this._storeAllThreads(newThreads)
		this._setState({ allThreads: newThreads, currentThreadId: forkedThread.id })
		return forkedThread.id
	}

	// Phase 5: Run a subagent on a hidden in-memory thread
	async runSubagentThread({
		prompt,
		chatModeOverride,
		maxIterations = 10,
		timeoutMs = 120_000,
	}: {
		prompt: string;
		chatModeOverride: ChatMode;
		maxIterations?: number;
		timeoutMs?: number;
	}): Promise<{ result: string; status: 'completed' | 'failed' }> {

		// Create a temporary hidden thread (not stored to disk)
		const threadId = generateUuid()
		const now = new Date().toISOString()
		const hiddenThread: ThreadType = {
			id: threadId,
			createdAt: now,
			lastModified: now,
			isSubagent: true,
			messages: [],
			state: {
				currCheckpointIdx: null,
				stagingSelections: [],
				focusedMessageIdx: undefined,
				linksOfMessageIdx: {},
			},
			filesWithUserChanges: new Set(),
		}

		// Add the hidden thread to state (but don't switch to it or persist it)
		const allThreads = { ...this.state.allThreads, [threadId]: hiddenThread }
		this.state = { ...this.state, allThreads }

		// Add the user prompt as the first message
		this._addMessageToThread(threadId, {
			role: 'user',
			content: prompt,
			displayContent: prompt,
			selections: [],
			state: { stagingSelections: [], isBeingEdited: false },
		})

		// Temporarily override maxAgentIterations for this run
		const originalMaxIterations = this._settingsService.state.globalSettings.maxAgentIterations
			; (this._settingsService.state.globalSettings as any).maxAgentIterations = maxIterations

		try {
			// Run the agent loop with a timeout
			const agentPromise = this._runChatAgent({
				threadId,
				...this._currentModelSelectionProps(),
				chatModeOverride,
			})

			const timeoutPromise = new Promise<void>((_, reject) => {
				setTimeout(() => reject(new Error('Subagent timed out')), timeoutMs)
			})

			await Promise.race([agentPromise, timeoutPromise])

			// Extract the final result from the thread's messages
			const thread = this.state.allThreads[threadId]
			if (!thread) return { result: 'Subagent thread was deleted.', status: 'failed' }

			// Find the last assistant message as the result
			let resultText = ''
			for (let i = thread.messages.length - 1; i >= 0; i--) {
				const msg = thread.messages[i]
				if (msg.role === 'assistant') {
					resultText = msg.displayContent
					break
				}
			}

			// Also collect tool result summaries
			const toolSummaries: string[] = []
			for (const msg of thread.messages) {
				if (msg.role === 'tool' && msg.type === 'success' && msg.content) {
					const brief = msg.content.length > 200 ? msg.content.substring(0, 200) + '...' : msg.content
					toolSummaries.push(`[${msg.name}]: ${brief}`)
				}
			}

			const finalResult = resultText || (toolSummaries.length > 0
				? `Subagent completed with ${toolSummaries.length} tool calls:\n${toolSummaries.join('\n')}`
				: 'Subagent completed but produced no output.')

			return { result: finalResult, status: 'completed' }

		} catch (e: any) {
			return { result: `Subagent error: ${e?.message || e}`, status: 'failed' }
		} finally {
			// Restore original maxIterations
			; (this._settingsService.state.globalSettings as any).maxAgentIterations = originalMaxIterations

			// Clean up: remove the hidden thread from state (don't persist deletion)
			const cleanedThreads = { ...this.state.allThreads }
			delete cleanedThreads[threadId]
			this.state = { ...this.state, allThreads: cleanedThreads }
		}
	}


	private _addMessageToThread(threadId: string, message: ChatMessage) {
		const { allThreads } = this.state
		const oldThread = allThreads[threadId]
		if (!oldThread) return // should never happen
		// update state and store it
		const newThreads = {
			...allThreads,
			[oldThread.id]: {
				...oldThread,
				lastModified: new Date().toISOString(),
				messages: [
					...oldThread.messages,
					message
				],
			}
		}
		this._storeAllThreads(newThreads)
		this._setState({ allThreads: newThreads }) // the current thread just changed (it had a message added to it)
	}

	// sets the currently selected message (must be undefined if no message is selected)
	setCurrentlyFocusedMessageIdx(messageIdx: number | undefined) {

		const threadId = this.state.currentThreadId
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		this._setState({
			allThreads: {
				...this.state.allThreads,
				[threadId]: {
					...thread,
					state: {
						...thread.state,
						focusedMessageIdx: messageIdx,
					}
				}
			}
		})

		// // when change focused message idx, jump - do not jump back when click edit, too confusing.
		// if (messageIdx !== undefined)
		// 	this.jumpToCheckpointBeforeMessageIdx({ threadId, messageIdx, jumpToUserModified: true })
	}


	addNewStagingSelection(newSelection: StagingSelectionItem): void {

		const focusedMessageIdx = this.getCurrentFocusedMessageIdx()

		// set the selections to the proper value
		let selections: StagingSelectionItem[] = []
		let setSelections = (s: StagingSelectionItem[]) => { }

		if (focusedMessageIdx === undefined) {
			selections = this.getCurrentThreadState().stagingSelections
			setSelections = (s: StagingSelectionItem[]) => this.setCurrentThreadState({ stagingSelections: s })
		} else {
			selections = this.getCurrentMessageState(focusedMessageIdx).stagingSelections
			setSelections = (s) => this.setCurrentMessageState(focusedMessageIdx, { stagingSelections: s })
		}

		// if matches with existing selection, overwrite (since text may change)
		const idx = findStagingSelectionIndex(selections, newSelection)
		if (idx !== null && idx !== -1) {
			setSelections([
				...selections!.slice(0, idx),
				newSelection,
				...selections!.slice(idx + 1, Infinity)
			])
		}
		// if no match, add it
		else {
			setSelections([...(selections ?? []), newSelection])
		}
	}


	// Pops the staging selections from the current thread's state
	popStagingSelections(numPops: number): void {

		numPops = numPops ?? 1;

		const focusedMessageIdx = this.getCurrentFocusedMessageIdx()

		// set the selections to the proper value
		let selections: StagingSelectionItem[] = []
		let setSelections = (s: StagingSelectionItem[]) => { }

		if (focusedMessageIdx === undefined) {
			selections = this.getCurrentThreadState().stagingSelections
			setSelections = (s: StagingSelectionItem[]) => this.setCurrentThreadState({ stagingSelections: s })
		} else {
			selections = this.getCurrentMessageState(focusedMessageIdx).stagingSelections
			setSelections = (s) => this.setCurrentMessageState(focusedMessageIdx, { stagingSelections: s })
		}

		setSelections([
			...selections.slice(0, selections.length - numPops)
		])

	}

	// set message.state
	private _setCurrentMessageState(state: Partial<UserMessageState>, messageIdx: number): void {

		const threadId = this.state.currentThreadId
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		this._setState({
			allThreads: {
				...this.state.allThreads,
				[threadId]: {
					...thread,
					messages: thread.messages.map((m, i) =>
						i === messageIdx && m.role === 'user' ? {
							...m,
							state: {
								...m.state,
								...state
							},
						} : m
					)
				}
			}
		})

	}

	// set thread.state
	private _setThreadState(threadId: string, state: Partial<ThreadType['state']>, doNotRefreshMountInfo?: boolean): void {
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		this._setState({
			allThreads: {
				...this.state.allThreads,
				[thread.id]: {
					...thread,
					state: {
						...thread.state,
						...state
					}
				}
			}
		}, doNotRefreshMountInfo)

	}


	// closeCurrentStagingSelectionsInThread = () => {
	// 	const currThread = this.getCurrentThreadState()

	// 	// close all stagingSelections
	// 	const closedStagingSelections = currThread.stagingSelections.map(s => ({ ...s, state: { ...s.state, isOpened: false } }))

	// 	const newThread = currThread
	// 	newThread.stagingSelections = closedStagingSelections

	// 	this.setCurrentThreadState(newThread)

	// }

	// closeCurrentStagingSelectionsInMessage: IChatThreadService['closeCurrentStagingSelectionsInMessage'] = ({ messageIdx }) => {
	// 	const currMessage = this.getCurrentMessageState(messageIdx)

	// 	// close all stagingSelections
	// 	const closedStagingSelections = currMessage.stagingSelections.map(s => ({ ...s, state: { ...s.state, isOpened: false } }))

	// 	const newMessage = currMessage
	// 	newMessage.stagingSelections = closedStagingSelections

	// 	this.setCurrentMessageState(messageIdx, newMessage)

	// }



	getCurrentThreadState = () => {
		const currentThread = this.getCurrentThread()
		return currentThread.state
	}
	setCurrentThreadState = (newState: Partial<ThreadType['state']>) => {
		this._setThreadState(this.state.currentThreadId, newState)
	}

	// gets `staging` and `setStaging` of the currently focused element, given the index of the currently selected message (or undefined if no message is selected)

	getCurrentMessageState(messageIdx: number): UserMessageState {
		const currMessage = this.getCurrentThread()?.messages?.[messageIdx]
		if (!currMessage || currMessage.role !== 'user') return defaultMessageState
		return currMessage.state
	}
	setCurrentMessageState(messageIdx: number, newState: Partial<UserMessageState>) {
		const currMessage = this.getCurrentThread()?.messages?.[messageIdx]
		if (!currMessage || currMessage.role !== 'user') return
		this._setCurrentMessageState(newState, messageIdx)
	}



}

registerSingleton(IChatThreadService, ChatThreadService, InstantiationType.Eager);
