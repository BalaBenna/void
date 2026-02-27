/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ErrorCategory, ErrorClassificationResult } from './errorClassificationTypes.js'

export type HealingStrategy =
	| 'fix_and_retry' | 'install_dependency' | 'skip_and_continue'
	| 'escalate_to_user' | 'adjust_command'

export interface HealingAttempt {
	iteration: number
	strategy: HealingStrategy
	classification: ErrorClassificationResult
	fixDescription: string
	verificationPassed: boolean | null
}

export interface CircuitBreakerState {
	failuresByCategory: Map<ErrorCategory, number>
	consecutiveSameCategory: number
	lastCategory: ErrorCategory | null
	isOpen: boolean
}

export interface SelfHealingConfig {
	enabled: boolean
	maxHealingAttempts: number
	autoReadErrorContext: boolean
	verifyAfterFix: boolean
}

export const defaultSelfHealingConfig: SelfHealingConfig = {
	enabled: true,
	maxHealingAttempts: 3,
	autoReadErrorContext: true,
	verifyAfterFix: true,
}
