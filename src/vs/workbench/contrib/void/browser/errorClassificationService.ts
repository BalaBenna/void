/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js'
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js'
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js'
import { ClassifiedError, ErrorCategory, ErrorClassificationResult } from '../common/errorClassificationTypes.js'
import { errorPatterns } from '../common/errorPatterns.js'
import { TerminalResolveReason } from '../common/toolsServiceTypes.js'

export interface IErrorClassificationService {
	readonly _serviceBrand: undefined
	classifyOutput(output: string, command: string, resolveReason: TerminalResolveReason): ErrorClassificationResult
}

export const IErrorClassificationService = createDecorator<IErrorClassificationService>('ErrorClassificationService')

class ErrorClassificationService extends Disposable implements IErrorClassificationService {
	declare readonly _serviceBrand: undefined

	constructor() {
		super()
	}

	classifyOutput(output: string, command: string, resolveReason: TerminalResolveReason): ErrorClassificationResult {
		const exitCode = resolveReason.type === 'done' ? resolveReason.exitCode : null
		const errors: ClassifiedError[] = []
		const lines = output.split('\n')

		for (const line of lines) {
			for (const pattern of errorPatterns) {
				const match = line.match(pattern.regex)
				if (!match) continue

				const error: ClassifiedError = {
					category: pattern.category,
					severity: pattern.severity,
					message: pattern.extractMessage ? pattern.extractMessage(match) : match[0],
					filePath: pattern.extractFilePath ? pattern.extractFilePath(match) : null,
					lineNumber: pattern.extractLineNumber ? pattern.extractLineNumber(match) : null,
					columnNumber: pattern.extractColumnNumber ? pattern.extractColumnNumber(match) : null,
					rawOutput: line,
					stackTrace: null,
					exitCode,
					suggestion: null,
				}

				// Deduplicate: skip if same file+line+category already recorded
				const isDupe = errors.some(e =>
					e.filePath === error.filePath &&
					e.lineNumber === error.lineNumber &&
					e.category === error.category &&
					e.message === error.message
				)
				if (!isDupe) {
					errors.push(error)
				}

				break // one pattern match per line
			}
		}

		// Also detect semantic errors when exit code is 0
		if (exitCode === 0) {
			const semanticErrors = this._detectSemanticErrors(output)
			for (const se of semanticErrors) {
				const isDupe = errors.some(e => e.message === se.message && e.category === se.category)
				if (!isDupe) errors.push(se)
			}
		}

		const hasErrors = errors.length > 0 || (exitCode !== null && exitCode !== 0)
		const primaryCategory = this._determinePrimaryCategory(errors)
		const summary = this._buildSummary(errors, command, exitCode)

		return { hasErrors, errors, primaryCategory, summary, command }
	}

	private _detectSemanticErrors(output: string): ClassifiedError[] {
		const errors: ClassifiedError[] = []

		// Test failures that might exit 0
		if (/\d+ failing/i.test(output) || /Tests:\s+\d+ failed/i.test(output)) {
			errors.push({
				category: 'test',
				severity: 'error',
				message: 'Tests reported failures despite exit code 0',
				filePath: null,
				lineNumber: null,
				columnNumber: null,
				rawOutput: output.substring(0, 200),
				stackTrace: null,
				exitCode: 0,
				suggestion: 'Check test output for failures',
			})
		}

		// Warnings treated as potential issues
		if (/warning:/i.test(output) && /error:/i.test(output)) {
			errors.push({
				category: 'compile',
				severity: 'warning',
				message: 'Output contains errors despite exit code 0',
				filePath: null,
				lineNumber: null,
				columnNumber: null,
				rawOutput: output.substring(0, 200),
				stackTrace: null,
				exitCode: 0,
				suggestion: null,
			})
		}

		return errors
	}

	private _determinePrimaryCategory(errors: ClassifiedError[]): ErrorCategory | null {
		if (errors.length === 0) return null

		// Priority order
		const priority: ErrorCategory[] = ['compile', 'dependency', 'test', 'runtime', 'lint', 'environment', 'timeout', 'unknown']
		const categories = new Set(errors.map(e => e.category))

		for (const cat of priority) {
			if (categories.has(cat)) return cat
		}
		return errors[0].category
	}

	private _buildSummary(errors: ClassifiedError[], command: string, exitCode: number | null): string {
		if (errors.length === 0) {
			if (exitCode !== null && exitCode !== 0) {
				return `Command "${command}" failed with exit code ${exitCode} (no specific errors identified)`
			}
			return `Command "${command}" completed successfully`
		}

		const categoryCountMap = new Map<ErrorCategory, number>()
		for (const e of errors) {
			categoryCountMap.set(e.category, (categoryCountMap.get(e.category) ?? 0) + 1)
		}

		const parts: string[] = []
		for (const [cat, count] of categoryCountMap) {
			parts.push(`${count} ${cat} error${count > 1 ? 's' : ''}`)
		}

		return `Command "${command}" failed with ${parts.join(', ')}`
	}
}

registerSingleton(IErrorClassificationService, ErrorClassificationService, InstantiationType.Eager)
