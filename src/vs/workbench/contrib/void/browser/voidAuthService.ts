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
	loginWithEmail(email: string, password: string): Promise<void>;
	signUpWithEmail(email: string, password: string, name: string): Promise<void>;
	continueAsGuest(): void;
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
		// Guest users get undefined so LLM service falls back to direct provider calls
		this.llmMessageService.registerProxyConfigProvider(() => {
			if (this._state.isGuest || !this._state.isAuthenticated || !this._state.session) {
				return undefined as any;
			}
			return {
				authToken: this._state.session.accessToken,
				backendUrl: this.backendUrl,
			};
		});

		// Listen for auth state changes from main process (OAuth callbacks)
		this._register((this.channel.listen('onAuthStateChanged') satisfies Event<AuthStateChangedEvent>)((e) => {
			if (e.session) {
				this._setState({
					isAuthenticated: true,
					isGuest: false,
					session: e.session,
					isLoading: false,
					error: null,
				});
			} else {
				this._setState({
					isAuthenticated: false,
					isGuest: false,
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
						isGuest: false,
						session: result.session,
						isLoading: false,
						error: null,
					});
				} else if (result.session.refreshToken) {
					// Set session in state so refreshSession() can read the refresh token
					this._state = { ...this._state, session: result.session };
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

	async loginWithEmail(email: string, password: string): Promise<void> {
		this._setState({ ...this._state, isLoading: true, error: null });

		const result = await this.channel.call('emailLogin', {
			email,
			password,
			backendUrl: this.backendUrl,
		}) as { success?: boolean; session?: AuthSession; error?: string };

		if (result.error) {
			this._setState({ ...this._state, isLoading: false, error: result.error });
		} else if (result.session) {
			this._setState({
				isAuthenticated: true,
				isGuest: false,
				session: result.session,
				isLoading: false,
				error: null,
			});
		}
	}

	async signUpWithEmail(email: string, password: string, name: string): Promise<void> {
		this._setState({ ...this._state, isLoading: true, error: null });

		const result = await this.channel.call('emailSignup', {
			email,
			password,
			name,
			backendUrl: this.backendUrl,
		}) as { success?: boolean; session?: AuthSession; error?: string };

		if (result.error) {
			this._setState({ ...this._state, isLoading: false, error: result.error });
		} else if (result.session) {
			this._setState({
				isAuthenticated: true,
				isGuest: false,
				session: result.session,
				isLoading: false,
				error: null,
			});
		}
	}

	continueAsGuest(): void {
		this._setState({
			isAuthenticated: false,
			isGuest: true,
			session: null,
			isLoading: false,
			error: null,
		});
	}

	async logout(): Promise<void> {
		const accessToken = this._state.session?.accessToken;
		await this.channel.call('logout', {
			accessToken: accessToken || '',
			backendUrl: this.backendUrl,
		});
		this._setState({
			isAuthenticated: false,
			isGuest: false,
			session: null,
			isLoading: false,
			error: null,
		});
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

		if (result.session) {
			this._setState({
				isAuthenticated: true,
				isGuest: false,
				session: result.session,
				isLoading: false,
				error: null,
			});
		}
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

		// When authenticated, auto-configure providers so models are available
		// The actual API keys live on the backend; sentinel values just enable providers in the UI
		if (state.isAuthenticated && state.session) {
			const settings = this.voidSettingsService.state.settingsOfProvider;
			if (!settings['anthropic']?.apiKey || settings['anthropic']?.apiKey === '') {
				this.voidSettingsService.setSettingOfProvider('anthropic', 'apiKey', 'void-backend-proxy');
			}
			if (!settings['openAI']?.apiKey || settings['openAI']?.apiKey === '') {
				this.voidSettingsService.setSettingOfProvider('openAI', 'apiKey', 'void-backend-proxy');
			}
		}
	}
}

registerSingleton(IvoidAuthService, voidAuthService, InstantiationType.Eager);
