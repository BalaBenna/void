/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useState } from 'react';
import { useAccessor } from '../util/services.js';
import { Brain, Plus, Search, Trash2, X } from 'lucide-react';
import { Memory, MemoryType } from '../../../../common/memoryTypes.js';

const memoryTypeLabels: Record<MemoryType, string> = {
	project_fact: 'Project Fact',
	decision: 'Decision',
	pattern: 'Pattern',
	preference: 'Preference',
};

const memoryTypeColors: Record<MemoryType, string> = {
	project_fact: 'bg-blue-500/20 text-blue-400',
	decision: 'bg-purple-500/20 text-purple-400',
	pattern: 'bg-green-500/20 text-green-400',
	preference: 'bg-yellow-500/20 text-yellow-400',
};

export const MemoryPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
	const accessor = useAccessor();
	const memoryService = accessor.get('IMemoryService');

	const [memories, setMemories] = useState<Memory[]>([]);
	const [searchQuery, setSearchQuery] = useState('');
	const [showAddForm, setShowAddForm] = useState(false);
	const [newMemory, setNewMemory] = useState({ type: 'project_fact' as MemoryType, content: '', context: '', tags: '' });

	const refreshMemories = useCallback(async () => {
		if (searchQuery) {
			setMemories(await memoryService.queryMemories(searchQuery, 50));
		} else {
			setMemories(await memoryService.getAllMemories());
		}
	}, [memoryService, searchQuery]);

	useEffect(() => { refreshMemories(); }, [refreshMemories]);

	const onDelete = useCallback(async (id: string) => {
		await memoryService.removeMemory(id);
		refreshMemories();
	}, [memoryService, refreshMemories]);

	const onAdd = useCallback(async () => {
		if (!newMemory.content.trim()) return;
		await memoryService.addMemory({
			type: newMemory.type,
			content: newMemory.content,
			context: newMemory.context,
			tags: newMemory.tags.split(',').map(t => t.trim()).filter(Boolean),
		});
		setNewMemory({ type: 'project_fact', content: '', context: '', tags: '' });
		setShowAddForm(false);
		refreshMemories();
	}, [memoryService, newMemory, refreshMemories]);

	const onClearAll = useCallback(async () => {
		await memoryService.clearAll();
		refreshMemories();
	}, [memoryService, refreshMemories]);

	return (
		<div className="flex flex-col h-full">
			{/* Header */}
			<div className="flex items-center justify-between px-3 py-2 border-b border-void-border-1">
				<div className="flex items-center gap-2">
					<Brain size={16} className="text-purple-400" />
					<span className="text-sm font-medium text-void-fg-1">Memory</span>
					<span className="text-xs text-void-fg-3 bg-void-bg-2 px-1.5 py-0.5 rounded">{memories.length}</span>
				</div>
				<div className="flex items-center gap-1">
					<button
						className="p-1 rounded text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-2-hover"
						onClick={() => setShowAddForm(v => !v)}
						title="Add memory"
					>
						<Plus size={14} />
					</button>
					<button
						className="p-1 rounded text-void-fg-3 hover:text-red-400 hover:bg-void-bg-2-hover"
						onClick={onClearAll}
						title="Clear all memories"
					>
						<Trash2 size={14} />
					</button>
					<button
						className="p-1 rounded text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-2-hover"
						onClick={onClose}
					>
						<X size={14} />
					</button>
				</div>
			</div>

			{/* Search */}
			<div className="px-3 py-2 border-b border-void-border-1/50">
				<div className="flex items-center gap-2 bg-void-bg-2 rounded px-2 py-1">
					<Search size={14} className="text-void-fg-3 flex-shrink-0" />
					<input
						type="text"
						className="flex-1 bg-transparent text-sm text-void-fg-1 outline-none placeholder-void-fg-3"
						placeholder="Search memories..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
					/>
				</div>
			</div>

			{/* Add form */}
			{showAddForm && (
				<div className="px-3 py-2 border-b border-void-border-1 space-y-2">
					<select
						className="w-full bg-void-bg-2 text-sm text-void-fg-1 rounded px-2 py-1 outline-none"
						value={newMemory.type}
						onChange={(e) => setNewMemory(v => ({ ...v, type: e.target.value as MemoryType }))}
					>
						{Object.entries(memoryTypeLabels).map(([key, label]) => (
							<option key={key} value={key}>{label}</option>
						))}
					</select>
					<textarea
						className="w-full bg-void-bg-2 text-sm text-void-fg-1 rounded px-2 py-1 outline-none resize-none"
						placeholder="Memory content..."
						rows={2}
						value={newMemory.content}
						onChange={(e) => setNewMemory(v => ({ ...v, content: e.target.value }))}
					/>
					<input
						className="w-full bg-void-bg-2 text-sm text-void-fg-1 rounded px-2 py-1 outline-none"
						placeholder="Context (why this was stored)"
						value={newMemory.context}
						onChange={(e) => setNewMemory(v => ({ ...v, context: e.target.value }))}
					/>
					<input
						className="w-full bg-void-bg-2 text-sm text-void-fg-1 rounded px-2 py-1 outline-none"
						placeholder="Tags (comma-separated)"
						value={newMemory.tags}
						onChange={(e) => setNewMemory(v => ({ ...v, tags: e.target.value }))}
					/>
					<div className="flex gap-2">
						<button
							className="text-xs px-3 py-1 rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/30"
							onClick={onAdd}
						>
							Save
						</button>
						<button
							className="text-xs px-3 py-1 rounded text-void-fg-3 hover:text-void-fg-1"
							onClick={() => setShowAddForm(false)}
						>
							Cancel
						</button>
					</div>
				</div>
			)}

			{/* Memory list */}
			<div className="flex-1 overflow-y-auto">
				{memories.length === 0 ? (
					<div className="flex flex-col items-center justify-center h-32 text-void-fg-3">
						<Brain size={24} className="mb-2 opacity-40" />
						<p className="text-xs">No memories yet</p>
					</div>
				) : (
					memories.map((memory) => (
						<div
							key={memory.id}
							className="px-3 py-2 border-b border-void-border-1/50 hover:bg-void-bg-2-hover group"
						>
							<div className="flex items-start justify-between gap-2">
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-1.5 mb-1">
										<span className={`text-[10px] px-1.5 py-0.5 rounded ${memoryTypeColors[memory.type]}`}>
											{memoryTypeLabels[memory.type]}
										</span>
										{memory.tags.map(tag => (
											<span key={tag} className="text-[10px] px-1 py-0.5 rounded bg-void-bg-2 text-void-fg-3">
												{tag}
											</span>
										))}
									</div>
									<p className="text-sm text-void-fg-1 break-words">{memory.content}</p>
									{memory.context && (
										<p className="text-xs text-void-fg-3 mt-0.5">{memory.context}</p>
									)}
									<p className="text-[10px] text-void-fg-3 mt-1 opacity-60">
										{new Date(memory.createdAt).toLocaleDateString()} - accessed {memory.accessCount}x
									</p>
								</div>
								<button
									className="p-1 rounded opacity-0 group-hover:opacity-100 text-void-fg-3 hover:text-red-400 transition-opacity"
									onClick={() => onDelete(memory.id)}
								>
									<Trash2 size={12} />
								</button>
							</div>
						</div>
					))
				)}
			</div>
		</div>
	);
};
