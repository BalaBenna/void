/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js'
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js'
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js'
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js'
import { IFileService } from '../../../../platform/files/common/files.js'
import { URI } from '../../../../base/common/uri.js'
import { ITerminalToolService } from './terminalToolService.js'
import { PipelineResult, VerificationResult, VerificationStep } from '../common/verificationPipelineTypes.js'
import { IvoidSettingsService } from '../common/voidSettingsService.js'
import { generateUuid } from '../../../../base/common/uuid.js'

export interface IVerificationPipelineService {
	readonly _serviceBrand: undefined
	runPipeline(cwd: string | null, filterSteps: string | null): Promise<PipelineResult>
	detectProjectSteps(workspacePath: URI): Promise<VerificationStep[]>
}

export const IVerificationPipelineService = createDecorator<IVerificationPipelineService>('VerificationPipelineService')

class VerificationPipelineService extends Disposable implements IVerificationPipelineService {
	declare readonly _serviceBrand: undefined

	constructor(
		@ITerminalToolService private readonly terminalToolService: ITerminalToolService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@IvoidSettingsService private readonly voidSettingsService: IvoidSettingsService,
	) {
		super()
	}

	async runPipeline(cwd: string | null, filterSteps: string | null): Promise<PipelineResult> {
		const config = this.voidSettingsService.state.globalSettings.verificationPipelineConfig
		let steps = config.steps

		// If no configured steps, try to auto-detect
		if (steps.length === 0) {
			const workspaceFolders = this.workspaceContextService.getWorkspace().folders
			if (workspaceFolders.length > 0) {
				steps = await this.detectProjectSteps(workspaceFolders[0].uri)
			}
		}

		// Filter steps if requested
		if (filterSteps) {
			const filterNames = filterSteps.split(',').map(s => s.trim().toLowerCase())
			steps = steps.filter(s => filterNames.includes(s.name.toLowerCase()))
		}

		const results: VerificationResult[] = []
		let firstFailure: VerificationResult | null = null

		for (const step of steps) {
			const startTime = Date.now()
			let passed = false
			let output = ''
			let exitCode: number | null = null

			try {
				const terminalId = generateUuid()
				const { resPromise } = await this.terminalToolService.runCommand(step.command, { type: 'temporary', cwd, terminalId })
				const res = await resPromise
				output = res.result
				if (res.resolveReason.type === 'done') {
					exitCode = res.resolveReason.exitCode
					passed = exitCode === 0
				} else {
					passed = false
				}
			} catch (e) {
				output = String(e)
				passed = false
			}

			const durationMs = Date.now() - startTime
			const result: VerificationResult = { step, passed, output, exitCode, durationMs }
			results.push(result)

			if (!passed && !step.optional) {
				if (!firstFailure) firstFailure = result
				if (config.stopOnFirstFailure) break
			}
		}

		return {
			allPassed: results.every(r => r.passed || r.step.optional),
			results,
			firstFailure,
		}
	}

	async detectProjectSteps(workspacePath: URI): Promise<VerificationStep[]> {
		const steps: VerificationStep[] = []

		// Check for package.json (Node.js projects)
		try {
			const pkgJsonUri = URI.joinPath(workspacePath, 'package.json')
			const content = await this.fileService.readFile(pkgJsonUri)
			const pkg = JSON.parse(content.value.toString())
			const scripts = pkg.scripts || {}

			if (scripts.build) {
				steps.push({ name: 'build', command: 'npm run build', optional: false, timeout: 120 })
			}
			if (scripts.typecheck || scripts['type-check']) {
				const cmd = scripts.typecheck ? 'npm run typecheck' : 'npm run type-check'
				steps.push({ name: 'typecheck', command: cmd, optional: false, timeout: 60 })
			}
			if (scripts.lint) {
				steps.push({ name: 'lint', command: 'npm run lint', optional: true, timeout: 60 })
			}
			if (scripts.test) {
				steps.push({ name: 'test', command: 'npm run test', optional: false, timeout: 120 })
			}
		} catch {
			// No package.json or parse error
		}

		// Check for tsconfig.json (TypeScript) — add typecheck if not already from package.json
		if (!steps.some(s => s.name === 'typecheck')) {
			try {
				const tsconfigUri = URI.joinPath(workspacePath, 'tsconfig.json')
				await this.fileService.readFile(tsconfigUri)
				steps.push({ name: 'typecheck', command: 'npx tsc --noEmit', optional: false, timeout: 60 })
			} catch {
				// No tsconfig
			}
		}

		// Check for Cargo.toml (Rust)
		try {
			const cargoUri = URI.joinPath(workspacePath, 'Cargo.toml')
			await this.fileService.readFile(cargoUri)
			if (steps.length === 0) {
				steps.push({ name: 'build', command: 'cargo build', optional: false, timeout: 120 })
				steps.push({ name: 'test', command: 'cargo test', optional: false, timeout: 120 })
				steps.push({ name: 'lint', command: 'cargo clippy', optional: true, timeout: 60 })
			}
		} catch {
			// No Cargo.toml
		}

		// Check for go.mod (Go)
		try {
			const goModUri = URI.joinPath(workspacePath, 'go.mod')
			await this.fileService.readFile(goModUri)
			if (steps.length === 0) {
				steps.push({ name: 'build', command: 'go build ./...', optional: false, timeout: 120 })
				steps.push({ name: 'test', command: 'go test ./...', optional: false, timeout: 120 })
				steps.push({ name: 'lint', command: 'go vet ./...', optional: true, timeout: 60 })
			}
		} catch {
			// No go.mod
		}

		return steps
	}
}

registerSingleton(IVerificationPipelineService, VerificationPipelineService, InstantiationType.Eager)
