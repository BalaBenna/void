/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { voidCheckUpdateRespose } from './voidUpdateServiceTypes.js';



export interface IvoidUpdateService {
	readonly _serviceBrand: undefined;
	check: (explicit: boolean) => Promise<voidCheckUpdateRespose>;
}


export const IvoidUpdateService = createDecorator<IvoidUpdateService>('voidUpdateService');


// implemented by calling channel
export class voidUpdateService implements IvoidUpdateService {

	readonly _serviceBrand: undefined;
	private readonly voidUpdateService: IvoidUpdateService;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService, // (only usable on client side)
	) {
		// creates an IPC proxy to use metricsMainService.ts
		this.voidUpdateService = ProxyChannel.toService<IvoidUpdateService>(mainProcessService.getChannel('void-channel-update'));
	}


	// anything transmitted over a channel must be async even if it looks like it doesn't have to be
	check: IvoidUpdateService['check'] = async (explicit) => {
		const res = await this.voidUpdateService.check(explicit)
		return res
	}
}

registerSingleton(IvoidUpdateService, voidUpdateService, InstantiationType.Eager);


