/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';

import { VisualInspectResult } from '../common/visualEditorTypes.js';
import { IEmbeddingsService } from './embeddingsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';


export interface IVisualEditorService {
	readonly _serviceBrand: undefined;

	readonly onDidInspectElement: Event<VisualInspectResult>;

	/**
	 * Enable/disable visual inspect mode.
	 */
	setInspectMode(enabled: boolean): void;

	/**
	 * Process a DOM element inspection and find the source component.
	 */
	inspectElement(elementInfo: { tag: string; text: string; classes: string[]; domPath: string }): Promise<VisualInspectResult>;

	/**
	 * Navigate to the source file and line of a visual element.
	 */
	navigateToSource(result: VisualInspectResult): Promise<void>;
}

export const IVisualEditorService = createDecorator<IVisualEditorService>('voidVisualEditorService');


class VisualEditorService extends Disposable implements IVisualEditorService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidInspectElement = this._register(new Emitter<VisualInspectResult>());
	readonly onDidInspectElement: Event<VisualInspectResult> = this._onDidInspectElement.event;

	private _inspectMode = false;

	constructor(
		@IEmbeddingsService private readonly _embeddingsService: IEmbeddingsService,
		@IEditorService private readonly _editorService: IEditorService,
	) {
		super();
	}

	setInspectMode(enabled: boolean): void {
		this._inspectMode = enabled;
	}

	async inspectElement(elementInfo: { tag: string; text: string; classes: string[]; domPath: string }): Promise<VisualInspectResult> {
		if (!this._inspectMode) {
			return { elementTag: elementInfo.tag, elementText: elementInfo.text, cssClasses: elementInfo.classes, domPath: elementInfo.domPath, sourceFile: null, sourceLine: null, componentName: null };
		}
		// Build search query from element info
		const searchTerms: string[] = [];

		// Extract component name from class names (e.g., "LoginButton" from CSS classes)
		for (const cls of elementInfo.classes) {
			// Skip utility classes (tailwind, etc.)
			if (cls.length > 3 && !cls.includes('-') && /[A-Z]/.test(cls)) {
				searchTerms.push(cls);
			}
		}

		// Add element text for content matching
		if (elementInfo.text && elementInfo.text.length < 100) {
			searchTerms.push(elementInfo.text);
		}

		// Add tag name
		searchTerms.push(elementInfo.tag);

		// Search the codebase
		const query = searchTerms.join(' ');
		const results = this._embeddingsService.search(query, null, 5);

		let sourceFile: URI | null = null;
		let sourceLine: number | null = null;
		let componentName: string | null = null;

		if (results.length > 0) {
			const topResult = results[0];
			sourceFile = topResult.uri;
			sourceLine = topResult.startLine;
			componentName = topResult.symbolName;
		}

		const inspectResult: VisualInspectResult = {
			elementTag: elementInfo.tag,
			elementText: elementInfo.text,
			cssClasses: elementInfo.classes,
			domPath: elementInfo.domPath,
			sourceFile,
			sourceLine,
			componentName,
		};

		this._onDidInspectElement.fire(inspectResult);
		return inspectResult;
	}

	async navigateToSource(result: VisualInspectResult): Promise<void> {
		if (!result.sourceFile) return;

		await this._editorService.openEditor({
			resource: result.sourceFile,
			options: {
				selection: result.sourceLine ? {
					startLineNumber: result.sourceLine,
					startColumn: 1,
					endLineNumber: result.sourceLine,
					endColumn: 1,
				} : undefined,
			},
		});
	}
}

registerSingleton(IVisualEditorService, VisualEditorService, InstantiationType.Delayed);
