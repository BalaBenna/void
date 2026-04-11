/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Per-model token usage tracking
export interface ModelUsage {
	inputTokens: number
	outputTokens: number
	cacheReadInputTokens: number
	cacheCreationInputTokens: number
	costUSD: number
}

// Session-wide cost state
export interface SessionCostState {
	totalCostUSD: number
	totalInputTokens: number
	totalOutputTokens: number
	modelUsage: Record<string, ModelUsage>
}

// Pricing per million tokens (input/output) for common providers
export const MODEL_PRICING: Record<string, { inputPerMillion: number; outputPerMillion: number }> = {
	// Anthropic
	'claude-3-5-sonnet': { inputPerMillion: 3, outputPerMillion: 15 },
	'claude-3-5-haiku': { inputPerMillion: 0.8, outputPerMillion: 4 },
	'claude-3-opus': { inputPerMillion: 15, outputPerMillion: 75 },
	'claude-sonnet-4': { inputPerMillion: 3, outputPerMillion: 15 },
	'claude-opus-4': { inputPerMillion: 15, outputPerMillion: 75 },
	// OpenAI
	'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10 },
	'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
	'gpt-4.1': { inputPerMillion: 2, outputPerMillion: 8 },
	'o3': { inputPerMillion: 10, outputPerMillion: 40 },
	'o3-mini': { inputPerMillion: 1.1, outputPerMillion: 4.4 },
	'o4-mini': { inputPerMillion: 1.1, outputPerMillion: 4.4 },
	// Default fallback
	'default': { inputPerMillion: 3, outputPerMillion: 15 },
}
