/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { mountvoidLogin } from './react/out/void-auth-tsx/index.js';
import { h, getActiveWindow } from '../../../../base/browser/dom.js';

export class LoginContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.voidLogin';

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
		this.initialize();
	}

	private initialize(): void {
		const targetWindow = getActiveWindow();
		const workbench = targetWindow.document.querySelector('.monaco-workbench');

		if (workbench) {
			const loginContainer = h('div.void-login-container').root;
			workbench.appendChild(loginContainer);
			this.instantiationService.invokeFunction((accessor: ServicesAccessor) => {
				const result = mountvoidLogin(loginContainer, accessor);
				if (result && typeof result.dispose === 'function') {
					this._register(toDisposable(result.dispose));
				}
			});
			this._register(toDisposable(() => {
				if (loginContainer.parentElement) {
					loginContainer.parentElement.removeChild(loginContainer);
				}
			}));
		}
	}
}

registerWorkbenchContribution2(LoginContribution.ID, LoginContribution, WorkbenchPhase.AfterRestored);
