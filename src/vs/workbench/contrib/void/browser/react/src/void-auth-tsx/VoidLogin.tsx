/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useState } from 'react'
import { useAccessor, useAuthState, useIsDark } from '../util/services.js'
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js'

const VoidIcon = () => {
	const isDark = useIsDark()
	return (
		<div
			className='@@void-void-icon'
			style={{
				maxWidth: '180px',
				opacity: '50%',
				filter: isDark ? '' : 'invert(1)',
			}}
		/>
	)
}

export const voidLogin = () => {
	const authState = useAuthState()
	const isDark = useIsDark()
	const accessor = useAccessor()
	const authService = accessor.get('IvoidAuthService')

	const [mode, setMode] = useState<'signin' | 'signup'>('signin')
	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [name, setName] = useState('')

	const isVisible = !authState.isAuthenticated && !authState.isGuest

	const handleEmailSubmit = async () => {
		if (!email || !password) return
		if (mode === 'signup') {
			if (!name) return
			await authService.signUpWithEmail(email, password, name)
		} else {
			await authService.loginWithEmail(email, password)
		}
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter') {
			e.preventDefault()
			handleEmailSubmit()
		}
	}

	return (
		<div className={`@@void-scope ${isDark ? 'dark' : ''}`}>
			<div
				className={`
					bg-void-bg-3 fixed top-0 right-0 bottom-0 left-0 w-full z-[100000]
					transition-all duration-700
					${isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}
				`}
				style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
			>
				<ErrorBoundary>
					<div className="flex flex-col items-center gap-6 w-full max-w-sm px-6">
						{/* Logo */}
						<VoidIcon />

						{/* Tagline */}
						<div className="text-void-fg-3 text-sm text-center">
							The open-source AI code editor
						</div>

						{/* Google OAuth Button */}
						<div className="flex flex-col gap-3 w-full">
							<button
								onClick={() => authService.initiateLogin()}
								disabled={authState.isLoading}
								className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg border border-void-border-2 bg-void-bg-2 hover:bg-void-bg-1 text-void-fg-1 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
							>
								<svg className="w-5 h-5" viewBox="0 0 24 24">
									<path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
									<path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
									<path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
									<path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
								</svg>
								<span className="text-sm font-medium">
									Continue with Google
								</span>
							</button>
						</div>

						{/* Divider */}
						<div className="flex items-center gap-3 w-full">
							<div className="flex-1 h-px bg-void-border-2" />
							<span className="text-void-fg-3 text-xs">or</span>
							<div className="flex-1 h-px bg-void-border-2" />
						</div>

						{/* Email Form */}
						<div className="flex flex-col gap-3 w-full">
							{/* Mode Toggle */}
							<div className="flex gap-1 w-full rounded-lg bg-void-bg-2 p-1">
								<button
									onClick={() => setMode('signin')}
									className={`flex-1 text-xs py-1.5 rounded-md transition-all ${mode === 'signin'
										? 'bg-void-bg-1 text-void-fg-1'
										: 'text-void-fg-3 hover:text-void-fg-2'
									}`}
								>
									Sign In
								</button>
								<button
									onClick={() => setMode('signup')}
									className={`flex-1 text-xs py-1.5 rounded-md transition-all ${mode === 'signup'
										? 'bg-void-bg-1 text-void-fg-1'
										: 'text-void-fg-3 hover:text-void-fg-2'
									}`}
								>
									Sign Up
								</button>
							</div>

							{/* Name (signup only) */}
							{mode === 'signup' && (
								<input
									type="text"
									placeholder="Name"
									value={name}
									onChange={(e) => setName(e.target.value)}
									onKeyDown={handleKeyDown}
									className="w-full px-3 py-2.5 rounded-lg border border-void-border-2 bg-void-bg-2 text-void-fg-1 text-sm placeholder:text-void-fg-3 focus:outline-none focus:border-void-border-1"
								/>
							)}

							<input
								type="email"
								placeholder="Email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								onKeyDown={handleKeyDown}
								className="w-full px-3 py-2.5 rounded-lg border border-void-border-2 bg-void-bg-2 text-void-fg-1 text-sm placeholder:text-void-fg-3 focus:outline-none focus:border-void-border-1"
							/>

							<input
								type="password"
								placeholder="Password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								onKeyDown={handleKeyDown}
								className="w-full px-3 py-2.5 rounded-lg border border-void-border-2 bg-void-bg-2 text-void-fg-1 text-sm placeholder:text-void-fg-3 focus:outline-none focus:border-void-border-1"
							/>

							<button
								onClick={handleEmailSubmit}
								disabled={authState.isLoading || !email || !password || (mode === 'signup' && !name)}
								className="w-full px-4 py-2.5 rounded-lg bg-void-bg-1 hover:opacity-90 text-void-fg-1 text-sm font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed border border-void-border-2"
							>
								{authState.isLoading
									? 'Please wait...'
									: mode === 'signup'
										? 'Create Account'
										: 'Sign In'
								}
							</button>
						</div>

						{/* Error */}
						{authState.error && (
							<div className="text-red-400 text-sm text-center">{authState.error}</div>
						)}

						{/* Continue without signing in */}
						<button
							onClick={() => authService.continueAsGuest()}
							className="text-void-fg-3 text-xs hover:text-void-fg-2 transition-colors underline underline-offset-2"
						>
							Continue without signing in
						</button>

						{/* Footer */}
						<div className="text-void-fg-3 text-xs text-center">
							Sign in to access AI features via Void's servers, or continue with your own API keys
						</div>
					</div>
				</ErrorBoundary>
			</div>
		</div>
	)
}
