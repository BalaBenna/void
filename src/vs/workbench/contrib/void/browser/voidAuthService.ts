/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { AuthState, AuthSession, AuthStateChangedEvent, UsageStats, defaultAuthState } from '../common/authTypes.js';
import { IvoidSettingsService } from '../common/voidSettingsService.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';

const DEFAULT_BACKEND_URL = 'http://localhost:3456';

export const IvoidAuthService = createDecorator<IvoidAuthService>('voidAuthService');

export interface IvoidAuthService {
	readonly _serviceBrand: undefined;
	readonly state: AuthState;
	readonly onDidChangeAuthState: Event<AuthState>;

	initiateLogin(): Promise<void>;
	logout(): Promise<void>;
	refreshSession(): Promise<void>;
	getUsage(): Promise<UsageStats | null>;
}

class voidAuthService extends Disposable implements IvoidAuthService {
	declare readonly _serviceBrand: undefined;

	private readonly channel: IChannel;
	private _state: AuthState = { ...defaultAuthState };

	private readonly _onDidChangeAuthState = this._register(new Emitter<AuthState>());
	readonly onDidChangeAuthState = this._onDidChangeAuthState.event;

	get state(): AuthState {
		return this._state;
	}

	private get backendUrl(): string {
		return this.voidSettingsService.state.globalSettings.backendUrl || DEFAULT_BACKEND_URL;
	}

	constructor(
		@IMainProcessService private readonly mainProcessService: IMainProcessService,
		@IvoidSettingsService private readonly voidSettingsService: IvoidSettingsService,
		@ILLMMessageService private readonly llmMessageService: ILLMMessageService,
	) {
		super();

		this.channel = this.mainProcessService.getChannel('void-channel-auth');

		// Provide global proxy config for all LLM messages across the app
		this.llmMessageService.registerProxyConfigProvider(() => {
			const authToken = (this._state.isAuthenticated && this._state.session) ? this._state.session.accessToken : '';
			return {
				authToken,
				backendUrl: this.backendUrl,
			};
		});

		// Listen for auth state changes from main process (OAuth callbacks)
		this._register((this.channel.listen('onAuthStateChanged') satisfies Event<AuthStateChangedEvent>)((e) => {
			if (e.session) {
				this._setState({
					isAuthenticated: true,
					session: e.session,
					isLoading: false,
					error: null,
				});
			} else {
				this._setState({
					isAuthenticated: false,
					session: null,
					isLoading: false,
					error: null,
				});
			}
		}));

		// Initialize from stored session (encrypted on disk via safeStorage)
		this._initializeFromStorage();
	}

	private async _initializeFromStorage(): Promise<void> {
		try {
			const result = await this.channel.call('getStoredSession', {}) as { session: AuthSession | null };
			if (result.session) {
				const now = Date.now() / 1000;

				if (result.session.expiresAt > now) {
					// Token still valid
					this._setState({
						isAuthenticated: true,
						session: result.session,
						isLoading: false,
						error: null,
					});
				} else if (result.session.refreshToken) {
					// Token expired, try refresh
					await this.refreshSession();
				} else {
					this._setState({ ...defaultAuthState, isLoading: false });
				}
			} else {
				this._setState({ ...defaultAuthState, isLoading: false });
			}
		} catch {
			this._setState({ ...defaultAuthState, isLoading: false });
		}
	}

	async initiateLogin(): Promise<void> {
		this._setState({ ...this._state, isLoading: true, error: null });

		const result = await this.channel.call('initiateLogin', {
			backendUrl: this.backendUrl,
		}) as { success?: boolean; error?: string };

		if (result.error) {
			this._setState({ ...this._state, isLoading: false, error: result.error });
			return;
		}

		// Login flow continues via OAuth callback -> onAuthStateChanged event
		// Keep isLoading true until the callback fires
	}

	async logout(): Promise<void> {
		const accessToken = this._state.session?.accessToken;
		await this.channel.call('logout', {
			accessToken: accessToken || '',
			backendUrl: this.backendUrl,
		});
		// State will be cleared by the onAuthStateChanged event
	}

	async refreshSession(): Promise<void> {
		const session = this._state.session;
		if (!session?.refreshToken) {
			this._setState({ ...defaultAuthState, isLoading: false });
			return;
		}

		const result = await this.channel.call('refreshToken', {
			refreshToken: session.refreshToken,
			backendUrl: this.backendUrl,
		}) as { session?: AuthSession; error?: string };

		if (result.error) {
			this._setState({ ...defaultAuthState, isLoading: false });
			return;
		}

		// Session will be set by the onAuthStateChanged event fired from the channel
	}

	async getUsage(): Promise<UsageStats | null> {
		const session = this._state.session;
		if (!session?.accessToken) return null;

		const result = await this.channel.call('getUsage', {
			accessToken: session.accessToken,
			backendUrl: this.backendUrl,
		}) as { usage?: UsageStats; error?: string };

		if (result.error) return null;
		return result.usage || null;
	}

	private _setState(state: AuthState): void {
		this._state = state;
		this._onDidChangeAuthState.fire(state);
	}
}

registerSingleton(IvoidAuthService, voidAuthService, InstantiationType.Eager);
