/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useEffect, useMemo, useRef, useState } from 'react';
import { CopyButton, IconShell1 } from '../markdown/ApplyBlockHoverButtons.js';
import { useAccessor, useChatThreadsState, useChatThreadsStreamState, useFullChatThreadsStreamState, useSettingsState } from '../util/services.js';
import { IconX } from './SidebarChat.js';
import { Check, Copy, Icon, LoaderCircle, MessageCircle, MessageCircleQuestion, Pencil, Search, Trash2, UserCheck, X } from 'lucide-react';
import { IsRunningType, ThreadType } from '../../../chatThreadService.js';


const numInitialThreads = 3

// Format relative time like "2w", "3d", "1h", "5m"
const formatRelativeTime = (date: Date): string => {
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMinutes = Math.floor(diffMs / (1000 * 60));
	const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
	const diffWeeks = Math.floor(diffDays / 7);

	if (diffMinutes < 1) return 'now';
	if (diffMinutes < 60) return `${diffMinutes}m`;
	if (diffHours < 24) return `${diffHours}h`;
	if (diffDays < 7) return `${diffDays}d`;
	return `${diffWeeks}w`;
};

// Format relative time for group headers like "Today", "Yesterday", "2w ago"
const formatRelativeTimeGroup = (date: Date): string => {
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const yesterday = new Date(today);
	yesterday.setDate(yesterday.getDate() - 1);

	if (date >= today) return 'Today';
	if (date >= yesterday) return 'Yesterday';

	const diffMs = now.getTime() - date.getTime();
	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
	const diffWeeks = Math.floor(diffDays / 7);

	if (diffDays < 7) return `${diffDays}d ago`;
	return `${diffWeeks}w ago`;
};

// Get the "title" (first user message) from a thread
const getThreadTitle = (thread: ThreadType): string => {
	const firstUserMsgIdx = thread.messages.findIndex((msg) => msg.role === 'user');
	if (firstUserMsgIdx !== -1) {
		const firstUserMsgObj = thread.messages[firstUserMsgIdx];
		return (firstUserMsgObj.role === 'user' && firstUserMsgObj.displayContent) || '';
	}
	return '""';
};


export const PastThreadsList = ({ className = '' }: { className?: string }) => {
	const [showAll, setShowAll] = useState(false);

	const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

	const threadsState = useChatThreadsState()
	const { allThreads } = threadsState

	const streamState = useFullChatThreadsStreamState()

	const runningThreadIds: { [threadId: string]: IsRunningType | undefined } = {}
	for (const threadId in streamState) {
		const isRunning = streamState[threadId]?.isRunning
		if (isRunning) { runningThreadIds[threadId] = isRunning }
	}

	if (!allThreads) {
		return <div key="error" className="p-1">{`Error accessing chat history.`}</div>;
	}

	// sorted by most recent to least recent, excluding subagent threads
	const sortedThreadIds = Object.keys(allThreads ?? {})
		.sort((threadId1, threadId2) => (allThreads[threadId1]?.lastModified ?? 0) > (allThreads[threadId2]?.lastModified ?? 0) ? -1 : 1)
		.filter(threadId => (allThreads![threadId]?.messages.length ?? 0) !== 0)
		.filter(threadId => !allThreads![threadId]?.isSubagent)

	// Get only first 3 threads if not showing all
	const hasMoreThreads = sortedThreadIds.length > numInitialThreads;
	const displayThreads = showAll ? sortedThreadIds : sortedThreadIds.slice(0, numInitialThreads);

	return (
		<div className={`flex flex-col mb-2 w-full text-nowrap text-void-fg-3 select-none relative ${className}`}>

			{/* Header with Past Chats and View All */}
			<div className='flex items-center justify-between mb-2'>
				<span className='text-void-fg-3 text-root select-none'>Past Chats</span>
				{hasMoreThreads && (
					<div
						className="text-void-fg-3 opacity-60 hover:opacity-100 cursor-pointer text-xs hover:underline"
						onClick={() => setShowAll(!showAll)}
					>
						{showAll ? 'Show Less' : 'View All'}
					</div>
				)}
			</div>

			{displayThreads.length === 0
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
						/>
					);
				})
			}
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

