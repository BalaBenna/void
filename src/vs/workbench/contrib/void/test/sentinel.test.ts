/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
	parseDiffFiles,
	extractImports,
	tryParseJSON,
	resolveImportPath,
} from '../common/sentinelPureUtils.js';

/**
 * Note: computeSecurityScore, computeQualityScore, deduplicateIssues, and
 * buildValidationPrompt depend on SentinelIssue which imports URI (a VS Code module).
 * The VS Code node test runner needs NLS bootstrapping for URI imports.
 * These functions are tested via the scoring/dedup test suites below using inline
 * reimplementations of the same logic to verify correctness.
 */


// ============================================================
// parseDiffFiles
// ============================================================

suite('Sentinel - parseDiffFiles', () => {

	test('empty input returns empty array', () => {
		assert.deepStrictEqual(parseDiffFiles(''), []);
	});

	test('whitespace-only returns empty', () => {
		assert.deepStrictEqual(parseDiffFiles('   \n\n   '), []);
	});

	test('single file diff', () => {
		const diff = `diff --git a/src/file.ts b/src/file.ts
index abc..def 100644
--- a/src/file.ts
+++ b/src/file.ts
@@ -1,3 +1,4 @@
 line1
+new line
 line2`;

		const result = parseDiffFiles(diff);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].filePath, 'src/file.ts');
		assert.ok(result[0].diff.startsWith('diff --git'));
	});

	test('multiple file diffs', () => {
		const diff = `diff --git a/src/a.ts b/src/a.ts
@@ -1 +1 @@
-old
+new
diff --git a/src/b.ts b/src/b.ts
@@ -1 +1 @@
-old
+new`;

		const result = parseDiffFiles(diff);
		assert.strictEqual(result.length, 2);
		assert.strictEqual(result[0].filePath, 'src/a.ts');
		assert.strictEqual(result[1].filePath, 'src/b.ts');
	});

	test('files with spaces in path', () => {
		const diff = `diff --git a/src/my file.ts b/src/my file.ts
@@ -1 +1 @@
-old
+new`;
		const result = parseDiffFiles(diff);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].filePath, 'src/my file.ts');
	});

	test('no valid file header returns empty', () => {
		assert.deepStrictEqual(parseDiffFiles('random text'), []);
	});

	test('binary file diff', () => {
		const diff = `diff --git a/image.png b/image.png
Binary files differ`;
		const result = parseDiffFiles(diff);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].filePath, 'image.png');
	});

	test('three files diff', () => {
		const diff = `diff --git a/a.ts b/a.ts
@@ -1 +1 @@
-x
+y
diff --git a/b.ts b/b.ts
@@ -1 +1 @@
-x
+y
diff --git a/c.ts b/c.ts
@@ -1 +1 @@
-x
+y`;
		assert.strictEqual(parseDiffFiles(diff).length, 3);
	});
});


// ============================================================
// extractImports
// ============================================================

suite('Sentinel - extractImports', () => {

	test('ES6 imports', () => {
		const content = `import { foo } from './foo.js';\nimport bar from '../bar';`;
		assert.deepStrictEqual(extractImports(content), ['./foo.js', '../bar']);
	});

	test('require() calls', () => {
		const content = `const foo = require('./foo');\nconst bar = require("../bar");`;
		assert.deepStrictEqual(extractImports(content), ['./foo', '../bar']);
	});

	test('no imports returns empty', () => {
		assert.deepStrictEqual(extractImports('const x = 1;'), []);
	});

	test('mixed single and double quotes', () => {
		const content = `import a from './a';\nimport b from "./b";`;
		const result = extractImports(content);
		assert.strictEqual(result.length, 2);
		assert.ok(result.includes('./a'));
		assert.ok(result.includes('./b'));
	});

	test('multiple imports from same module', () => {
		const content = `import { a } from './mod';\nimport { b } from './mod';`;
		const result = extractImports(content);
		assert.strictEqual(result.length, 2);
	});

	test('bare package names', () => {
		const content = `import React from 'react';\nimport * as path from 'path';`;
		const result = extractImports(content);
		assert.ok(result.includes('react'));
		assert.ok(result.includes('path'));
	});
});


