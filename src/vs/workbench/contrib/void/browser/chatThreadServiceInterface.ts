/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { RawToolCallObj, RawToolParamsObj } from '../common/sendLLMMessageTypes.js';
import { ChatMode } from '../common/voidSettingsTypes.js';
import { ChatMessage, CodespanLocationLink, ImageAttachment, StagingSelectionItem } from '../common/chatThreadServiceTypes.js';
import { ToolCallParams, ToolName } from '../common/toolsServiceTypes.js';


type UserMessageType = ChatMessage & { role: 'user' }
type UserMessageState = UserMessageType['state']

export type WhenMounted = {
	textAreaRef: { current: HTMLTextAreaElement | null };
	scrollToBottom: () => void;
}

export type ThreadType = {
	id: string;
	createdAt: string;
	lastModified: string;

	isSubagent?: boolean;

	messages: ChatMessage[];
	filesWithUserChanges: Set<string>;

	state: {
		currCheckpointIdx: number | null;

		stagingSelections: StagingSelectionItem[];
		focusedMessageIdx: number | undefined;

		linksOfMessageIdx: {
			[messageIdx: number]: {
				[codespanName: string]: CodespanLocationLink
			}
		}

		mountedInfo?: {
			whenMounted: Promise<WhenMounted>
			_whenMountedResolver: (res: WhenMounted) => void
			mountedIsResolvedRef: { current: boolean };
		}
	};
}

export type ChatThreads = {
	[id: string]: undefined | ThreadType;
}

export type ThreadsState = {
	allThreads: ChatThreads;
	currentThreadId: string;
}

export type IsRunningType =
	| 'LLM'
	| 'tool'
	| 'awaiting_user'
	| 'idle'
	| undefined

export type ThreadStreamState = {
	[threadId: string]: undefined | {
		isRunning: undefined;
		error?: { message: string, fullError: Error | null, };
		llmInfo?: undefined;
		toolInfo?: undefined;
		interrupt?: undefined;
	} | {
		isRunning: 'LLM';
		error?: undefined;
		llmInfo: {
			displayContentSoFar: string;
			reasoningSoFar: string;
			toolCallSoFar: RawToolCallObj | null;
		};
		toolInfo?: undefined;
		interrupt: Promise<() => void>;
	} | {
		isRunning: 'tool';
		error?: undefined;
		llmInfo?: undefined;
		toolInfo: {
			toolName: ToolName;
			toolParams: ToolCallParams<ToolName>;
			id: string;
			content: string;
			rawParams: RawToolParamsObj;
			mcpServerName: string | undefined;
		};
		interrupt: Promise<() => void>;
	} | {
		isRunning: 'awaiting_user';
		error?: undefined;
		llmInfo?: undefined;
		toolInfo?: undefined;
		interrupt?: undefined;
	} | {
		isRunning: 'idle';
		error?: undefined;
		llmInfo?: undefined;
		toolInfo?: undefined;
		interrupt: 'not_needed' | Promise<() => void>;
	}
}


export interface IChatThreadService {
	readonly _serviceBrand: undefined;

	readonly state: ThreadsState;
	readonly streamState: ThreadStreamState;

	onDidChangeCurrentThread: Event<void>;
	onDidChangeStreamState: Event<{ threadId: string }>

	getCurrentThread(): ThreadType;
	openNewThread(): void;
	switchToThread(threadId: string): void;

	deleteThread(threadId: string): void;
	duplicateThread(threadId: string): void;

	getCurrentMessageState: (messageIdx: number) => UserMessageState
	setCurrentMessageState: (messageIdx: number, newState: Partial<UserMessageState>) => void
	getCurrentThreadState: () => ThreadType['state']
	setCurrentThreadState: (newState: Partial<ThreadType['state']>) => void

	getCurrentFocusedMessageIdx(): number | undefined;
	isCurrentlyFocusingMessage(): boolean;
	setCurrentlyFocusedMessageIdx(messageIdx: number | undefined): void;

	popStagingSelections(numPops?: number): void;
	addNewStagingSelection(newSelection: StagingSelectionItem): void;

	dangerousSetState: (newState: ThreadsState) => void;
	resetState: () => void;

	getCodespanLink(opts: { codespanStr: string, messageIdx: number, threadId: string }): CodespanLocationLink | undefined;
	addCodespanLink(opts: { newLinkText: string, newLinkLocation: CodespanLocationLink, messageIdx: number, threadId: string }): void;
	generateCodespanLink(opts: { codespanStr: string, threadId: string }): Promise<CodespanLocationLink>;
	getRelativeStr(uri: URI): string | undefined

	abortRunning(threadId: string): Promise<void>;
	dismissStreamError(threadId: string): void;

	editUserMessageAndStreamResponse({ userMessage, messageIdx, threadId }: { userMessage: string, messageIdx: number, threadId: string }): Promise<void>;

	addUserMessageAndStreamResponse({ userMessage, threadId, webSearchEnabled, images }: { userMessage: string, threadId: string, webSearchEnabled?: boolean, images?: ImageAttachment[] }): Promise<void>;

	approveLatestToolRequest(threadId: string): void;
	rejectLatestToolRequest(threadId: string): void;

	executePlan(threadId: string, planMessageIdx: number): void;
	executePlanStepByStep(threadId: string, planMessageIdx: number): void;
	continuePlanExecution(threadId: string): void;
	answerPlanQuestion(threadId: string, questionId: string, answer: string): void;

	getPlanFileMapping(uri: URI): { threadId: string; planMessageIdx: number } | undefined;

	jumpToCheckpointBeforeMessageIdx(opts: { threadId: string, messageIdx: number, jumpToUserModified: boolean }): void;

	runSubagentThread(opts: {
		prompt: string;
		chatModeOverride: ChatMode;
		maxIterations?: number;
		timeoutMs?: number;
	}): Promise<{ result: string; status: 'completed' | 'failed' }>;

	focusCurrentChat: () => Promise<void>
	blurCurrentChat: () => Promise<void>
}

export const IChatThreadService = createDecorator<IChatThreadService>('voidChatThreadService');
