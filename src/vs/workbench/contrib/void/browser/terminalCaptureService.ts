/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ITerminalService } from '../../../../workbench/contrib/terminal/browser/terminal.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { errorPatterns } from '../common/errorPatterns.js';
import { ErrorCategory } from '../common/errorClassificationTypes.js';

export interface TerminalError {
	terminalId: string;
	errorText: string;
	fullOutput: string;
	timestamp: number;
	category: ErrorCategory;
}

export interface ITerminalCaptureService {
	readonly _serviceBrand: undefined;
	readonly onDidDetectError: Event<TerminalError>;
	getRecentErrors(): TerminalError[];
	getTerminalBuffer(terminalId: string): string;
}

export const ITerminalCaptureService = createDecorator<ITerminalCaptureService>('terminalCaptureService');

const MAX_BUFFER_LINES = 500;
const MAX_RECENT_ERRORS = 20;
const ERROR_DEBOUNCE_MS = 2000;

class TerminalCaptureService extends Disposable implements ITerminalCaptureService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidDetectError = this._register(new Emitter<TerminalError>());
	readonly onDidDetectError = this._onDidDetectError.event;

	private _buffers: Map<string, string[]> = new Map();
	private _recentErrors: TerminalError[] = [];
	private _lastErrorTime: Map<string, number> = new Map();

	constructor(
		@ITerminalService private readonly _terminalService: ITerminalService,
		@INotificationService private readonly _notificationService: INotificationService,
	) {
		super();

		// Subscribe to existing terminals
		for (const instance of this._terminalService.instances) {
			this._subscribeToTerminal(instance.instanceId.toString());
		}

		// Subscribe to new terminals
		this._register(this._terminalService.onDidCreateInstance(instance => {
			this._subscribeToTerminal(instance.instanceId.toString());
		}));

		// Clean up on terminal disposal
		this._register(this._terminalService.onDidDisposeInstance(instance => {
			this._buffers.delete(instance.instanceId.toString());
			this._lastErrorTime.delete(instance.instanceId.toString());
		}));
	}

	private _subscribeToTerminal(terminalId: string): void {
		if (!this._buffers.has(terminalId)) {
			this._buffers.set(terminalId, []);
		}

		const instance = this._terminalService.instances.find(i => i.instanceId.toString() === terminalId);
		if (!instance) return;

		this._register(instance.onData(data => {
			this._appendToBuffer(terminalId, data);
			this._checkForErrors(terminalId, data);
		}));
	}

	private _appendToBuffer(terminalId: string, data: string): void {
		let buffer = this._buffers.get(terminalId);
		if (!buffer) {
			buffer = [];
			this._buffers.set(terminalId, buffer);
		}

		const lines = data.split('\n');
		buffer.push(...lines);

		// Trim to max buffer size
		if (buffer.length > MAX_BUFFER_LINES) {
			buffer.splice(0, buffer.length - MAX_BUFFER_LINES);
		}
	}

	private _checkForErrors(terminalId: string, data: string): void {
		const now = Date.now();
		const lastError = this._lastErrorTime.get(terminalId) || 0;

		// Debounce error detection
		if (now - lastError < ERROR_DEBOUNCE_MS) return;

		const lines = data.split('\n');

		for (const line of lines) {
			for (const pattern of errorPatterns) {
				const match = line.match(pattern.regex);
				if (!match) continue;

				this._lastErrorTime.set(terminalId, now);

				const buffer = this._buffers.get(terminalId) || [];
				const fullOutput = buffer.slice(-50).join('\n');

				const error: TerminalError = {
					terminalId,
					errorText: line.trim(),
					fullOutput,
					timestamp: now,
					category: pattern.category,
				};

				this._recentErrors.push(error);
				if (this._recentErrors.length > MAX_RECENT_ERRORS) {
					this._recentErrors.shift();
				}

				this._onDidDetectError.fire(error);

				this._notificationService.notify({
					severity: Severity.Info,
					message: `Terminal error detected: ${line.trim().substring(0, 100)}`,
					actions: {
						primary: [{
							id: 'void.fixTerminalError',
							label: 'Fix with Void',
							tooltip: 'Send this error to Void chat for fixing',
							enabled: true,
							class: undefined,
							run: () => {
								// This will be handled by chatThreadService subscribing to onDidDetectError
							},
						}]
					}
				});

				return; // Only report first error per data chunk
			}
		}
	}

	getRecentErrors(): TerminalError[] {
		return [...this._recentErrors];
	}

	getTerminalBuffer(terminalId: string): string {
		const buffer = this._buffers.get(terminalId);
		return buffer ? buffer.join('\n') : '';
	}
}

registerSingleton(ITerminalCaptureService, TerminalCaptureService, InstantiationType.Eager);
