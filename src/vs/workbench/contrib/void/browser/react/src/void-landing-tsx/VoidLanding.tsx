/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useState, useEffect } from 'react'
import { useAccessor, useAuthState, useIsDark, useSettingsState } from '../util/services.js'
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js'
import { FolderOpen, GitBranch, Monitor } from 'lucide-react'
import { UsageStats } from '../../../../common/authTypes.js'

const VoidIcon = () => {
	const isDark = useIsDark()
	return (
		<div
			className='@@void-void-icon'
			style={{
				maxWidth: '140px',
				opacity: '50%',
				filter: isDark ? '' : 'invert(1)',
			}}
		/>
	)
}

const ActionCard = ({ icon, title, description, onClick }: {
	icon: React.ReactNode
	title: string
	description: string
	onClick: () => void
}) => (
	<button
		onClick={onClick}
		className="flex flex-col items-center gap-3 p-6 rounded-xl border border-void-border-2 bg-void-bg-2 hover:bg-void-bg-1 hover:border-void-border-4 transition-all duration-200 w-[200px] text-center group"
	>
		<div className="text-void-fg-2 group-hover:text-void-fg-1 transition-colors">
			{icon}
		</div>
		<div className="text-void-fg-1 font-medium text-sm">{title}</div>
		<div className="text-void-fg-3 text-xs">{description}</div>
	</button>
)

const CloneDialog = ({ onClose, onClone }: { onClose: () => void; onClone: (url: string) => void }) => {
	const [url, setUrl] = useState('')

	return (
		<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[99999]" onClick={onClose}>
			<div className="bg-void-bg-3 border border-void-border-2 rounded-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
				<div className="text-lg font-medium text-void-fg-1 mb-4">Clone Repository</div>
				<input
					type="text"
					placeholder="https://github.com/user/repo.git"
					value={url}
					onChange={e => setUrl(e.target.value)}
					className="w-full px-4 py-3 rounded-lg bg-void-bg-2 border border-void-border-2 text-void-fg-1 placeholder-void-fg-3 focus:border-blue-500 focus:outline-none mb-4"
					autoFocus
					onKeyDown={e => { if (e.key === 'Enter' && url) onClone(url) }}
				/>
				<div className="flex gap-3 justify-end">
					<button onClick={onClose} className="px-4 py-2 rounded-lg text-void-fg-3 hover:text-void-fg-1 transition-colors">
						Cancel
					</button>
					<button
						onClick={() => url && onClone(url)}
						disabled={!url}
						className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors disabled:opacity-50"
					>
						Clone
					</button>
				</div>
			</div>
		</div>
	)
}

const UsageBar = ({ usage }: { usage: UsageStats | null }) => {
	if (!usage) return null

	const limit = usage.messagesLimit
	const used = usage.messagesUsedToday
	const isUnlimited = limit === -1
	const percent = isUnlimited ? 0 : Math.min(Math.round((used / limit) * 100), 100)

	return (
		<div className="w-full max-w-xs">
			<div className="flex justify-between text-xs text-void-fg-3 mb-1">
				<span>Messages today</span>
				<span>{used}{isUnlimited ? '' : ` / ${limit}`}</span>
			</div>
			{!isUnlimited && (
				<div className="w-full bg-void-bg-1 rounded-full h-1.5">
					<div
						className={`h-1.5 rounded-full transition-all duration-300 ${percent > 90 ? 'bg-red-500' : percent > 70 ? 'bg-amber-500' : 'bg-blue-500'}`}
						style={{ width: `${percent}%` }}
					/>
				</div>
			)}
		</div>
	)
}

const planLabels: Record<string, string> = {
	free: 'Free',
	pro: 'Pro',
	team: 'Team',
	enterprise: 'Enterprise',
}

export const VoidLanding = () => {
	const authState = useAuthState()
	const settingsState = useSettingsState()
	const isDark = useIsDark()
	const accessor = useAccessor()
	const commandService = accessor.get('ICommandService')
	const workspaceService = accessor.get('IWorkspaceContextService')
	const authService = accessor.get('IVoidAuthService')

	const [showCloneDialog, setShowCloneDialog] = useState(false)
	const [hasWorkspace, setHasWorkspace] = useState(false)
	const [usage, setUsage] = useState<UsageStats | null>(null)

	useEffect(() => {
		const folders = workspaceService.getWorkspace().folders
		setHasWorkspace(folders.length > 0)
	}, [workspaceService])

	useEffect(() => {
		if (authState.isAuthenticated) {
			authService.getUsage().then(u => setUsage(u))
		}
	}, [authState.isAuthenticated, authService])

	const isOnboardingComplete = settingsState.globalSettings.isOnboardingComplete
	const isVisible = authState.isAuthenticated && isOnboardingComplete && !hasWorkspace

	const plan = authState.session?.user?.plan || 'free'
	const planLabel = planLabels[plan] || 'Free'

	return (
		<div className={`@@void-scope ${isDark ? 'dark' : ''}`}>
			<div
				className={`
					bg-void-bg-3 fixed top-0 right-0 bottom-0 left-0 w-full z-[99998]
					transition-all duration-700
					${isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}
				`}
				style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
			>
				<ErrorBoundary>
					<div className="flex flex-col items-center gap-8">
						{/* Logo */}
						<VoidIcon />

						{/* Plan info + usage */}
						<div className="flex flex-col items-center gap-2">
							<div className="flex items-center gap-2 text-sm">
								<span className="px-2 py-0.5 rounded-md bg-void-bg-2 text-void-fg-1 text-xs font-medium">
									{planLabel} Plan
								</span>
								{plan === 'free' && (
									<span className="text-blue-400 text-xs cursor-pointer hover:underline">Upgrade</span>
								)}
							</div>
							<UsageBar usage={usage} />
						</div>

						{/* Action cards */}
						<div className="flex items-stretch gap-4">
							<ActionCard
								icon={<FolderOpen size={32} />}
								title="Open project"
								description="Open an existing folder"
								onClick={() => commandService.executeCommand('workbench.action.files.openFolder')}
							/>
							<ActionCard
								icon={<GitBranch size={32} />}
								title="Clone repo"
								description="Clone a Git repository"
								onClick={() => setShowCloneDialog(true)}
							/>
							<ActionCard
								icon={<Monitor size={32} />}
								title="Connect via SSH"
								description="Remote development"
								onClick={() => commandService.executeCommand('opensshremotes.openEmptyWindow')}
							/>
						</div>

						{/* User email */}
						<div className="text-void-fg-3 text-xs mt-4">
							{authState.session?.user?.email}
						</div>
					</div>

					{showCloneDialog && (
						<CloneDialog
							onClose={() => setShowCloneDialog(false)}
							onClone={(url) => {
								setShowCloneDialog(false)
								commandService.executeCommand('git.clone', url)
							}}
						/>
					)}
				</ErrorBoundary>
			</div>
		</div>
	)
}
