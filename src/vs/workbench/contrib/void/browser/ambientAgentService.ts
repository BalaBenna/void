/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { AmbientFinding } from '../common/ambientAgentTypes.js';
import { IVoidSettingsService } from '../common/voidSettingsService.js';


export interface IAmbientAgentService {
	readonly _serviceBrand: undefined;

	onDidFindIssue: Event<AmbientFinding>;

	start(): void;
	stop(): void;
	getFindings(): AmbientFinding[];
	dismissFinding(findingId: string): void;
	isRunning(): boolean;
}

export const IAmbientAgentService = createDecorator<IAmbientAgentService>('voidAmbientAgentService');


class AmbientAgentService extends Disposable implements IAmbientAgentService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidFindIssue = new Emitter<AmbientFinding>();
	readonly onDidFindIssue: Event<AmbientFinding> = this._onDidFindIssue.event;

	private _findings: Map<string, AmbientFinding> = new Map();
	private _running = false;
	private _scanInterval: ReturnType<typeof setInterval> | null = null;

	constructor(
		@IVoidSettingsService private readonly _settingsService: IVoidSettingsService,
	) {
		super();
	}

	start(): void {
		if (this._running) return;
		if (!this._settingsService.state.globalSettings.ambientAgentEnabled) return;

		this._running = true;

		// Periodic scan every 5 minutes
		this._scanInterval = setInterval(() => {
			this._runScan();
		}, 5 * 60 * 1000);
	}

	stop(): void {
		this._running = false;
		if (this._scanInterval) {
			clearInterval(this._scanInterval);
			this._scanInterval = null;
		}
	}

	getFindings(): AmbientFinding[] {
		return Array.from(this._findings.values()).filter(f => !f.dismissed);
	}

	dismissFinding(findingId: string): void {
		const finding = this._findings.get(findingId);
		if (finding) {
			finding.dismissed = true;
		}
	}

	isRunning(): boolean {
		return this._running;
	}

	private _runScan(): void {
		// Placeholder — in a full implementation, this would:
		// 1. Get recently modified files
		// 2. Send them to LLM for analysis
		// 3. Create findings for any issues found
		// For now, this is a no-op that can be extended
	}

	_addFinding(finding: Omit<AmbientFinding, 'id' | 'dismissed' | 'createdAt'>): void {
		const full: AmbientFinding = {
			...finding,
			id: generateUuid(),
			dismissed: false,
			createdAt: Date.now(),
		};
		this._findings.set(full.id, full);
		this._onDidFindIssue.fire(full);
	}

	override dispose(): void {
		this.stop();
		super.dispose();
	}
}

registerSingleton(IAmbientAgentService, AmbientAgentService, InstantiationType.Delayed);
