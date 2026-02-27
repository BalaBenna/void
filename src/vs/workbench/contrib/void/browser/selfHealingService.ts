/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js'
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js'
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js'
import { IFileService } from '../../../../platform/files/common/files.js'
import { URI } from '../../../../base/common/uri.js'
import { ClassifiedError, ErrorClassificationResult } from '../common/errorClassificationTypes.js'
import { HealingStrategy } from '../common/selfHealingTypes.js'

export interface ISelfHealingService {
	readonly _serviceBrand: undefined
	determineStrategy(classification: ErrorClassificationResult): HealingStrategy
	buildErrorContext(errors: ClassifiedError[]): Promise<string>
	generateHealingPrompt(classification: ErrorClassificationResult, fileContext: string, attemptNum: number): string
}

export const ISelfHealingService = createDecorator<ISelfHealingService>('SelfHealingService')

class SelfHealingService extends Disposable implements ISelfHealingService {
	declare readonly _serviceBrand: undefined

	constructor(
		@IFileService private readonly fileService: IFileService,
	) {
		super()
	}

	determineStrategy(classification: ErrorClassificationResult): HealingStrategy {
		const cat = classification.primaryCategory
		switch (cat) {
			case 'compile':
			case 'lint':
			case 'test':
				return 'fix_and_retry'
			case 'dependency':
				return 'install_dependency'
			case 'runtime':
				return 'fix_and_retry'
			case 'environment':
			case 'timeout':
				return 'escalate_to_user'
			default:
				return 'fix_and_retry'
		}
	}

	async buildErrorContext(errors: ClassifiedError[]): Promise<string> {
		// Only process top 3 errors with file locations to control token budget
		const errorsWithFiles = errors
			.filter(e => e.filePath && e.lineNumber)
			.slice(0, 3)

		if (errorsWithFiles.length === 0) return ''

		const contextParts: string[] = []
		const seenFiles = new Set<string>()

		for (const error of errorsWithFiles) {
			if (!error.filePath || !error.lineNumber) continue
			const fileKey = `${error.filePath}:${error.lineNumber}`
			if (seenFiles.has(fileKey)) continue
			seenFiles.add(fileKey)

			try {
				const uri = URI.file(error.filePath)
				const content = await this.fileService.readFile(uri)
				const fileLines = content.value.toString().split('\n')
				const startLine = Math.max(0, error.lineNumber - 11) // ±10 lines
				const endLine = Math.min(fileLines.length, error.lineNumber + 10)
				const contextLines = fileLines.slice(startLine, endLine)
					.map((line, i) => `${startLine + i + 1} | ${line}`)
					.join('\n')

				contextParts.push(`Source context for ${error.filePath} (lines ${startLine + 1}-${endLine}):\n${contextLines}`)
			} catch {
				// File doesn't exist or can't be read — skip
			}
		}

		return contextParts.join('\n\n')
	}

	generateHealingPrompt(classification: ErrorClassificationResult, fileContext: string, attemptNum: number): string {
		const strategy = this.determineStrategy(classification)
		const maxAttempts = 3

		const errorList = classification.errors
			.slice(0, 5)
			.map((e, i) => {
				const loc = e.filePath ? ` ${e.filePath}${e.lineNumber ? `:${e.lineNumber}` : ''}` : ''
				return `${i + 1}. [${e.category}]${loc} - ${e.message}`
			})
			.join('\n')

		const parts: string[] = []
		parts.push(`The command "${classification.command}" failed.`)
		parts.push(`Error type: ${classification.primaryCategory ?? 'unknown'}`)
		parts.push(`Errors found:\n${errorList}`)

		if (fileContext) {
			parts.push(`\n${fileContext}`)
		}

		if (strategy === 'install_dependency') {
			parts.push(`\nSuggested strategy: install the missing dependency first, then retry.`)
		} else if (strategy === 'escalate_to_user') {
			parts.push(`\nThis appears to be an environment issue. Consider asking the user for help.`)
		}

		parts.push(`\nThis is healing attempt ${attemptNum + 1}/${maxAttempts}. Fix the root cause and re-run the command.`)

		return parts.join('\n')
	}
}

registerSingleton(ISelfHealingService, SelfHealingService, InstantiationType.Eager)