const PastThreadElement = ({ pastThread, idx, hoveredIdx, setHoveredIdx, isRunning }: {
	pastThread: ThreadType,
	idx: number,
	hoveredIdx: number | null,
	setHoveredIdx: (idx: number | null) => void,
	isRunning: IsRunningType | undefined,
}

) => {

	const accessor = useAccessor()
	const chatThreadsService = accessor.get('IChatThreadService')

	const firstMsg = getThreadTitle(pastThread);
	const numMessages = pastThread.messages.filter((msg) => msg.role === 'assistant' || msg.role === 'user').length;

	const relativeTime = formatRelativeTime(new Date(pastThread.lastModified));

	return <div
		key={pastThread.id}
		className={`
			py-1 px-2 rounded text-sm bg-zinc-700/5 hover:bg-zinc-700/10 dark:bg-zinc-300/5 dark:hover:bg-zinc-300/10 cursor-pointer opacity-80 hover:opacity-100
		`}
		onClick={() => {
			chatThreadsService.switchToThread(pastThread.id);
		}}
		onMouseEnter={() => setHoveredIdx(idx)}
		onMouseLeave={() => setHoveredIdx(null)}
	>
		<div className="flex items-center justify-between gap-1">
			<span className="flex items-center gap-2 min-w-0 overflow-hidden">
				{/* spinner */}
				{isRunning === 'LLM' || isRunning === 'tool' || isRunning === 'idle' ? <LoaderCircle className="animate-spin bg-void-stroke-1 flex-shrink-0 flex-grow-0" size={14} />
					:
					isRunning === 'awaiting_user' ? <MessageCircleQuestion className="bg-void-stroke-1 flex-shrink-0 flex-grow-0" size={14} />
						:
						null}
				{/* name */}
				<span className="truncate overflow-hidden text-ellipsis"
					data-tooltip-id='void-tooltip'
					data-tooltip-content={numMessages + ' messages'}
					data-tooltip-place='top'
				>{firstMsg}</span>
			</span>

			<div className="flex items-center gap-x-1 opacity-60">
				{idx === hoveredIdx ?
					<>
						{/* duplicate icon */}
						<DuplicateButton threadId={pastThread.id} />

						{/* trash icon */}
						<TrashButton threadId={pastThread.id} />
					</>
					: <>
						{/* relative time */}
						<span>{relativeTime}</span>
					</>
				}
			</div>
		</div>
	</div>
}



// ==================== History Dropdown ====================

// Format time ago in readable form like "45 mins ago", "1 wk ago"
const formatTimeAgo = (date: Date): string => {
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMinutes = Math.floor(diffMs / (1000 * 60));
	const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
	const diffWeeks = Math.floor(diffDays / 7);

	if (diffMinutes < 1) return 'just now';
	if (diffMinutes < 60) return `${diffMinutes} mins ago`;
	if (diffHours < 24) return `${diffHours}h ago`;
	if (diffDays < 7) return `${diffDays}d ago`;
	return `${diffWeeks} wk ago`;
};

// Single thread row in the history dropdown
const HistoryThreadRow = ({ thread, onSelect, onDelete }: {
	thread: ThreadType,
	onSelect: () => void,
	onDelete: () => void,
}) => {
	const [showConfirm, setShowConfirm] = useState(false);
	const title = getThreadTitle(thread);
	const timeAgo = formatTimeAgo(new Date(thread.lastModified));

	return (
		<div
			className="group flex items-center justify-between px-5 py-2.5 cursor-pointer hover:bg-void-bg-2-hover transition-colors"
			onClick={onSelect}
		>
			<span className="truncate text-sm text-void-fg-1 font-medium min-w-0 flex-1 mr-3">
				{title || 'New conversation'}
			</span>
			<div className="flex items-center gap-2 flex-shrink-0">
				<span className="text-xs text-void-fg-3 opacity-60">{timeAgo}</span>
				{showConfirm ? (
					<div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
						<button className="p-0.5 rounded hover:bg-red-500/20 text-red-400" onClick={() => { onDelete(); setShowConfirm(false); }}>
							<Check size={12} />
						</button>
						<button className="p-0.5 rounded hover:bg-void-bg-2-hover text-void-fg-3" onClick={() => setShowConfirm(false)}>
							<X size={12} />
						</button>
					</div>
				) : (
					<button
						className="p-0.5 rounded hover:bg-void-bg-2-hover text-void-fg-3 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
						onClick={(e) => { e.stopPropagation(); setShowConfirm(true); }}
					>
						<Copy size={12} />
					</button>
				)}
			</div>
		</div>
	);
};

