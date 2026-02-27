/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ModelSelection } from './voidSettingsTypes.js';

export type ComplexityLevel = 'simple' | 'moderate' | 'complex';

export interface RouterConfig {
	mode: 'manual' | 'auto';
	modelMapping: {
		simple: ModelSelection | null;
		moderate: ModelSelection | null;
		complex: ModelSelection | null;
	};
}

export const defaultRouterConfig: RouterConfig = {
	mode: 'manual',
	modelMapping: {
		simple: null,
		moderate: null,
		complex: null,
	},
};
