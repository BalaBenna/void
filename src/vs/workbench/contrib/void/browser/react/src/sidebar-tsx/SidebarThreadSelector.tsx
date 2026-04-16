/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useState } from 'react';
import { IconShell1 } from '../markdown/ApplyBlockHoverButtons.js';
import { useAccessor, useChatThreadsState, useFullChatThreadsStreamState } from '../util/services.js';
import { Check, Copy, LoaderCircle, MessageCircleQuestion, Trash2, X } from 'lucide-react';
import { IsRunningType, ThreadType } from '../../../chatThreadService.js';


const numInitialThreads = 3

export const PastThreadsList = ({ className = '' }: { className?: string }) => {
	const [showAll, setShowAll] = useState(false);

	const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

	const threadsState = useChatThreadsState()
	const { allThreads, currentThreadId } = threadsState

	const streamState = useFullChatThreadsStreamState()

	const runningThreadIds: { [threadId: string]: IsRunningType | undefined } = {}
	for (const threadId in streamState) {
		const isRunning = streamState[threadId]?.isRunning
		if (isRunning) { runningThreadIds[threadId] = isRunning }
	}

	if (!allThreads) {
		return <div key="error" className="p-1">{`Error accessing chat history.`}</div>;
	}

	// sorted by most recent to least recent
	const sortedThreadIds = Object.keys(allThreads ?? {})
		.sort((threadId1, threadId2) => (allThreads[threadId1]?.lastModified ?? 0) > (allThreads[threadId2]?.lastModified ?? 0) ? -1 : 1)
		.filter(threadId => (allThreads![threadId]?.messages.length ?? 0) !== 0)

	// Get only first 5 threads if not showing all
	const hasMoreThreads = sortedThreadIds.length > numInitialThreads;
	const displayThreads = showAll ? sortedThreadIds : sortedThreadIds.slice(0, numInitialThreads);

	return (
		<div className={`void-cursor-panel-subtle flex flex-col gap-2 rounded-[24px] p-3 w-full text-nowrap text-void-fg-3 select-none relative ${className}`}>
			{displayThreads.length === 0 // this should never happen
				? <></>
				: displayThreads.map((threadId, i) => {
					const pastThread = allThreads[threadId];
					if (!pastThread) {
						return <div key={i} className="p-1">{`Error accessing chat history.`}</div>;
					}

					return (
						<PastThreadElement
							key={pastThread.id}
							pastThread={pastThread}
							idx={i}
							hoveredIdx={hoveredIdx}
							setHoveredIdx={setHoveredIdx}
							isRunning={runningThreadIds[pastThread.id]}
							isActive={pastThread.id === currentThreadId}
						/>
					);
				})
			}

			{hasMoreThreads && !showAll && (
				<div
					className="text-void-fg-3 opacity-80 hover:opacity-100 hover:brightness-115 cursor-pointer px-1 py-0.5 text-xs"
					onClick={() => setShowAll(true)}
				>
					Show {sortedThreadIds.length - numInitialThreads} more conversations
				</div>
			)}
			{hasMoreThreads && showAll && (
				<div
					className="text-void-fg-3 opacity-80 hover:opacity-100 hover:brightness-115 cursor-pointer px-1 py-0.5 text-xs"
					onClick={() => setShowAll(false)}
				>
					Show less
				</div>
			)}
		</div>
	);
};





// Format date to display as today, yesterday, or date
const formatDate = (date: Date) => {
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const yesterday = new Date(today);
	yesterday.setDate(yesterday.getDate() - 1);

	if (date >= today) {
		return 'Today';
	} else if (date >= yesterday) {
		return 'Yesterday';
	} else {
		return `${date.toLocaleString('default', { month: 'short' })} ${date.getDate()}`;
	}
};

// Format time to 12-hour format
const formatTime = (date: Date) => {
	return date.toLocaleString('en-US', {
		hour: 'numeric',
		minute: '2-digit',
		hour12: true
	});
};

const summarizeThread = (thread: ThreadType) => {
	const firstUserMsg = thread.messages.find((msg) => msg.role === 'user' && msg.displayContent?.trim());
	const summary = firstUserMsg?.role === 'user' ? firstUserMsg.displayContent.trim() : 'Untitled conversation';
	return summary.length > 72 ? `${summary.slice(0, 72).trimEnd()}...` : summary;
};


const DuplicateButton = ({ threadId }: { threadId: string }) => {
	const accessor = useAccessor()
	const chatThreadsService = accessor.get('IChatThreadService')
	return <IconShell1
		Icon={Copy}
		className='size-[11px]'
		onClick={() => { chatThreadsService.duplicateThread(threadId); }}
		data-tooltip-id='void-tooltip'
		data-tooltip-place='top'
		data-tooltip-content='Duplicate thread'
	>
	</IconShell1>

}

