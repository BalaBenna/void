/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { PlanItem } from './chatThreadServiceTypes.js';

export interface EnhancedPlanItem extends PlanItem {
	dependencies?: string[]; // ids of plan items this depends on
	mermaidNodeId?: string; // id for Mermaid diagram rendering
	estimatedTokens?: number;
}

export interface PlanClarifyingQuestion {
	id: string;
	question: string;
	options?: string[];
	answer?: string;
	answered: boolean;
}

export interface EnhancedPlan {
	items: EnhancedPlanItem[];
	mermaidDiagram?: string; // Mermaid diagram source
	clarifyingQuestions: PlanClarifyingQuestion[];
	allQuestionsAnswered: boolean;
}
