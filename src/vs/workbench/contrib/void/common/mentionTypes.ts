/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export type MentionType = 'git' | 'pr' | 'docs' | 'web' | 'issue';

export interface ResolvedMention {
	type: MentionType;
	raw: string; // original @mention string
	resolved: string; // resolved content to inject into context
	label: string; // display label
}

export interface MentionPattern {
	type: MentionType;
	regex: RegExp;
	prefix: string;
}

export const mentionPatterns: MentionPattern[] = [
	{ type: 'git', regex: /@git:([^\s]+)/g, prefix: '@git:' },
	{ type: 'pr', regex: /@PR:(\d+)/g, prefix: '@PR:' },
	{ type: 'docs', regex: /@docs:([^\s]+)/g, prefix: '@docs:' },
	{ type: 'web', regex: /@web:([^\s]+)/g, prefix: '@web:' },
	{ type: 'issue', regex: /@issue:([^\s]+)/g, prefix: '@issue:' },
];
