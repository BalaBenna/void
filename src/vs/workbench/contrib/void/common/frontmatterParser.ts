/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Simple frontmatter parser for .md files.
 * Extracts YAML-like frontmatter between --- delimiters.
 */
export function parseFrontmatter(content: string): { frontmatter: Record<string, any>; body: string } {
	const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
	if (!fmMatch) return { frontmatter: {}, body: content }

	const fmStr = fmMatch[1]
	const body = fmMatch[2]
	const frontmatter: Record<string, any> = {}

	for (const line of fmStr.split('\n')) {
		const match = line.match(/^(\w[\w-]*)\s*:\s*(.+)$/)
		if (!match) continue
		const key = match[1]
		let value: any = match[2].trim()

		// Parse arrays like ["*.ts", "*.tsx"]
		if (value.startsWith('[') && value.endsWith(']')) {
			try {
				value = JSON.parse(value)
			} catch {
				// leave as string
			}
		}
		// Parse booleans
		else if (value === 'true') value = true
		else if (value === 'false') value = false
		// Parse numbers
		else if (/^\d+$/.test(value)) value = parseInt(value, 10)

		frontmatter[key] = value
	}

	return { frontmatter, body }
}

/**
 * Simple glob matching for file paths.
 * Supports *, **, and ? wildcards.
 */
export function matchGlob(pattern: string, filePath: string): boolean {
	let regex = pattern
		.replace(/\./g, '\\.')
		.replace(/\*\*/g, '___GLOBSTAR___')
		.replace(/\*/g, '[^/]*')
		.replace(/___GLOBSTAR___/g, '.*')
		.replace(/\?/g, '.')
	return new RegExp(`(^|/)${regex}$`).test(filePath)
}
