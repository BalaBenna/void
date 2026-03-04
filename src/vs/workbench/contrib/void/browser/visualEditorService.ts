/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IVoidSettingsService } from '../common/voidSettingsService.js';


export interface ElementSelection {
	tagName: string;
	className: string;
	sourceFile?: string;
	sourceLine?: number;
	computedStyles: Record<string, string>;
}

export interface IVisualEditorService {
	readonly _serviceBrand: undefined;

	onDidSelectElement: Event<ElementSelection>;

	openPreview(url: string): void;
	closePreview(): void;
	isPreviewOpen(): boolean;
	getPreviewUrl(): string | null;
	selectElement(selection: ElementSelection): void;
}

export const IVisualEditorService = createDecorator<IVisualEditorService>('voidVisualEditorService');


class VisualEditorService extends Disposable implements IVisualEditorService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidSelectElement = new Emitter<ElementSelection>();
	readonly onDidSelectElement: Event<ElementSelection> = this._onDidSelectElement.event;

	private _previewUrl: string | null = null;
	private _isOpen = false;

	constructor(
		@IVoidSettingsService private readonly _settingsService: IVoidSettingsService,
	) {
		super();
	}

	openPreview(url: string): void {
		if (!this._settingsService.state.globalSettings.visualEditorEnabled) return;
		this._previewUrl = url;
		this._isOpen = true;
	}

	closePreview(): void {
		this._previewUrl = null;
		this._isOpen = false;
	}

	isPreviewOpen(): boolean {
		return this._isOpen;
	}

	getPreviewUrl(): string | null {
		return this._previewUrl;
	}

	selectElement(selection: ElementSelection): void {
		this._onDidSelectElement.fire(selection);
	}
}

registerSingleton(IVisualEditorService, VisualEditorService, InstantiationType.Delayed);