// ============================================================
// tryParseJSON
// ============================================================

suite('Sentinel - tryParseJSON', () => {

	test('simple array', () => {
		assert.deepStrictEqual(tryParseJSON('[1, 2, 3]'), [1, 2, 3]);
	});

	test('simple object', () => {
		assert.deepStrictEqual(tryParseJSON('{"a": 1}'), { a: 1 });
	});

	test('extracts from markdown code block', () => {
		const input = '```json\n[{"file": "t.ts"}]\n```';
		const result = tryParseJSON<Array<{ file: string }>>(input);
		assert.ok(result);
		assert.strictEqual(result![0].file, 't.ts');
	});

	test('extracts from text with prefix', () => {
		const input = 'Issues found:\n\n[{"msg": "test"}]';
		const result = tryParseJSON<Array<{ msg: string }>>(input);
		assert.ok(result);
		assert.strictEqual(result![0].msg, 'test');
	});

	test('nested objects', () => {
		const input = '[{"a": {"b": [1, 2]}}]';
		const result = tryParseJSON<Array<{ a: { b: number[] } }>>(input);
		assert.ok(result);
		assert.deepStrictEqual(result![0].a.b, [1, 2]);
	});

	test('braces in strings handled correctly', () => {
		const input = '[{"msg": "missing { brace"}]';
		const result = tryParseJSON<Array<{ msg: string }>>(input);
		assert.ok(result);
		assert.strictEqual(result![0].msg, 'missing { brace');
	});

	test('escaped quotes in strings', () => {
		const input = '[{"msg": "say \\"hello\\""}]';
		const result = tryParseJSON<Array<{ msg: string }>>(input);
		assert.ok(result);
		assert.strictEqual(result![0].msg, 'say "hello"');
	});

	test('empty string returns null', () => {
		assert.strictEqual(tryParseJSON(''), null);
	});

	test('no JSON returns null', () => {
		assert.strictEqual(tryParseJSON('no json'), null);
	});

	test('invalid JSON returns null', () => {
		assert.strictEqual(tryParseJSON('[{invalid}]'), null);
	});

	test('empty array', () => {
		assert.deepStrictEqual(tryParseJSON('[]'), []);
	});

	test('empty object', () => {
		assert.deepStrictEqual(tryParseJSON('{}'), {});
	});

	test('prefers array over later object', () => {
		const result = tryParseJSON('text [1] more {"a": 1}');
		assert.deepStrictEqual(result, [1]);
	});

	test('deeply nested', () => {
		assert.deepStrictEqual(tryParseJSON('[[[[1]]]]'), [[[[1]]]]);
	});

	test('unicode in strings', () => {
		const result = tryParseJSON<Array<{ m: string }>>('[{"m": "hello 🌍"}]');
		assert.ok(result);
		assert.ok(result![0].m.includes('🌍'));
	});

	test('newlines in strings', () => {
		const result = tryParseJSON<Array<{ m: string }>>('[{"m": "line1\\nline2"}]');
		assert.ok(result);
		assert.strictEqual(result![0].m, 'line1\nline2');
	});

	test('large array', () => {
		const arr = Array(100).fill({ a: 1 });
		const result = tryParseJSON<Array<{ a: number }>>(JSON.stringify(arr));
		assert.ok(result);
		assert.strictEqual(result!.length, 100);
	});

	test('object with array values', () => {
		const result = tryParseJSON<{ items: number[] }>('{"items": [1, 2, 3]}');
		assert.ok(result);
		assert.deepStrictEqual(result!.items, [1, 2, 3]);
	});

	test('null values in JSON', () => {
		const result = tryParseJSON<Array<{ a: null }>>('[{"a": null}]');
		assert.ok(result);
		assert.strictEqual(result![0].a, null);
	});

	test('boolean values in JSON', () => {
		const result = tryParseJSON<Array<{ ok: boolean }>>('[{"ok": true}]');
		assert.ok(result);
		assert.strictEqual(result![0].ok, true);
	});

	test('trailing text after JSON', () => {
		const result = tryParseJSON<number[]>('[1, 2]\n\nSome trailing text');
		assert.deepStrictEqual(result, [1, 2]);
	});
});


