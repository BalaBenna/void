/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { IEditCodeService } from './editCodeServiceInterface.js';
import { roundRangeToLines } from './sidebarActions.js';
import { void_CTRL_K_ACTION_ID } from './actionIDs.js';
import { localize2 } from '../../../../nls.js';
import { IMetricsService } from '../common/metricsService.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IChatThreadService } from './chatThreadService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { void_VIEW_CONTAINER_ID } from './sidebarPane.js';

export type QuickEditPropsType = {
	diffareaid: number,
	textAreaRef: (ref: HTMLTextAreaElement | null) => void;
	onChangeHeight: (height: number) => void;
	onChangeText: (text: string) => void;
	initText: string | null;
}

export type QuickEdit = {
	startLine: number, // 0-indexed
	beforeCode: string,
	afterCode?: string,
	instructions?: string,
	responseText?: string, // model can produce a text response too
}


registerAction2(class extends Action2 {
	constructor(
	) {
		super({
			id: void_CTRL_K_ACTION_ID,
			f1: true,
			title: localize2('voidQuickEditAction', 'void: Quick Edit'),
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyCode.KeyK,
				weight: KeybindingWeight.VoidExtension,
				when: ContextKeyExpr.deserialize('editorFocus && !terminalFocus'),
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {

		const editorService = accessor.get(ICodeEditorService)
		const metricsService = accessor.get(IMetricsService)
		metricsService.capture('Ctrl+K', {})

		const editor = editorService.getActiveCodeEditor()
		if (!editor) return;
		const model = editor.getModel()
		if (!model) return;
		const selection = roundRangeToLines(editor.getSelection(), { emptySelectionBehavior: 'line' })
		if (!selection) return;


		const { startLineNumber: startLine, endLineNumber: endLine } = selection

		const editCodeService = accessor.get(IEditCodeService)
		editCodeService.addCtrlKZone({ startLine, endLine, editor })
	}
});


// Question Mode: Alt+Return opens sidebar chat with selected code as a question (no edits)
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'void.questionModeAction',
			f1: true,
			title: localize2('voidQuestionMode', 'void: Ask About Selection'),
			keybinding: {
				primary: KeyMod.Alt | KeyCode.Enter,
				weight: KeybindingWeight.VoidExtension,
				when: ContextKeyExpr.deserialize('editorFocus && !terminalFocus'),
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(ICodeEditorService)
		const metricsService = accessor.get(IMetricsService)
		const chatThreadService = accessor.get(IChatThreadService)
		const viewsService = accessor.get(IViewsService)

		metricsService.capture('Question Mode', {})

		const editor = editorService.getActiveCodeEditor()
		if (!editor) return
		const model = editor.getModel()
		if (!model) return
		const selection = roundRangeToLines(editor.getSelection(), { emptySelectionBehavior: 'line' })
		if (!selection) return

		// Open sidebar
		if (!viewsService.isViewContainerVisible(void_VIEW_CONTAINER_ID)) {
			viewsService.openViewContainer(void_VIEW_CONTAINER_ID)
		}

		// Add the code selection to chat
		chatThreadService.addNewStagingSelection({
			type: 'CodeSelection',
			uri: model.uri,
			language: model.getLanguageId(),
			range: [selection.startLineNumber, selection.endLineNumber],
			state: { wasAddedAsCurrentFile: false },
		})

		// Focus chat and let user type their question
		await chatThreadService.focusCurrentChat()
	}
});
