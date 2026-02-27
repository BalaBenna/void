/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ErrorPattern } from './errorClassificationTypes.js'

export const errorPatterns: ErrorPattern[] = [
	// === TypeScript / JavaScript compile errors ===
	{
		regex: /error TS(\d+):\s*(.+)/,
		category: 'compile',
		severity: 'error',
		extractMessage: (m) => m[2],
	},
	{
		regex: /(.+?)\((\d+),(\d+)\):\s*error TS\d+/,
		category: 'compile',
		severity: 'error',
		extractFilePath: (m) => m[1],
		extractLineNumber: (m) => parseInt(m[2]),
		extractColumnNumber: (m) => parseInt(m[3]),
	},
	{
		regex: /(.+?):(\d+):(\d+)\s*-\s*error TS\d+:\s*(.+)/,
		category: 'compile',
		severity: 'error',
		extractFilePath: (m) => m[1],
		extractLineNumber: (m) => parseInt(m[2]),
		extractColumnNumber: (m) => parseInt(m[3]),
		extractMessage: (m) => m[4],
	},
	{
		regex: /SyntaxError:\s*(.+)/,
		category: 'compile',
		severity: 'fatal',
		extractMessage: (m) => m[1],
	},
	{
		regex: /ReferenceError:\s*(.+)/,
		category: 'runtime',
		severity: 'error',
		extractMessage: (m) => m[1],
	},
	{
		regex: /TypeError:\s*(.+)/,
		category: 'runtime',
		severity: 'error',
		extractMessage: (m) => m[1],
	},

	// === Python errors ===
	{
		regex: /Traceback \(most recent call last\)/,
		category: 'runtime',
		severity: 'error',
		extractMessage: () => 'Python traceback',
	},
	{
		regex: /File "(.+?)", line (\d+)/,
		category: 'runtime',
		severity: 'error',
		extractFilePath: (m) => m[1],
		extractLineNumber: (m) => parseInt(m[2]),
	},
	{
		regex: /IndentationError:\s*(.+)/,
		category: 'compile',
		severity: 'error',
		extractMessage: (m) => m[1],
	},
	{
		regex: /ModuleNotFoundError:\s*No module named '(.+)'/,
		category: 'dependency',
		severity: 'error',
		extractMessage: (m) => `Missing Python module: ${m[1]}`,
	},
	{
		regex: /ImportError:\s*(.+)/,
		category: 'dependency',
		severity: 'error',
		extractMessage: (m) => m[1],
	},

	// === Rust errors ===
	{
		regex: /error\[E(\d+)\]:\s*(.+)/,
		category: 'compile',
		severity: 'error',
		extractMessage: (m) => m[2],
	},
	{
		regex: /-->\s*(.+?):(\d+):(\d+)/,
		category: 'compile',
		severity: 'error',
		extractFilePath: (m) => m[1],
		extractLineNumber: (m) => parseInt(m[2]),
		extractColumnNumber: (m) => parseInt(m[3]),
	},

	// === Go errors ===
	{
		regex: /(.+?):(\d+):(\d+):\s*(.+)/,
		category: 'compile',
		severity: 'error',
		extractFilePath: (m) => m[1],
		extractLineNumber: (m) => parseInt(m[2]),
		extractColumnNumber: (m) => parseInt(m[3]),
		extractMessage: (m) => m[4],
	},

	// === Test framework errors ===
	{
		regex: /FAIL\s+(.+)/,
		category: 'test',
		severity: 'error',
		extractMessage: (m) => `Test failed: ${m[1]}`,
	},
	{
		regex: /✗\s+(.+)/,
		category: 'test',
		severity: 'error',
		extractMessage: (m) => `Test failed: ${m[1]}`,
	},
	{
		regex: /✕\s+(.+)/,
		category: 'test',
		severity: 'error',
		extractMessage: (m) => `Test failed: ${m[1]}`,
	},
	{
		regex: /AssertionError:\s*(.+)/,
		category: 'test',
		severity: 'error',
		extractMessage: (m) => m[1],
	},
	{
		regex: /AssertionError:\s*(.+)/,
		category: 'test',
		severity: 'error',
		extractMessage: (m) => m[1],
	},
	{
		regex: /Expected\s+(.+?)\s+Received\s+(.+)/,
		category: 'test',
		severity: 'error',
		extractMessage: (m) => `Expected ${m[1]}, Received ${m[2]}`,
	},
	{
		regex: /expect\(received\)\.(.+)/,
		category: 'test',
		severity: 'error',
		extractMessage: (m) => `Assertion: ${m[1]}`,
	},
	{
		regex: /Tests:\s+(\d+) failed/,
		category: 'test',
		severity: 'error',
		extractMessage: (m) => `${m[1]} test(s) failed`,
	},

	// === Lint errors ===
	{
		regex: /(.+?):(\d+):(\d+):\s*(warning|error)\s+(.+?)\s+(\S+)$/m,
		category: 'lint',
		severity: 'warning',
		extractFilePath: (m) => m[1],
		extractLineNumber: (m) => parseInt(m[2]),
		extractColumnNumber: (m) => parseInt(m[3]),
		extractMessage: (m) => `[${m[6]}] ${m[5]}`,
	},

	// === Dependency errors ===
	{
		regex: /npm ERR!\s*(.+)/,
		category: 'dependency',
		severity: 'error',
		extractMessage: (m) => m[1],
	},
	{
		regex: /Cannot find module '(.+)'/,
		category: 'dependency',
		severity: 'error',
		extractMessage: (m) => `Cannot find module '${m[1]}'`,
	},
	{
		regex: /Module not found:\s*(.+)/,
		category: 'dependency',
		severity: 'error',
		extractMessage: (m) => `Module not found: ${m[1]}`,
	},
	{
		regex: /ENOENT:\s*no such file or directory/,
		category: 'dependency',
		severity: 'error',
		extractMessage: () => 'File or directory not found',
	},
	{
		regex: /pip install\s+(.+)|Could not find a version/,
		category: 'dependency',
		severity: 'error',
		extractMessage: (m) => m[1] ? `Missing pip package: ${m[1]}` : 'Package version not found',
	},

	// === Environment errors ===
	{
		regex: /command not found:\s*(.+)/,
		category: 'environment',
		severity: 'fatal',
		extractMessage: (m) => `Command not found: ${m[1]}`,
	},
	{
		regex: /Permission denied/,
		category: 'environment',
		severity: 'fatal',
		extractMessage: () => 'Permission denied',
	},
	{
		regex: /EACCES:\s*permission denied/,
		category: 'environment',
		severity: 'fatal',
		extractMessage: () => 'Permission denied (EACCES)',
	},
	{
		regex: /ENOMEM|Cannot allocate memory/,
		category: 'environment',
		severity: 'fatal',
		extractMessage: () => 'Out of memory',
	},
	{
		regex: /EADDRINUSE.+?(\d+)/,
		category: 'environment',
		severity: 'error',
		extractMessage: (m) => `Port ${m[1]} already in use`,
	},

	// === Java errors ===
	{
		regex: /(.+\.java):(\d+): error:\s*(.+)/,
		category: 'compile',
		severity: 'error',
		extractFilePath: (m) => m[1],
		extractLineNumber: (m) => parseInt(m[2]),
		extractMessage: (m) => m[3],
	},

	// === C/C++ errors ===
	{
		regex: /(.+?\.[ch](?:pp)?):(\d+):(\d+):\s*error:\s*(.+)/,
		category: 'compile',
		severity: 'error',
		extractFilePath: (m) => m[1],
		extractLineNumber: (m) => parseInt(m[2]),
		extractColumnNumber: (m) => parseInt(m[3]),
		extractMessage: (m) => m[4],
	},
]

// Patterns used for error-aware truncation — simpler regex for fast scanning
export const errorLinePatterns: RegExp[] = [
	/error/i,
	/FAIL/i,
	/TypeError/,
	/SyntaxError/,
	/Cannot find/,
	/not found/i,
	/^\s+at\s/,
	/Traceback/,
	/AssertionError/,
	/npm ERR!/,
	/Permission denied/,
	/command not found/,
]
