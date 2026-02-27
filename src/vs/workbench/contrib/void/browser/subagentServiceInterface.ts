/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { SubagentDefinition, SubagentExecution, SubagentType } from '../common/subagentTypes.js';

export interface ISubagentService {
	readonly _serviceBrand: undefined;

	spawnSubagent(parentThreadId: string, type: SubagentType, prompt: string, background?: boolean): Promise<SubagentExecution>;
	getSubagentExecution(executionId: string): SubagentExecution | undefined;
	getSubagentResults(executionId: string): string | undefined;
	getBuiltinDefinition(type: SubagentType): SubagentDefinition | undefined;
}

export const ISubagentService = createDecorator<ISubagentService>('voidSubagentService');