const TrashButton = ({ threadId }: { threadId: string }) => {

	const accessor = useAccessor()
	const chatThreadsService = accessor.get('IChatThreadService')


	const [isTrashPressed, setIsTrashPressed] = useState(false)

	return (isTrashPressed ?
		<div className='flex flex-nowrap text-nowrap gap-1'>
			<IconShell1
				Icon={X}
				className='size-[11px]'
				onClick={() => { setIsTrashPressed(false); }}
				data-tooltip-id='void-tooltip'
				data-tooltip-place='top'
				data-tooltip-content='Cancel'
			/>
			<IconShell1
				Icon={Check}
				className='size-[11px]'
				onClick={() => { chatThreadsService.deleteThread(threadId); setIsTrashPressed(false); }}
				data-tooltip-id='void-tooltip'
				data-tooltip-place='top'
				data-tooltip-content='Confirm'
			/>
		</div>
		: <IconShell1
			Icon={Trash2}
			className='size-[11px]'
			onClick={() => { setIsTrashPressed(true); }}
			data-tooltip-id='void-tooltip'
			data-tooltip-place='top'
			data-tooltip-content='Delete thread'
		/>
	)
}

const PastThreadElement = ({ pastThread, idx, hoveredIdx, setHoveredIdx, isRunning, isActive }: {
	pastThread: ThreadType,
	idx: number,
	hoveredIdx: number | null,
	setHoveredIdx: (idx: number | null) => void,
	isRunning: IsRunningType | undefined,
	isActive: boolean,
}

) => {


	const accessor = useAccessor()
	const chatThreadsService = accessor.get('IChatThreadService')

	// const settingsState = useSettingsState()
	// const convertService = accessor.get('IConvertToLLMMessageService')
	// const chatMode = settingsState.globalSettings.chatMode
	// const modelSelection = settingsState.modelSelectionOfFeature?.Chat ?? null
	// const copyChatButton = <CopyButton
	// 	codeStr={async () => {
	// 		const { messages } = await convertService.prepareLLMChatMessages({
	// 			chatMessages: currentThread.messages,
	// 			chatMode,
	// 			modelSelection,
	// 		})
	// 		return JSON.stringify(messages, null, 2)
	// 	}}
	// 	toolTipName={modelSelection === null ? 'Copy As Messages Payload' : `Copy As ${displayInfoOfProviderName(modelSelection.providerName).title} Payload`}
	// />


	// const currentThread = chatThreadsService.getCurrentThread()
	// const copyChatButton2 = <CopyButton
	// 	codeStr={async () => {
	// 		return JSON.stringify(currentThread.messages, null, 2)
	// 	}}
	// 	toolTipName={`Copy As Void Chat`}
	// />

	const firstMsg = summarizeThread(pastThread);

	const numMessages = pastThread.messages.filter((msg) => msg.role === 'assistant' || msg.role === 'user').length;

	const detailsHTML = isActive ? <span className='text-xs text-void-fg-4'>Open</span> : null

	return <div
		key={pastThread.id}
		className={`
			${isActive ? 'void-cursor-thread-active' : 'void-cursor-subtle-card hover:brightness-[1.04]'}
			rounded-2xl px-3 py-2 text-sm cursor-pointer transition-all duration-150
		`}
		onClick={() => {
			chatThreadsService.switchToThread(pastThread.id);
		}}
		onMouseEnter={() => setHoveredIdx(idx)}
		onMouseLeave={() => setHoveredIdx(null)}
	>
		<div className="flex items-start justify-between gap-2">
			<span className="flex items-start gap-2 min-w-0 overflow-hidden">
				{/* spinner */}
				{isRunning === 'LLM' || isRunning === 'tool' || isRunning === 'idle' ? <LoaderCircle className="animate-spin flex-shrink-0 flex-grow-0 mt-0.5 text-void-fg-3" size={14} />
					:
					isRunning === 'awaiting_user' ? <MessageCircleQuestion className="flex-shrink-0 flex-grow-0 mt-0.5 text-void-warning" size={14} />
						:
						null}
				<div className="min-w-0 flex flex-col gap-1">
					<span className="truncate overflow-hidden text-ellipsis text-void-fg-1"
						data-tooltip-id='void-tooltip'
						data-tooltip-content={numMessages + ' messages'}
						data-tooltip-place='top'
					>{firstMsg}</span>
					<span className="text-xs text-void-fg-4 flex items-center gap-1.5">
						<span>{formatDate(new Date(pastThread.lastModified))}</span>
						<span className="opacity-40">•</span>
						<span>{formatTime(new Date(pastThread.lastModified))}</span>
						<span className="opacity-40">•</span>
						<span>{numMessages} msg{numMessages === 1 ? '' : 's'}</span>
					</span>
				</div>
			</span>

			<div className="flex items-center gap-x-1 opacity-70">
				{idx === hoveredIdx ?
					<>
						{/* trash icon */}
						<DuplicateButton threadId={pastThread.id} />

						{/* trash icon */}
						<TrashButton threadId={pastThread.id} />
					</>
					: <>
						{detailsHTML}
					</>
				}
			</div>
		</div>
	</div>
}
