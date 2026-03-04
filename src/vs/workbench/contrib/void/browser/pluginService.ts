/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { PluginManifest, PluginHookName } from '../common/pluginTypes.js';


export interface IPluginService {
	readonly _serviceBrand: undefined;

	onDidChangePlugins: Event<void>;

	loadPlugin(manifest: PluginManifest): void;
	unloadPlugin(pluginId: string): void;
	callHook(hookName: PluginHookName, context: Record<string, unknown>): Promise<void>;
	getLoadedPlugins(): PluginManifest[];
	isPluginLoaded(pluginId: string): boolean;
}

export const IPluginService = createDecorator<IPluginService>('voidPluginService');


class PluginService extends Disposable implements IPluginService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangePlugins = new Emitter<void>();
	readonly onDidChangePlugins: Event<void> = this._onDidChangePlugins.event;

	private _plugins: Map<string, PluginManifest> = new Map();

	loadPlugin(manifest: PluginManifest): void {
		this._plugins.set(manifest.id, { ...manifest, enabled: true });
		this._onDidChangePlugins.fire();
	}

	unloadPlugin(pluginId: string): void {
		this._plugins.delete(pluginId);
		this._onDidChangePlugins.fire();
	}

	async callHook(hookName: PluginHookName, _context: Record<string, unknown>): Promise<void> {
		for (const plugin of this._plugins.values()) {
			if (!plugin.enabled) continue;
			const hook = plugin.hooks.find(h => h.name === hookName);
			if (hook) {
				// In a full implementation, this would evaluate hook.handler
				// For now, hooks are registered but execution is a no-op placeholder
			}
		}
	}

	getLoadedPlugins(): PluginManifest[] {
		return Array.from(this._plugins.values());
	}

	isPluginLoaded(pluginId: string): boolean {
		return this._plugins.has(pluginId);
	}
}

registerSingleton(IPluginService, PluginService, InstantiationType.Delayed);
