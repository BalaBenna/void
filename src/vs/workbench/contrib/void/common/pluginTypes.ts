/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export type PluginHookName =
	| 'beforeAgentStart'
	| 'afterAgentComplete'
	| 'beforeToolCall'
	| 'afterToolCall'
	| 'onError'
	| 'onPlanGenerated';

export interface PluginHook {
	name: PluginHookName;
	handler: string; // path to handler function or inline code
}

export interface PluginManifest {
	id: string;
	name: string;
	version: string;
	description: string;
	author?: string;
	hooks: PluginHook[];
	enabled: boolean;
}

export interface PluginState {
	plugins: PluginManifest[];
	loadedPlugins: Set<string>; // plugin ids that are loaded
}
