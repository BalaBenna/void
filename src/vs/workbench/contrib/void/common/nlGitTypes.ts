/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export type GitRiskLevel = 'safe' | 'moderate' | 'dangerous';

export interface NLGitTranslation {
	naturalLanguage: string;
	gitCommand: string;
	explanation: string;
	riskLevel: GitRiskLevel;
	requiresConfirmation: boolean;
}
