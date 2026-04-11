/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { generateUuid } from '../../../../base/common/uuid.js';

import { AmbientFinding, AmbientMonitorType } from '../common/ambientAgentTypes.js';
import { IvoidSettingsService } from '../common/voidSettingsService.js';
import { IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js';


export interface IAmbientAgentService {
	readonly _serviceBrand: undefined;

	readonly onDidFindIssue: Event<AmbientFinding>;
	getRecentFindings(): AmbientFinding[];
	clearFindings(): void;
	isRunning(): boolean;
	start(): void;
	stop(): void;
}

export const IAmbientAgentService = createDecorator<IAmbientAgentService>('voidAmbientAgentService');


class AmbientAgentService extends Disposable implements IAmbientAgentService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidFindIssue = this._register(new Emitter<AmbientFinding>());
	readonly onDidFindIssue: Event<AmbientFinding> = this._onDidFindIssue.event;

	private _findings: AmbientFinding[] = [];
	private _maxFindings = 50;
	private _running = false;
	private _checkTimer: ReturnType<typeof setInterval> | null = null;

	// Track known markers to detect new ones
	private _knownMarkerCount = 0;

	// Debounce to avoid spamming
	private _lastNotificationTime = 0;
	private _notificationCooldownMs = 10_000; // 10s between notifications

	constructor(
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IvoidSettingsService private readonly _settingsService: IvoidSettingsService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IMarkerService private readonly _markerService: IMarkerService,
	) {
		super();

		// Auto-start if enabled
		const config = this._settingsService.state.globalSettings.ambientAgentConfig;
		if (config?.enabled) {
			this.start();
		}

		// Watch for settings changes
		this._register(this._settingsService.onDidChangeState(() => {
			const newConfig = this._settingsService.state.globalSettings.ambientAgentConfig;
			if (newConfig?.enabled && !this._running) {
				this.start();
			} else if (!newConfig?.enabled && this._running) {
				this.stop();
			}
		}));
	}

	isRunning(): boolean {
		return this._running;
	}

	start(): void {
		if (this._running) return;
		this._running = true;

		const config = this._settingsService.state.globalSettings.ambientAgentConfig;
		const intervalMs = config?.checkIntervalMs ?? 30_000;

		// Initialize known marker count
		this._knownMarkerCount = this._getCurrentMarkerCount();

		// Run periodic checks
		this._checkTimer = setInterval(() => {
			this._runChecks();
		}, intervalMs);
	}

	stop(): void {
		this._running = false;
		if (this._checkTimer) {
			clearInterval(this._checkTimer);
			this._checkTimer = null;
		}
	}

	getRecentFindings(): AmbientFinding[] {
		return [...this._findings];
	}

	clearFindings(): void {
		this._findings = [];
	}

	private _getCurrentMarkerCount(): number {
		const markers = this._markerService.read({ severities: MarkerSeverity.Error | MarkerSeverity.Warning });
		return markers.length;
	}

	private _runChecks(): void {
		const config = this._settingsService.state.globalSettings.ambientAgentConfig;
		if (!config?.enabled) return;

		const monitors = config.monitors;

		// Lint monitor: check for new diagnostic markers
		if (monitors.lint) {
			this._checkLintErrors();
		}

		// Security monitor: scan for potential secrets in recent changes
		if (monitors.security) {
			this._checkSecurityIssues();
		}
	}

	private _checkLintErrors(): void {
		const currentCount = this._getCurrentMarkerCount();
		if (currentCount > this._knownMarkerCount) {
			const newErrors = currentCount - this._knownMarkerCount;
			this._addFinding({
				type: 'lint',
				severity: 'warning',
				message: `${newErrors} new lint error${newErrors > 1 ? 's' : ''} detected in your workspace.`,
				suggestion: 'Use read_lint_errors to inspect and fix them.',
			});
		}
		this._knownMarkerCount = currentCount;
	}

	private _checkSecurityIssues(): void {
		// Check for common secret patterns in workspace
		// This is a lightweight check — full scanning would use the embeddings service
		const folders = this._workspaceContextService.getWorkspace().folders;
		if (folders.length === 0) return;

		// Check for .env files that might have been committed
		const _envPatterns = ['.env', '.env.local', '.env.production'];
		// This is a lightweight check — we don't actually read files here
		// The real detection happens via the secret detection service
		void _envPatterns;
	}

	private _addFinding(opts: { type: AmbientMonitorType; severity: AmbientFinding['severity']; message: string; filePath?: string; line?: number; suggestion?: string }): void {
		const finding: AmbientFinding = {
			id: generateUuid(),
			...opts,
			timestamp: Date.now(),
		};

		this._findings.push(finding);
		if (this._findings.length > this._maxFindings) {
			this._findings.shift();
		}

		this._onDidFindIssue.fire(finding);

		// Show notification (debounced)
		const now = Date.now();
		if (now - this._lastNotificationTime > this._notificationCooldownMs) {
			this._lastNotificationTime = now;

			const severity = finding.severity === 'error' ? Severity.Error
				: finding.severity === 'warning' ? Severity.Warning
					: Severity.Info;

			this._notificationService.notify({
				severity,
				message: finding.message,
				actions: {
					primary: [{
						id: 'fix-with-grace',
						label: 'Fix with Grace',
						tooltip: 'Open a chat thread to fix this issue',
						class: undefined,
						enabled: true,
						run: () => {
							// This will be wired to open a chat thread with the issue context
						},
					}],
				},
			});
		}
	}

	override dispose(): void {
		this.stop();
		super.dispose();
	}
}

registerSingleton(IAmbientAgentService, AmbientAgentService, InstantiationType.Delayed);