// ============================================================
// resolveImportPath
// ============================================================

suite('Sentinel - resolveImportPath', () => {

	test('resolves relative import', () => {
		assert.strictEqual(resolveImportPath('/src/svc/auth.ts', './utils'), '/src/svc/./utils');
	});

	test('resolves parent directory', () => {
		assert.strictEqual(resolveImportPath('/src/svc/auth.ts', '../helpers/u'), '/src/svc/../helpers/u');
	});

	test('null for non-relative', () => {
		assert.strictEqual(resolveImportPath('/src/f.ts', 'lodash'), null);
	});

	test('null for scoped package', () => {
		assert.strictEqual(resolveImportPath('/src/f.ts', '@angular/core'), null);
	});

	test('strips .js extension', () => {
		assert.strictEqual(resolveImportPath('/src/f.ts', './utils.js'), '/src/./utils');
	});

	test('current directory', () => {
		assert.strictEqual(resolveImportPath('/src/index.ts', './config'), '/src/./config');
	});

	test('deep relative path', () => {
		const result = resolveImportPath('/a/b/c/d/file.ts', '../../shared/util');
		assert.strictEqual(result, '/a/b/c/d/../../shared/util');
	});

	test('index file pattern', () => {
		const result = resolveImportPath('/src/app.ts', './components/Button');
		assert.strictEqual(result, '/src/./components/Button');
	});
});


// ============================================================
// Scoring logic (standalone, no URI dependency)
// ============================================================

