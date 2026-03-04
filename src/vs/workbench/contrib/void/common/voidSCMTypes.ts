/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export interface IVoidSCMService {
	readonly _serviceBrand: undefined;
	/**
	 * Get git diff --stat
	 *
	 * @param path Path to the git repository
	 */
	gitStat(path: string): Promise<string>
	/**
	 * Get git diff --stat for the top 10 most significantly changed files according to lines added/removed
	 *
	 * @param path Path to the git repository
	 */
	gitSampledDiffs(path: string): Promise<string>
	/**
	 * Get the current git branch
	 *
	 * @param path Path to the git repository
	 */
	gitBranch(path: string): Promise<string>
	/**
	 * Get the last 5 commits excluding merges
	 *
	 * @param path Path to the git repository
	 */
	gitLog(path: string): Promise<string>

	/**
	 * Get git blame for a specific line in a file
	 *
	 * @param repoPath Path to the git repository
	 * @param file Path to the file (relative to repo)
	 * @param line Line number to blame
	 */
	gitBlame(repoPath: string, file: string, line: number): Promise<string>

	/**
	 * Get file contents at a specific commit
	 *
	 * @param repoPath Path to the git repository
	 * @param commit Commit hash or ref
	 * @param file Path to the file (relative to repo)
	 */
	gitShowAtCommit(repoPath: string, commit: string, file: string): Promise<string>

	/**
	 * Get diff between two commits
	 *
	 * @param repoPath Path to the git repository
	 * @param commitA First commit hash or ref
	 * @param commitB Second commit hash or ref
	 * @param file Optional file path to scope the diff
	 */
	gitDiffBetweenCommits(repoPath: string, commitA: string, commitB: string, file?: string): Promise<string>
}

export const IVoidSCMService = createDecorator<IVoidSCMService>('voidSCMService')
