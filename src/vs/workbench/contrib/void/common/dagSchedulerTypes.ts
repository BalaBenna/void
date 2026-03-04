/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export type DAGNodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface DAGNode {
	id: string;
	prompt: string;
	dependencies: string[]; // ids of nodes that must complete first
	targetFiles?: string[]; // files this node will modify (for conflict detection)
	status: DAGNodeStatus;
	result?: string;
	error?: string;
	startedAt?: number;
	completedAt?: number;
}

export interface DAGExecution {
	id: string;
	nodes: DAGNode[];
	status: 'pending' | 'running' | 'completed' | 'failed';
	maxConcurrency: number;
	createdAt: number;
	completedAt?: number;
}

export interface DAGConflict {
	nodeA: string;
	nodeB: string;
	conflictingFiles: string[];
}
