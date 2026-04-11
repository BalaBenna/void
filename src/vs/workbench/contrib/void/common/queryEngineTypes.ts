/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ModelSelection, ChatMode } from './voidSettingsTypes.js'

// Internal message types for the query engine state machine
export type QueryMessage =
	| { type: 'assistant_text'; text: string; reasoning: string }
	| { type: 'tool_use'; name: string; id: string; input: Record<string, unknown> }
	| { type: 'tool_result'; id: string; content: string; isError: boolean }
	| { type: 'compact_boundary'; summary: string }
	| { type: 'system'; text: string; level: 'info' | 'warning' | 'error' }

// Terminal state when a query completes
export type QueryTerminal = {
	success: boolean
	reason: 'end_turn' | 'max_iterations' | 'interrupted' | 'error' | 'compact_failed'
	turnCount: number
	totalInputTokens: number
	totalOutputTokens: number
}

// Parameters for starting a query
export interface QueryEngineParams {
	threadId: string
	modelSelection: ModelSelection | null
	chatMode: ChatMode
	maxIterations: number
	tokenBudget?: number
	webSearchEnabled?: boolean
}

// Query engine state machine states
export type QueryState =
	| 'idle'
	| 'preparing'
	| 'sending_llm'
	| 'streaming'
	| 'executing_tools'
	| 'compacting'
	| 'recovering'
	| 'complete'
	| 'error'

// Recovery strategies when errors occur
export type RecoveryStrategy =
	| { type: 'retry'; delay: number }
	| { type: 'fallback_model'; model: ModelSelection }
	| { type: 'compact_and_retry' }
	| { type: 'give_up'; reason: string }
