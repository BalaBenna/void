/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export type ErrorCategory =
	| 'compile' | 'runtime' | 'test' | 'lint'
	| 'dependency' | 'environment' | 'timeout' | 'unknown'

export type ErrorSeverity = 'fatal' | 'error' | 'warning' | 'info'

export interface ClassifiedError {
	category: ErrorCategory
	severity: ErrorSeverity
	message: string
	filePath: string | null
	lineNumber: number | null
	columnNumber: number | null
	rawOutput: string
	stackTrace: string | null
	exitCode: number | null
	suggestion: string | null
}

export interface ErrorClassificationResult {
	hasErrors: boolean
	errors: ClassifiedError[]
	primaryCategory: ErrorCategory | null
	summary: string
	command: string
}

export interface ErrorPattern {
	regex: RegExp
	category: ErrorCategory
	severity: ErrorSeverity
	extractFilePath?: (match: RegExpMatchArray) => string | null
	extractLineNumber?: (match: RegExpMatchArray) => number | null
	extractColumnNumber?: (match: RegExpMatchArray) => number | null
	extractMessage?: (match: RegExpMatchArray) => string
}
