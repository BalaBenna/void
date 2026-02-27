/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export interface VerificationStep {
	name: string
	command: string
	optional: boolean
	timeout: number // seconds
}

export interface VerificationResult {
	step: VerificationStep
	passed: boolean
	output: string
	exitCode: number | null
	durationMs: number
}

export interface PipelineResult {
	allPassed: boolean
	results: VerificationResult[]
	firstFailure: VerificationResult | null
}

export interface VerificationPipelineConfig {
	enabled: boolean
	steps: VerificationStep[]
	stopOnFirstFailure: boolean
}

export const defaultVerificationPipelineConfig: VerificationPipelineConfig = {
	enabled: false,
	steps: [],
	stopOnFirstFailure: true,
}
