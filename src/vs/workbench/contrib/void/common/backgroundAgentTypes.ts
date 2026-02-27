/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export type BackgroundAgentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface BackgroundAgent {
	id: string;
	prompt: string;
	status: BackgroundAgentStatus;
	result?: string;
	error?: string;
	createdAt: number;
	startedAt?: number;
	completedAt?: number;
	threadId: string; // hidden thread id for this agent
	reviewed: boolean; // whether the user has reviewed the result
}

export interface BackgroundAgentConfig {
	enabled: boolean;
	maxBackgroundAgents: number;
	notifyOnCompletion: boolean;
}

export const defaultBackgroundAgentConfig: BackgroundAgentConfig = {
	enabled: false,
	maxBackgroundAgents: 5,
	notifyOnCompletion: true,
};

// Serializable format for persistence (JSON file)
export interface BackgroundAgentStore {
	version: number;
	agents: BackgroundAgent[];
}
