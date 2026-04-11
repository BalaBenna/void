/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';

export interface VisualInspectResult {
	elementTag: string;
	elementText: string;
	cssClasses: string[];
	domPath: string;
	sourceFile: URI | null;
	sourceLine: number | null;
	componentName: string | null;
}

export interface VisualEditorConfig {
	enabled: boolean;
	inspectMode: boolean;
}

export const defaultVisualEditorConfig: VisualEditorConfig = {
	enabled: false,
	inspectMode: false,
};
