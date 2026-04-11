/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ModelSelection } from './voidSettingsTypes.js';

export type ComplexityLevel = 'simple' | 'moderate' | 'complex';

export interface LatencyRecord {
	avgMs: number;
	errorRate: number;
	samples: number;
}

export interface RouterConfig {
	mode: 'manual' | 'auto';
	modelMapping: {
		simple: ModelSelection | null;
		moderate: ModelSelection | null;
		complex: ModelSelection | null;
	};
	fallbackChain: ModelSelection[];
	costAware: boolean;
	latencyTracking: { [modelKey: string]: LatencyRecord };
}

export const defaultRouterConfig: RouterConfig = {
	mode: 'manual',
	modelMapping: {
		simple: null,
		moderate: null,
		complex: null,
	},
	fallbackChain: [],
	costAware: false,
	latencyTracking: {},
};
