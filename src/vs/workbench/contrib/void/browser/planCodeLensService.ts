/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../base/common/event.js';
import { Range } from '../../../../editor/common/core/range.js';
import { CodeLensList, CodeLensProvider } from '../../../../editor/common/languages.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IChatThreadService } from './chatThreadServiceInterface.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { parseFrontmatter } from '../common/frontmatterParser.js';


const EXECUTE_PLAN_COMMAND_ID = 'void.executePlanFromFile'

class PlanCodeLensService extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'void.planCodeLensService';

	constructor(
		@ILanguageFeaturesService languageFeaturesService: ILanguageFeaturesService,
		@IChatThreadService private readonly _chatThreadService: IChatThreadService,
	) {
		super()

		const onDidChangeCodeLens = this._register(new Emitter<CodeLensProvider>())
		const codeLensProvider: CodeLensProvider = {
			onDidChange: onDidChangeCodeLens.event,
			provideCodeLenses: (model) => this._provideCodeLenses(model),
		}

		this._register(languageFeaturesService.codeLensProvider.register(
			[{ pattern: '**/.void/plans/*.md' }],
			codeLensProvider
		))

		// Register the execute plan command
		this._register(CommandsRegistry.registerCommand(EXECUTE_PLAN_COMMAND_ID, (accessor: ServicesAccessor) => {
			const editorService = accessor.get(IEditorService)
			const chatThreadService = accessor.get(IChatThreadService)
			const activeEditor = editorService.activeEditor
			const uri = activeEditor?.resource
			if (!uri) return

			const mapping = chatThreadService.getPlanFileMapping(uri)
			if (!mapping) return

			chatThreadService.executePlan(mapping.threadId, mapping.planMessageIdx)
		}))
	}

	private _provideCodeLenses(model: ITextModel): CodeLensList | undefined {
		const uri = model.uri
		if (!uri.path.includes('.void/plans/')) return undefined

		// Parse frontmatter to verify this is a valid plan file
		const content = model.getValue()
		const { frontmatter } = parseFrontmatter(content)
		if (!frontmatter.threadId || frontmatter.planMessageIdx === undefined) return undefined

		// Check if plan is still in draft status (executable)
		const mapping = this._chatThreadService.getPlanFileMapping(uri)
		const status = frontmatter.status || 'draft'

		const lenses: CodeLensList = { lenses: [], dispose: () => { } }

		if (status === 'draft' && mapping) {
			lenses.lenses.push({
				range: Range.fromPositions({ lineNumber: 1, column: 1 }),
				command: {
					id: EXECUTE_PLAN_COMMAND_ID,
					title: '$(play) Build',
				},
			})
		} else if (status === 'executing') {
			lenses.lenses.push({
				range: Range.fromPositions({ lineNumber: 1, column: 1 }),
				command: {
					id: '',
					title: '$(loading~spin) Executing...',
				},
			})
		} else if (status === 'completed') {
			lenses.lenses.push({
				range: Range.fromPositions({ lineNumber: 1, column: 1 }),
				command: {
					id: '',
					title: '$(check) Completed',
				},
			})
		}

		return lenses
	}
}

registerWorkbenchContribution2('void.planCodeLens', PlanCodeLensService, WorkbenchPhase.AfterRestored);
