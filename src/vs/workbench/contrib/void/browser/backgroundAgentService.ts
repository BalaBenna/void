/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { generateUuid } from '../../../../base/common/uuid.js';

import { BackgroundAgent, BackgroundAgentStore } from '../common/backgroundAgentTypes.js';
import { IvoidSettingsService } from '../common/voidSettingsService.js';
import { IChatThreadService } from './chatThreadService.js';


export interface IBackgroundAgentService {
	readonly _serviceBrand: undefined;

	/** Fires when any agent's state changes (added, status change, reviewed) */
	onDidChangeAgents: Event<void>;

	/** Launch a new background agent that survives editor restarts */
	launchAgent(prompt: string): Promise<BackgroundAgent>;

	/** Cancel a running background agent */
	cancelAgent(agentId: string): Promise<void>;

	/** Mark an agent's result as reviewed */
	markReviewed(agentId: string): Promise<void>;

	/** Remove an agent from the store */
	removeAgent(agentId: string): Promise<void>;

	/** Get all background agents */
	getAllAgents(): BackgroundAgent[];

	/** Get agents pending review (completed but not yet reviewed) */
	getPendingReviewAgents(): BackgroundAgent[];

	/** Get a specific agent by ID */
	getAgent(agentId: string): BackgroundAgent | undefined;

	/** Get count of unreviewed completed agents (for sidebar badge) */
	getUnreviewedCount(): number;
}

export const IBackgroundAgentService = createDecorator<IBackgroundAgentService>('voidBackgroundAgentService');

class BackgroundAgentService extends Disposable implements IBackgroundAgentService {
	declare readonly _serviceBrand: undefined;

	private _agents: Map<string, BackgroundAgent> = new Map();
	private _storeLoaded = false;

	private readonly _onDidChangeAgents = this._register(new Emitter<void>());
	readonly onDidChangeAgents: Event<void> = this._onDidChangeAgents.event;

	constructor(
		@IvoidSettingsService private readonly _settingsService: IvoidSettingsService,
		@IChatThreadService private readonly _chatThreadService: IChatThreadService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IFileService private readonly _fileService: IFileService,
	) {
		super();
		this._loadStore().catch(() => { /* ignore load errors on startup */ });
	}

	private _getStorePath(): URI | null {
		const folders = this._workspaceContextService.getWorkspace().folders;
		if (folders.length === 0) return null;
		return URI.joinPath(folders[0].uri, '.void', 'background-agents.json');
	}

	private async _loadStore(): Promise<void> {
		if (this._storeLoaded) return;

		const storePath = this._getStorePath();
		if (!storePath) return;

		try {
			const exists = await this._fileService.exists(storePath);
			if (!exists) {
				this._storeLoaded = true;
				return;
			}
			const content = await this._fileService.readFile(storePath);
			const store: BackgroundAgentStore = JSON.parse(content.value.toString());
			if (store.version === 1 && Array.isArray(store.agents)) {
				for (const agent of store.agents) {
					// Mark any previously-running agents as failed (they didn't survive restart)
					if (agent.status === 'running' || agent.status === 'pending') {
						agent.status = 'failed';
						agent.error = 'Agent was interrupted by editor restart.';
						agent.completedAt = Date.now();
					}
					this._agents.set(agent.id, agent);
				}
			}
		} catch {
			// Corrupted or missing store — start fresh
		}

		this._storeLoaded = true;
		this._onDidChangeAgents.fire();
	}

	private async _saveStore(): Promise<void> {
		const storePath = this._getStorePath();
		if (!storePath) return;

		const store: BackgroundAgentStore = {
			version: 1,
			agents: Array.from(this._agents.values()),
		};

		try {
			await this._fileService.writeFile(storePath, VSBuffer.fromString(JSON.stringify(store, null, 2)));
		} catch {
			// Silently fail — non-critical persistence
		}
	}

