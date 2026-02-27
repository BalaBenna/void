/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export interface AutocompleteConfig {
	debounceMs: number              // default 150, range 50-500
	maxSuggestionLines: number      // default 10, range 1-50
	enablePostAcceptPredict: boolean // default true — immediately predict after Tab accept
	enableInComments: boolean       // default true
	enableInStrings: boolean        // default true
}

export const defaultAutocompleteConfig: AutocompleteConfig = {
	debounceMs: 150,
	maxSuggestionLines: 10,
	enablePostAcceptPredict: true,
	enableInComments: true,
	enableInStrings: true,
}

export interface EditRecord {
	uri: string
	timestamp: number
	afterText: string     // up to 100 chars of inserted text
	lineNumber: number
	language: string
}

export interface AutocompleteTelemetryEvent {
	type: 'shown' | 'accepted' | 'rejected' | 'partial_accepted'
	latencyMs: number
	predictionType: string
	insertTextLength: number
}
