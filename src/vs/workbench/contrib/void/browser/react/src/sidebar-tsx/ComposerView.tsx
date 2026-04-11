/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback } from 'react';
import { useAccessor, useCommandBarState } from '../util/services.js';
import { Check, ChevronRight, File, FilePlus, FileX, X } from 'lucide-react';
import { getBasename } from './SidebarChat.js';

export const ComposerView: React.FC = () => {
	const accessor = useAccessor();
	const commandBarState = useCommandBarState();
	const commandBarService = accessor.get('IvoidCommandBarService');

	const sortedURIs = commandBarState.sortedURIs;
	const stateOfURI = commandBarState.stateOfURI;

	const onAcceptAll = useCallback(() => {
		commandBarService.acceptOrRejectAllFiles({ behavior: 'accept' });
	}, [commandBarService]);

	const onRejectAll = useCallback(() => {
		commandBarService.acceptOrRejectAllFiles({ behavior: 'reject' });
	}, [commandBarService]);

	const onGoToFile = useCallback(async (idx: number) => {
		await commandBarService.goToURIIdx(idx);
	}, [commandBarService]);

	if (sortedURIs.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center h-full text-void-fg-3 p-4">
				<File size={32} className="mb-2 opacity-40" />
				<p className="text-sm">No file changes yet</p>
				<p className="text-xs opacity-60 mt-1">Changes will appear here as the agent edits files</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col h-full">
			{/* Header with actions */}
			<div className="flex items-center justify-between px-3 py-2 border-b border-void-border-1">
				<div className="flex items-center gap-2">
					<span className="text-sm font-medium text-void-fg-1">
						Changes
					</span>
					<span className="text-xs text-void-fg-3 bg-void-bg-2 px-1.5 py-0.5 rounded">
						{sortedURIs.length} file{sortedURIs.length !== 1 ? 's' : ''}
					</span>
				</div>
				<div className="flex items-center gap-1">
					<button
						className="text-xs px-2 py-1 rounded bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors"
						onClick={onAcceptAll}
						title="Accept all changes"
					>
						<Check size={12} className="inline mr-1" />
						Accept All
					</button>
					<button
						className="text-xs px-2 py-1 rounded bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors"
						onClick={onRejectAll}
						title="Reject all changes"
					>
						<X size={12} className="inline mr-1" />
						Reject All
					</button>
				</div>
			</div>

			{/* File list */}
			<div className="flex-1 overflow-y-auto">
				{sortedURIs.map((uri, idx) => {
					const state = stateOfURI[uri.toString()];
					const streamState = commandBarService.getStreamState(uri);
					const isStreaming = streamState === 'streaming';
					const hasChanges = streamState === 'idle-has-changes';
					const basename = getBasename(uri.fsPath, 1);
					const folderPath = uri.fsPath.split('/').slice(-3, -1).join('/');
					const diffCount = state?.sortedDiffIds?.length ?? 0;

					return (
						<div
							key={uri.toString()}
							className="flex items-center justify-between px-3 py-2 hover:bg-void-bg-2-hover cursor-pointer border-b border-void-border-1/50 transition-colors"
							onClick={() => onGoToFile(idx)}
						>
							<div className="flex items-center gap-2 min-w-0">
								<FileChangeIcon isStreaming={isStreaming} hasChanges={hasChanges} />
								<div className="flex flex-col min-w-0">
									<span className="text-sm text-void-fg-1 truncate">{basename}</span>
									<span className="text-xs text-void-fg-3 truncate">{folderPath}</span>
								</div>
							</div>
							<div className="flex items-center gap-2 flex-shrink-0">
								{diffCount > 0 && (
									<span className="text-xs text-void-fg-3 bg-void-bg-2 px-1.5 py-0.5 rounded">
										{diffCount} diff{diffCount !== 1 ? 's' : ''}
									</span>
								)}
								{isStreaming && (
									<span className="text-xs text-blue-400 animate-pulse">streaming</span>
								)}
								<ChevronRight size={14} className="text-void-fg-3" />
							</div>
						</div>
					);
				})}
			</div>

			{/* Summary footer */}
			<div className="px-3 py-2 border-t border-void-border-1 text-xs text-void-fg-3">
				{sortedURIs.length} file{sortedURIs.length !== 1 ? 's' : ''} modified
				{commandBarService.anyFileIsStreaming() && ' (streaming...)'}
			</div>
		</div>
	);
};

const FileChangeIcon: React.FC<{ isStreaming: boolean; hasChanges: boolean }> = ({ isStreaming, hasChanges }) => {
	if (isStreaming) {
		return <FilePlus size={16} className="text-blue-400 flex-shrink-0" />;
	}
	if (hasChanges) {
		return <File size={16} className="text-yellow-400 flex-shrink-0" />;
	}
	return <FileX size={16} className="text-void-fg-3 flex-shrink-0" />;
};