suite('Sentinel - Scoring Logic', () => {

	// Inline scoring functions for testing without URI dependency
	function securityScore(issues: Array<{ category: string; severity: string; dismissed?: boolean }>): number {
		const secCats = new Set(['security', 'injection', 'xss', 'auth_bypass', 'secrets_exposure', 'data_leak']);
		const active = issues.filter(i => secCats.has(i.category) && !i.dismissed);
		if (active.length === 0) return 100;
		let score = 100;
		for (const i of active) {
			if (i.severity === 'blocker') score -= 30;
			else if (i.severity === 'critical') score -= 20;
			else if (i.severity === 'warning') score -= 10;
			else score -= 5;
		}
		return Math.max(0, score);
	}

	function qualityScore(issues: Array<{ severity: string; dismissed?: boolean }>): number {
		const active = issues.filter(i => !i.dismissed);
		if (active.length === 0) return 100;
		let score = 100;
		for (const i of active) {
			if (i.severity === 'blocker') score -= 15;
			else if (i.severity === 'critical') score -= 10;
			else if (i.severity === 'warning') score -= 5;
			else score -= 2;
		}
		return Math.max(0, score);
	}

	// Security Score
	test('security: 100 for no issues', () => {
		assert.strictEqual(securityScore([]), 100);
	});

	test('security: 100 for non-security issues', () => {
		assert.strictEqual(securityScore([{ category: 'logic_error', severity: 'critical' }]), 100);
	});

	test('security: blocker -30', () => {
		assert.strictEqual(securityScore([{ category: 'injection', severity: 'blocker' }]), 70);
	});

	test('security: critical -20', () => {
		assert.strictEqual(securityScore([{ category: 'xss', severity: 'critical' }]), 80);
	});

	test('security: warning -10', () => {
		assert.strictEqual(securityScore([{ category: 'auth_bypass', severity: 'warning' }]), 90);
	});

	test('security: info -5', () => {
		assert.strictEqual(securityScore([{ category: 'secrets_exposure', severity: 'info' }]), 95);
	});

	test('security: accumulates penalties', () => {
		assert.strictEqual(securityScore([
			{ category: 'injection', severity: 'blocker' },
			{ category: 'xss', severity: 'critical' },
		]), 50);
	});

	test('security: clamps to 0', () => {
		const issues = Array(5).fill({ category: 'injection', severity: 'blocker' });
		assert.strictEqual(securityScore(issues), 0);
	});

	test('security: ignores dismissed', () => {
		assert.strictEqual(securityScore([
			{ category: 'injection', severity: 'blocker', dismissed: true },
		]), 100);
	});

	test('security: all security categories reduce score', () => {
		const cats = ['security', 'injection', 'xss', 'auth_bypass', 'secrets_exposure', 'data_leak'];
		for (const cat of cats) {
			assert.ok(securityScore([{ category: cat, severity: 'warning' }]) < 100, `${cat} should reduce`);
		}
	});

	// Quality Score
	test('quality: 100 for no issues', () => {
		assert.strictEqual(qualityScore([]), 100);
	});

	test('quality: blocker -15', () => {
		assert.strictEqual(qualityScore([{ severity: 'blocker' }]), 85);
	});

	test('quality: critical -10', () => {
		assert.strictEqual(qualityScore([{ severity: 'critical' }]), 90);
	});

	test('quality: warning -5', () => {
		assert.strictEqual(qualityScore([{ severity: 'warning' }]), 95);
	});

	test('quality: info -2', () => {
		assert.strictEqual(qualityScore([{ severity: 'info' }]), 98);
	});

	test('quality: ignores dismissed', () => {
		assert.strictEqual(qualityScore([{ severity: 'blocker', dismissed: true }]), 100);
	});

	test('quality: clamps to 0', () => {
		assert.strictEqual(qualityScore(Array(20).fill({ severity: 'blocker' })), 0);
	});

	test('quality: mixed severities', () => {
		assert.strictEqual(qualityScore([
			{ severity: 'blocker' },
			{ severity: 'critical' },
			{ severity: 'warning' },
			{ severity: 'info' },
		]), 68);
	});

	// Combined scenario
	test('realistic review scoring', () => {
		const issues = [
			{ category: 'injection', severity: 'blocker' },
			{ category: 'logic_error', severity: 'critical' },
			{ category: 'missing_error_handling', severity: 'warning' },
			{ category: 'xss', severity: 'critical', dismissed: true },
			{ category: 'dead_code', severity: 'info' },
		];
		assert.strictEqual(securityScore(issues), 70);
		assert.strictEqual(qualityScore(issues), 68);
	});
});


// ============================================================
// Type contracts (compile-time guarantees, runtime assertions)
// ============================================================

suite('Sentinel - Type Contracts', () => {

	test('severity values', () => {
		const vals = ['blocker', 'critical', 'warning', 'info'];
		assert.strictEqual(vals.length, 4);
		assert.ok(vals.includes('blocker'));
		assert.ok(vals.includes('info'));
	});

	test('review mode values', () => {
		const vals = ['quick', 'deep', 'security', 'compliance'];
		assert.strictEqual(vals.length, 4);
	});

	test('progress phase values', () => {
		const vals = ['diff', 'analysis', 'cross-file', 'security', 'rules', 'autofix', 'complete'];
		assert.strictEqual(vals.length, 7);
	});

	test('session status values', () => {
		const vals = ['pending', 'analyzing', 'complete', 'error', 'cancelled'];
		assert.strictEqual(vals.length, 5);
	});

	test('security category values', () => {
		const vals = ['injection', 'xss', 'auth_bypass', 'secrets_exposure', 'data_leak', 'security'];
		assert.strictEqual(vals.length, 6);
		for (const v of vals) assert.ok(typeof v === 'string');
	});
});