	async launchAgent(prompt: string): Promise<BackgroundAgent> {
		await this._loadStore();

		const config = this._settingsService.state.globalSettings.backgroundAgentConfig;

		if (!config.enabled) {
			const agent: BackgroundAgent = {
				id: generateUuid(),
				prompt,
				status: 'failed',
				error: 'Background agents are disabled in settings.',
				createdAt: Date.now(),
				threadId: '',
				reviewed: false,
			};
			this._agents.set(agent.id, agent);
			this._onDidChangeAgents.fire();
			await this._saveStore();
			return agent;
		}

		// Check max concurrent
		const runningCount = Array.from(this._agents.values()).filter(a => a.status === 'running').length;
		if (runningCount >= config.maxBackgroundAgents) {
			const agent: BackgroundAgent = {
				id: generateUuid(),
				prompt,
				status: 'failed',
				error: `Max background agents (${config.maxBackgroundAgents}) reached. Wait for a running agent to complete.`,
				createdAt: Date.now(),
				threadId: '',
				reviewed: false,
			};
			this._agents.set(agent.id, agent);
			this._onDidChangeAgents.fire();
			await this._saveStore();
			return agent;
		}

		const agent: BackgroundAgent = {
			id: generateUuid(),
			prompt,
			status: 'running',
			createdAt: Date.now(),
			startedAt: Date.now(),
			threadId: '', // will be set by the hidden thread
			reviewed: false,
		};
		this._agents.set(agent.id, agent);
		this._onDidChangeAgents.fire();
		await this._saveStore();

		// Fire and voidt — the agent runs in the background
		this._runAgent(agent).catch(() => { /* handled inside _runAgent */ });

		return agent;
	}

	private async _runAgent(agent: BackgroundAgent): Promise<void> {
		try {
			const { result, status } = await this._chatThreadService.runSubagentThread({
				prompt: agent.prompt,
				chatModeOverride: 'agent',
				maxIterations: 50,
				timeoutMs: 600_000, // 10 minute timeout for background agents
			});

			agent.status = status;
			agent.result = result;
			agent.completedAt = Date.now();
		} catch (e) {
			agent.status = 'failed';
			agent.error = `Background agent error: ${e}`;
			agent.completedAt = Date.now();
		}

		this._onDidChangeAgents.fire();
		await this._saveStore();

		// Notify user if configured
		const config = this._settingsService.state.globalSettings.backgroundAgentConfig;
		if (config.notifyOnCompletion) {
			if (agent.status === 'completed') {
				this._notificationService.notify({
					severity: Severity.Info,
					message: `Background agent completed: "${agent.prompt.substring(0, 60)}${agent.prompt.length > 60 ? '...' : ''}"`,
				});
			} else if (agent.status === 'failed') {
				this._notificationService.notify({
					severity: Severity.Warning,
					message: `Background agent failed: "${agent.prompt.substring(0, 60)}${agent.prompt.length > 60 ? '...' : ''}"`,
				});
			}
		}
	}

	async cancelAgent(agentId: string): Promise<void> {
		const agent = this._agents.get(agentId);
		if (!agent || agent.status !== 'running') return;

		agent.status = 'cancelled';
		agent.completedAt = Date.now();
		agent.error = 'Cancelled by user.';

		this._onDidChangeAgents.fire();
		await this._saveStore();
	}

	async markReviewed(agentId: string): Promise<void> {
		const agent = this._agents.get(agentId);
		if (!agent) return;

		agent.reviewed = true;
		this._onDidChangeAgents.fire();
		await this._saveStore();
	}

	async removeAgent(agentId: string): Promise<void> {
		this._agents.delete(agentId);
		this._onDidChangeAgents.fire();
		await this._saveStore();
	}

	getAllAgents(): BackgroundAgent[] {
		return Array.from(this._agents.values()).sort((a, b) => b.createdAt - a.createdAt);
	}

	getPendingReviewAgents(): BackgroundAgent[] {
		return this.getAllAgents().filter(a => a.status === 'completed' && !a.reviewed);
	}

	getAgent(agentId: string): BackgroundAgent | undefined {
		return this._agents.get(agentId);
	}

	getUnreviewedCount(): number {
		return Array.from(this._agents.values()).filter(a => a.status === 'completed' && !a.reviewed).length;
	}
}

registerSingleton(IBackgroundAgentService, BackgroundAgentService, InstantiationType.Delayed);