export const HistoryDropdown = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
	const [searchQuery, setSearchQuery] = useState('');
	const dropdownRef = useRef<HTMLDivElement>(null);
	const searchInputRef = useRef<HTMLInputElement>(null);

	const accessor = useAccessor()
	const chatThreadsService = accessor.get('IChatThreadService')

	const threadsState = useChatThreadsState()
	const { allThreads, currentThreadId } = threadsState
	const streamState = useFullChatThreadsStreamState()

	// Focus search input when dropdown opens
	useEffect(() => {
		if (isOpen && searchInputRef.current) {
			setTimeout(() => searchInputRef.current?.focus(), 50);
		}
		if (isOpen) setSearchQuery('');
	}, [isOpen]);

	// Close on click outside
	useEffect(() => {
		if (!isOpen) return;
		const handleClickOutside = (e: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
				onClose();
			}
		};
		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [isOpen, onClose]);

	if (!isOpen || !allThreads) return null;

	// Filter and sort threads, excluding subagent threads and empty threads
	const sortedThreadIds = Object.keys(allThreads)
		.filter(threadId => (allThreads[threadId]?.messages.length ?? 0) !== 0)
		.filter(threadId => !allThreads[threadId]?.isSubagent)
		.sort((a, b) => (allThreads[a]?.lastModified ?? 0) > (allThreads[b]?.lastModified ?? 0) ? -1 : 1);

	// Apply search filter
	const filteredThreadIds = searchQuery
		? sortedThreadIds.filter(threadId => {
			const thread = allThreads[threadId];
			if (!thread) return false;
			return getThreadTitle(thread).toLowerCase().includes(searchQuery.toLowerCase());
		})
		: sortedThreadIds;

	// Categorize threads: Current, Running, Recent
	const currentThread = currentThreadId ? allThreads[currentThreadId] : null;
	const runningThreadIds = filteredThreadIds.filter(id => {
		if (id === currentThreadId) return false;
		const s = streamState[id];
		return s?.isRunning === 'LLM' || s?.isRunning === 'tool' || s?.isRunning === 'idle' || s?.isRunning === 'awaiting_user';
	});
	const recentThreadIds = filteredThreadIds.filter(id =>
		id !== currentThreadId && !runningThreadIds.includes(id)
	);

	const handleSelect = (threadId: string) => {
		chatThreadsService.switchToThread(threadId);
		onClose();
	};
	const handleDelete = (threadId: string) => {
		chatThreadsService.deleteThread(threadId);
	};

	return (
		<>
		{/* Backdrop overlay — covers entire sidebar viewport */}
		<div
			className="fixed inset-0 z-[99]"
			style={{ backgroundColor: 'rgba(0, 0, 0, 0.25)', backdropFilter: 'blur(1px)' }}
			onClick={onClose}
		/>

		{/* Centered modal — positioned in the middle of the sidebar viewport */}
		<div
			ref={dropdownRef}
			className="fixed z-[100] bg-void-bg-1 border border-void-border-2 rounded-xl overflow-y-auto"
			style={{
				top: '50%',
				left: '50%',
				transform: 'translate(-50%, -50%)',
				width: 'min(380px, calc(100vw - 24px))',
				maxHeight: '65vh',
				boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.05)',
			}}
		>
			{/* Header */}
			<div className="px-5 pt-5 pb-1">
				<h3 className="text-sm text-void-fg-3 select-none" style={{ opacity: 0.7 }}>Select a conversation</h3>
			</div>

			{/* Search bar */}
			<div className="px-4 pb-3">
				<div className="flex items-center gap-2 px-3 py-2 bg-void-bg-2 rounded-lg border border-void-border-3 focus-within:border-void-border-1 transition-colors">
					<Search size={14} className="text-void-fg-3 flex-shrink-0 opacity-40" />
					<input
						ref={searchInputRef}
						type="text"
						placeholder="Search chats..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						className="bg-transparent text-void-fg-1 text-sm w-full outline-none placeholder:text-void-fg-3 placeholder:opacity-40"
					/>
				</div>
			</div>

			{/* Current section */}
			{currentThread && currentThread.messages.length > 0 && !searchQuery && (
				<div>
					<div className="px-5 pt-1 pb-1.5 text-xs text-void-fg-3 select-none" style={{ opacity: 0.45 }}>
						Current
					</div>
					<HistoryThreadRow
						thread={currentThread}
						onSelect={() => onClose()}
						onDelete={() => handleDelete(currentThread.id)}
					/>
				</div>
			)}

			{/* Running in void section */}
			{runningThreadIds.length > 0 && (
				<div>
					<div className="px-5 pt-3 pb-1.5 text-xs text-void-fg-3 select-none" style={{ opacity: 0.45 }}>
						Running in void
					</div>
					{runningThreadIds.map(threadId => {
						const thread = allThreads[threadId];
						if (!thread) return null;
						return (
							<HistoryThreadRow
								key={threadId}
								thread={thread}
								onSelect={() => handleSelect(threadId)}
								onDelete={() => handleDelete(threadId)}
							/>
						);
					})}
				</div>
			)}

			{/* Recent in void section */}
			{recentThreadIds.length > 0 && (
				<div>
					<div className="px-5 pt-3 pb-1.5 text-xs text-void-fg-3 select-none" style={{ opacity: 0.45 }}>
						{searchQuery ? 'Search results' : 'Recent in void'}
					</div>
					{recentThreadIds.map(threadId => {
						const thread = allThreads[threadId];
						if (!thread) return null;
						return (
							<HistoryThreadRow
								key={threadId}
								thread={thread}
								onSelect={() => handleSelect(threadId)}
								onDelete={() => handleDelete(threadId)}
							/>
						);
					})}
				</div>
			)}

			{/* Empty state */}
			{filteredThreadIds.length === 0 && (
				<div className="px-5 py-8 text-center text-void-fg-3 text-sm" style={{ opacity: 0.5 }}>
					{searchQuery ? 'No conversations found' : 'No conversations yet'}
				</div>
			)}

			{/* Bottom padding */}
			<div className="h-2" />
		</div>
		</>
	);
};
