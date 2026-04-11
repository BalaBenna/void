/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Pure utility functions for Sentinel with ZERO VS Code dependencies.
 * Fully testable in plain Node.js without any VS Code bootstrapping.
 */

// ---- Diff Parsing ----

export interface ParsedDiffFile {
	filePath: string;
	diff: string;
}

export function parseDiffFiles(diffContent: string): ParsedDiffFile[] {
	const files: ParsedDiffFile[] = [];
	const parts = diffContent.split(/^diff --git /m);

	for (const part of parts) {
		if (!part.trim()) continue;
		const fileMatch = part.match(/a\/(.+?) b\//);
		if (fileMatch) {
			files.push({ filePath: fileMatch[1], diff: 'diff --git ' + part });
		}
	}
	return files;
}

// ---- Import Extraction ----

export function extractImports(content: string): string[] {
	const imports: string[] = [];
	const esImports = content.matchAll(/from\s+['"]([^'"]+)['"]/g);
	for (const m of esImports) imports.push(m[1]);
	const requires = content.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
	for (const m of requires) imports.push(m[1]);
	return imports;
}

// ---- JSON Parsing ----

export function tryParseJSON<T>(text: string): T | null {
	let jsonStr = text.trim();

	const arrayStart = jsonStr.indexOf('[');
	const objStart = jsonStr.indexOf('{');

	if (arrayStart === -1 && objStart === -1) return null;

	const startIdx = arrayStart !== -1 && (objStart === -1 || arrayStart < objStart) ? arrayStart : objStart;

	let depth = 0;
	let endIdx = -1;
	let inString = false;
	let escaped = false;

	for (let i = startIdx; i < jsonStr.length; i++) {
		const ch = jsonStr[i];

		if (escaped) { escaped = false; continue; }
		if (ch === '\\') { escaped = true; continue; }
		if (ch === '"') { inString = !inString; continue; }
		if (inString) continue;

		if (ch === '[' || ch === '{') depth++;
		else if (ch === ']' || ch === '}') depth--;

		if (depth === 0) { endIdx = i; break; }
	}

	if (endIdx === -1) return null;
	jsonStr = jsonStr.slice(startIdx, endIdx + 1);

	try {
		return JSON.parse(jsonStr) as T;
	} catch {
		return null;
	}
}

// ---- Import Resolution ----

export function resolveImportPath(fromFile: string, importPath: string): string | null {
	if (!importPath.startsWith('.')) return null;

	const dir = fromFile.substring(0, fromFile.lastIndexOf('/'));
	const resolved = `${dir}/${importPath}`;

	const base = resolved.endsWith('.js') ? resolved.slice(0, -3) : resolved;
	return base;
}
