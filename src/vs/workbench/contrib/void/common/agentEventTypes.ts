/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export type AgentEventType =
	| 'loop_iteration'
	| 'tool_start'
	| 'tool_end'
	| 'error_recovery'
	| 'budget_warning'
	| 'iteration_limit'
	| 'loop_start'
	| 'loop_end'
	| 'self_healing_context_injected'
	| 'circuit_breaker_tripped'

export interface AgentEvent {
	type: AgentEventType;
	threadId: string;
	timestamp: number;
	iteration: number;
	maxIterations: number;
	data?: Record<string, unknown>;
}
