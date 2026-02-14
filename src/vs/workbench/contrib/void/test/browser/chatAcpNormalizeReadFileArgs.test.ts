/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { normalizeAcpArgsForUi } from '../../browser/ChatAcpHandler.js';

suite('ChatAcpHandler.normalizeAcpArgsForUi (read_file ACP external)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parses "(from line N, limit K lines)" embedded into uri and cleans uri', () => {
		const root = URI.file('/media/user/void');
		const p = normalizeAcpArgsForUi(
			'read_file',
			{ uri: '/media/user/void/src/a.ts (from line 650, limit 20 lines)' },
			root
		) as any;

		assert.ok(URI.isUri(p.uri));
		assert.strictEqual(p.uri.fsPath, '/media/user/void/src/a.ts');
		assert.strictEqual(p.startLine, 650);
		assert.strictEqual(p.linesCount, 20);
	});

	test('parses "(limit K lines)" as startLine=1 and cleans uri', () => {
		const root = URI.file('/media/user/void');
		const p = normalizeAcpArgsForUi(
			'read_file',
			{ uri: '/media/user/void/src/a.ts (limit 20 lines)' },
			root
		) as any;

		assert.ok(URI.isUri(p.uri));
		assert.strictEqual(p.uri.fsPath, '/media/user/void/src/a.ts');
		assert.strictEqual(p.startLine, 1);
		assert.strictEqual(p.linesCount, 20);
	});

	test('workspace-relative uri with range becomes joined URI + range', () => {
		const root = URI.file('/workspaces/proj');
		const p = normalizeAcpArgsForUi(
			'read_file',
			{ uri: 'src/a.ts (from line 10, limit 5 lines)' },
			root
		) as any;

		assert.ok(URI.isUri(p.uri));
		assert.strictEqual(p.uri.fsPath, '/workspaces/proj/src/a.ts');
		assert.strictEqual(p.startLine, 10);
		assert.strictEqual(p.linesCount, 5);
	});

	test('does not override explicit startLine/linesCount but still cleans uri', () => {
		const root = URI.file('/media/user/void');
		const p = normalizeAcpArgsForUi(
			'read_file',
			{
				uri: '/media/user/void/src/a.ts (from line 650, limit 20 lines)',
				startLine: 777,
				linesCount: 3
			},
			root
		) as any;

		assert.ok(URI.isUri(p.uri));
		assert.strictEqual(p.uri.fsPath, '/media/user/void/src/a.ts');
		assert.strictEqual(p.startLine, 777);
		assert.strictEqual(p.linesCount, 3);
	});
});
