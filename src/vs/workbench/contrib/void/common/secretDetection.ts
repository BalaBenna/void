/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

interface SecretPattern {
	name: string;
	pattern: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
	{ name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/g },
	{ name: 'GitHub PAT', pattern: /ghp_[A-Za-z0-9_]{36}/g },
	{ name: 'GitHub OAuth', pattern: /gho_[A-Za-z0-9_]{36}/g },
	{ name: 'GitHub App Token', pattern: /ghu_[A-Za-z0-9_]{36}/g },
	{ name: 'OpenAI API Key', pattern: /sk-[A-Za-z0-9]{48,}/g },
	{ name: 'Anthropic API Key', pattern: /sk-ant-[A-Za-z0-9_-]{40,}/g },
	{ name: 'Private Key', pattern: /-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/g },
	{ name: 'Slack Token', pattern: /xox[bpors]-[0-9]{10,}-[A-Za-z0-9-]+/g },
	{ name: 'Generic API Key', pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{20,}['"]?/gi },
];

/**
 * Scan text for potential secrets and redact them.
 * Returns the redacted text.
 */
export function redactSecrets(text: string): string {
	let redacted = text;
	for (const { name, pattern } of SECRET_PATTERNS) {
		// Reset lastIndex for global patterns
		pattern.lastIndex = 0;
		redacted = redacted.replace(pattern, `[REDACTED: possible ${name}]`);
	}
	return redacted;
}

/**
 * Check if text contains potential secrets.
 */
export function containsSecrets(text: string): boolean {
	for (const { pattern } of SECRET_PATTERNS) {
		pattern.lastIndex = 0;
		if (pattern.test(text)) return true;
	}
	return false;
}
