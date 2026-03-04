/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { IServerChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { AuthSession, AuthStateChangedEvent, AuthUser, UsageStats } from '../common/authTypes.js';
import { app, shell, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export type OAuthCallbackParams = {
	token: string
	refreshToken: string
	expiresAt: number
	user: AuthUser
}

type InitiateLoginParams = { backendUrl: string }
type RefreshTokenParams = { refreshToken: string; backendUrl: string }
type GetUserParams = { accessToken: string; backendUrl: string }
type GetUsageParams = { accessToken: string; backendUrl: string }
type LogoutParams = { accessToken: string; backendUrl: string }
type GetStoredSessionParams = {}

export class AuthChannel implements IServerChannel {

	private readonly _onAuthStateChanged = new Emitter<AuthStateChangedEvent>()

	private readonly authFilePath: string

	constructor() {
		this.authFilePath = path.join(app.getPath('userData'), '.void-auth.enc')
	}

	listen(_: unknown, event: string): Event<any> {
		if (event === 'onAuthStateChanged') return this._onAuthStateChanged.event
		throw new Error(`AuthChannel: Event not found: ${event}`)
	}

	async call(_: unknown, command: string, params: any): Promise<any> {
		try {
			if (command === 'initiateLogin') return await this._initiateLogin(params)
			if (command === 'refreshToken') return await this._refreshToken(params)
			if (command === 'getUser') return await this._getUser(params)
			if (command === 'getUsage') return await this._getUsage(params)
			if (command === 'logout') return await this._logout(params)
			if (command === 'getStoredSession') return await this._getStoredSession(params)
			throw new Error(`AuthChannel: command "${command}" not recognized.`)
		} catch (e: any) {
			console.error('AuthChannel call error:', e)
			return { error: e.message || 'Unknown error' }
		}
	}

	// Called by the protocol handler when void://auth/callback is received
	handleOAuthCallback(params: OAuthCallbackParams) {
		const { token, refreshToken, expiresAt, user } = params

		const session: AuthSession = {
			accessToken: token,
			refreshToken,
			expiresAt,
			user,
		}

		// Persist session to encrypted file
		this._storeSession(session)

		// Fire event to browser process
		this._onAuthStateChanged.fire({ session })
	}

	private async _initiateLogin(params: InitiateLoginParams): Promise<{ success: boolean } | { error: string }> {
		const { backendUrl } = params
		try {
			// Open system browser to Google OAuth endpoint
			await shell.openExternal(`${backendUrl}/auth/google?source=desktop`)
			return { success: true }
		} catch (e: any) {
			return { error: e.message || 'Failed to open browser' }
		}
	}

	private async _refreshToken(params: RefreshTokenParams): Promise<{ session: AuthSession } | { error: string }> {
		const { refreshToken, backendUrl } = params
		try {
			const response = await fetch(`${backendUrl}/auth/refresh`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ refreshToken }),
			})

			const data = await response.json()
			if (!response.ok) return { error: data.error || 'Token refresh failed' }

			const session: AuthSession = {
				accessToken: data.token,
				refreshToken: data.refreshToken,
				expiresAt: data.expiresAt ?? Math.floor(Date.now() / 1000) + 3600,
				user: data.user as AuthUser,
			}

			this._storeSession(session)
			this._onAuthStateChanged.fire({ session })
			return { session }
		} catch (e: any) {
			return { error: e.message || 'Network error' }
		}
	}

	private async _getUser(params: GetUserParams): Promise<{ user: AuthUser } | { error: string }> {
		const { accessToken, backendUrl } = params
		try {
			const response = await fetch(`${backendUrl}/v1/user/me`, {
				headers: { Authorization: `Bearer ${accessToken}` },
			})

			const data = await response.json()
			if (!response.ok) return { error: data.error || 'Failed to get user' }

			return { user: data as AuthUser }
		} catch (e: any) {
			return { error: e.message || 'Network error' }
		}
	}

	private async _getUsage(params: GetUsageParams): Promise<{ usage: UsageStats } | { error: string }> {
		const { accessToken, backendUrl } = params
		try {
			const response = await fetch(`${backendUrl}/v1/user/usage`, {
				headers: { Authorization: `Bearer ${accessToken}` },
			})

			const data = await response.json()
			if (!response.ok) return { error: data.error || 'Failed to get usage' }

			return { usage: data as UsageStats }
		} catch (e: any) {
			return { error: e.message || 'Network error' }
		}
	}

	private async _logout(params: LogoutParams): Promise<void> {
		const { accessToken, backendUrl } = params
		try {
			await fetch(`${backendUrl}/auth/logout`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${accessToken}`,
				},
			})
		} catch {
			// Best-effort logout on server
		}

		this._clearStoredSession()
		this._onAuthStateChanged.fire({ session: null })
	}

	private async _getStoredSession(_params: GetStoredSessionParams): Promise<{ session: AuthSession | null }> {
		const session = this._loadSession()
		return { session }
	}

	// ── Encrypted token storage via Electron safeStorage ──

	private _storeSession(session: AuthSession): void {
		try {
			const json = JSON.stringify(session)
			if (safeStorage.isEncryptionAvailable()) {
				const encrypted = safeStorage.encryptString(json)
				fs.writeFileSync(this.authFilePath, encrypted)
			} else {
				// Fallback to plain JSON if encryption unavailable
				fs.writeFileSync(this.authFilePath, json, 'utf-8')
			}
		} catch (e) {
			console.error('Failed to store auth session:', e)
		}
	}

	private _loadSession(): AuthSession | null {
		try {
			if (!fs.existsSync(this.authFilePath)) return null

			if (safeStorage.isEncryptionAvailable()) {
				const encrypted = fs.readFileSync(this.authFilePath)
				const json = safeStorage.decryptString(encrypted)
				return JSON.parse(json) as AuthSession
			} else {
				const json = fs.readFileSync(this.authFilePath, 'utf-8')
				return JSON.parse(json) as AuthSession
			}
		} catch (e) {
			console.error('Failed to load auth session:', e)
			return null
		}
	}

	private _clearStoredSession(): void {
		try {
			if (fs.existsSync(this.authFilePath)) {
				fs.unlinkSync(this.authFilePath)
			}
		} catch (e) {
			console.error('Failed to clear auth session:', e)
		}
	}
}
