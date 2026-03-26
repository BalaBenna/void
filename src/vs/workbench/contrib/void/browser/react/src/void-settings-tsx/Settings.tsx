/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react'; // Added useRef import just in case it was missed, though likely already present
import { ProviderName, SettingName, displayInfoOfSettingName, providerNames, voidStatefulModelInfo, customSettingNamesOfProvider, displayInfoOfProviderName, GlobalSettingName, featureNames, displayInfoOfFeatureName, isProviderNameDisabled, FeatureName, subTextMdOfProviderName } from '../../../../common/voidSettingsTypes.js'
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js'
import { voidButtonBgDarken, voidCustomDropdownBox, voidInputBox2, voidSimpleInputBox, voidSwitch } from '../util/inputs.js'
import { useAccessor, useIsDark, useIsOptedOut, useRefreshModelListener, useRefreshModelState, useSettingsState, useAgentRegistry, useRules, useIndexStatus, useEnvFileVars, useAuthState } from '../util/services.js'
import { X, RefreshCw, Loader2, Check, Asterisk, Plus } from 'lucide-react'
import { URI } from '../../../../../../../base/common/uri.js'
import { VSBuffer } from '../../../../../../../base/common/buffer.js'
import { ModelDropdown } from './ModelDropdown.js'
import { ChatMarkdownRender } from '../markdown/ChatMarkdownRender.js'
import { WarningBox } from './WarningBox.js'
import { os } from '../../../../common/helpers/systemInfo.js'
import { IconLoading } from '../sidebar-tsx/SidebarChat.js'
import { ToolApprovalType, toolApprovalTypes } from '../../../../common/toolsServiceTypes.js'
import { SandboxMode } from '../../../../common/sandboxTypes.js'
import Severity from '../../../../../../../base/common/severity.js'
import { getModelCapabilities, modelOverrideKeys, ModelOverrides } from '../../../../common/modelCapabilities.js';
import { TransferEditorType, TransferFilesInfo } from '../../../extensionTransferTypes.js';
import { MCPServer } from '../../../../common/mcpServiceTypes.js';
import { useMCPServiceState } from '../util/services.js';
import { OPT_OUT_KEY } from '../../../../common/storageKeys.js';
import { StorageScope, StorageTarget } from '../../../../../../../platform/storage/common/storage.js';

type Tab =
	| 'account'
	| 'general'
	| 'models'
	| 'featureOptions'
	| 'mcp'
	| 'agentsAndRules'
	| 'indexing';


const ButtonLeftTextRightOption = ({ text, leftButton }: { text: string, leftButton?: React.ReactNode }) => {

	return <div className='flex items-center text-void-fg-3 px-3 py-0.5 rounded-sm overflow-hidden gap-2'>
		{leftButton ? leftButton : null}
		<span>
			{text}
		</span>
	</div>
}

// models



export const AnimatedCheckmarkButton = ({ text, className }: { text?: string, className?: string }) => {
	const [dashOffset, setDashOffset] = useState(40);

	useEffect(() => {
		const startTime = performance.now();
		const duration = 500; // 500ms animation

		const animate = (currentTime: number) => {
			const elapsed = currentTime - startTime;
			const progress = Math.min(elapsed / duration, 1);
			const newOffset = 40 - (progress * 40);

			setDashOffset(newOffset);

			if (progress < 1) {
				requestAnimationFrame(animate);
			}
		};

		const animationId = requestAnimationFrame(animate);
		return () => cancelAnimationFrame(animationId);
	}, []);

	return <div
		className={`flex items-center gap-1.5 w-fit
			${className ? className : `px-2 py-0.5 text-xs text-zinc-900 bg-zinc-100 rounded-sm`}
		`}
	>
		<svg className="size-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path
				d="M5 13l4 4L19 7"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				style={{
					strokeDasharray: 40,
					strokeDashoffset: dashOffset
				}}
			/>
		</svg>
		{text}
	</div>
}


const AddButton = ({ disabled, text = 'Add', ...props }: { disabled?: boolean, text?: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) => {

	return <button
		disabled={disabled}
		className={`bg-[#0e70c0] px-3 py-1 text-white rounded-sm ${!disabled ? 'hover:bg-[#1177cb] cursor-pointer' : 'opacity-50 cursor-not-allowed bg-opacity-70'}`}
		{...props}
	>{text}</button>

}

// ConfirmButton prompts for a second click to confirm an action, cancels if clicking outside
const ConfirmButton = ({ children, onConfirm, className }: { children: React.ReactNode, onConfirm: () => void, className?: string }) => {
	const [confirm, setConfirm] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!confirm) return;
		const handleClickOutside = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setConfirm(false);
			}
		};
		document.addEventListener('click', handleClickOutside);
		return () => document.removeEventListener('click', handleClickOutside);
	}, [confirm]);
	return (
		<div ref={ref} className={`inline-block`}>
			<voidButtonBgDarken className={className} onClick={() => {
				if (!confirm) {
					setConfirm(true);
				} else {
					onConfirm();
					setConfirm(false);
				}
			}}>
				{confirm ? `Confirm Reset` : children}
			</voidButtonBgDarken>
		</div>
	);
};

// ---------------- Simplified Model Settings Dialog ------------------

// keys of ModelOverrides we allow the user to override



// This new dialog replaces the verbose UI with a single JSON override box.
const SimpleModelSettingsDialog = ({
	isOpen,
	onClose,
	modelInfo,
}: {
	isOpen: boolean;
	onClose: () => void;
	modelInfo: { modelName: string; providerName: ProviderName; type: 'autodetected' | 'custom' | 'default' } | null;
}) => {
	if (!isOpen || !modelInfo) return null;

	const { modelName, providerName, type } = modelInfo;
	const accessor = useAccessor()
	const settingsState = useSettingsState()
	const mouseDownInsideModal = useRef(false); // Ref to track mousedown origin
	const settingsStateService = accessor.get('IvoidSettingsService')

	// current overrides and defaults
	const defaultModelCapabilities = getModelCapabilities(providerName, modelName, undefined);
	const currentOverrides = settingsState.overridesOfModel?.[providerName]?.[modelName] ?? undefined;
	const { recognizedModelName, isUnrecognizedModel } = defaultModelCapabilities

	// Create the placeholder with the default values for allowed keys
	const partialDefaults: Partial<ModelOverrides> = {};
	for (const k of modelOverrideKeys) { if (defaultModelCapabilities[k]) partialDefaults[k] = defaultModelCapabilities[k] as any; }
	const placeholder = JSON.stringify(partialDefaults, null, 2);

	const [overrideEnabled, setOverrideEnabled] = useState<boolean>(() => !!currentOverrides);

	const [errorMsg, setErrorMsg] = useState<string | null>(null);

	const textAreaRef = useRef<HTMLTextAreaElement | null>(null)

	// reset when dialog toggles
	useEffect(() => {
		if (!isOpen) return;
		const cur = settingsState.overridesOfModel?.[providerName]?.[modelName];
		setOverrideEnabled(!!cur);
		setErrorMsg(null);
	}, [isOpen, providerName, modelName, settingsState.overridesOfModel, placeholder]);

	const onSave = async () => {
		// if disabled override, reset overrides
		if (!overrideEnabled) {
			await settingsStateService.setOverridesOfModel(providerName, modelName, undefined);
			onClose();
			return;
		}

		// enabled overrides
		// parse json
		let parsedInput: Record<string, unknown>

		if (textAreaRef.current?.value) {
			try {
				parsedInput = JSON.parse(textAreaRef.current.value);
			} catch (e) {
				setErrorMsg('Invalid JSON');
				return;
			}
		} else {
			setErrorMsg('Invalid JSON');
			return;
		}

		// only keep allowed keys
		const cleaned: Partial<ModelOverrides> = {};
		for (const k of modelOverrideKeys) {
			if (!(k in parsedInput)) continue
			const isEmpty = parsedInput[k] === '' || parsedInput[k] === null || parsedInput[k] === undefined;
			if (!isEmpty) {
				cleaned[k] = parsedInput[k] as any;
			}
		}
		await settingsStateService.setOverridesOfModel(providerName, modelName, cleaned);
		onClose();
	};

	const sourcecodeOverridesLink = `https://github.com/voideditor/void/blob/2e5ecb291d33afbe4565921664fb7e183189c1c5/src/vs/workbench/contrib/void/common/modelCapabilities.ts#L146-L172`

	return (
		<div // Backdrop
			className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999999]"
			onMouseDown={() => {
				mouseDownInsideModal.current = false;
			}}
			onMouseUp={() => {
				if (!mouseDownInsideModal.current) {
					onClose();
				}
				mouseDownInsideModal.current = false;
			}}
		>
			{/* MODAL */}
			<div
				className="bg-void-bg-1 rounded-md p-4 max-w-xl w-full shadow-xl overflow-y-auto max-h-[90vh]"
				onClick={(e) => e.stopPropagation()} // Keep stopping propagation for normal clicks inside
				onMouseDown={(e) => {
					mouseDownInsideModal.current = true;
					e.stopPropagation();
				}}
			>
				<div className="flex justify-between items-center mb-4">
					<h3 className="text-lg font-medium">
						Change Defaults for {modelName} ({displayInfoOfProviderName(providerName).title})
					</h3>
					<button
						onClick={onClose}
						className="text-void-fg-3 hover:text-void-fg-1"
					>
						<X className="size-5" />
					</button>
				</div>

				{/* Display model recognition status */}
				<div className="text-sm text-void-fg-3 mb-4">
					{type === 'default' ? `${modelName} comes packaged with void, so you shouldn't need to change these settings.`
						: isUnrecognizedModel
							? `Model not recognized by void.`
							: `void recognizes ${modelName} ("${recognizedModelName}").`}
				</div>


				{/* override toggle */}
				<div className="flex items-center gap-2 mb-4">
					<voidSwitch size='xs' value={overrideEnabled} onChange={setOverrideEnabled} />
					<span className="text-void-fg-3 text-sm">Override model defaults</span>
				</div>

				{/* Informational link */}
				{overrideEnabled && <div className="text-sm text-void-fg-3 mb-4">
					<ChatMarkdownRender string={`See the [sourcecode](${sourcecodeOverridesLink}) for a reference on how to set this JSON (advanced).`} chatMessageLocation={undefined} />
				</div>}

				<textarea
					key={overrideEnabled + ''}
					ref={textAreaRef}
					className={`w-full min-h-[200px] p-2 rounded-sm border border-void-border-2 bg-void-bg-2 resize-none font-mono text-sm ${!overrideEnabled ? 'text-void-fg-3' : ''}`}
					defaultValue={overrideEnabled && currentOverrides ? JSON.stringify(currentOverrides, null, 2) : placeholder}
					placeholder={placeholder}
					readOnly={!overrideEnabled}
				/>
				{errorMsg && (
					<div className="text-red-500 mt-2 text-sm">{errorMsg}</div>
				)}


				<div className="flex justify-end gap-2 mt-4">
					<voidButtonBgDarken onClick={onClose} className="px-3 py-1">
						Cancel
					</voidButtonBgDarken>
					<voidButtonBgDarken
						onClick={onSave}
						className="px-3 py-1 bg-[#0e70c0] text-white"
					>
						Save
					</voidButtonBgDarken>
				</div>
			</div>
		</div>
	);
};




export const ModelDump = ({ filteredProviders }: { filteredProviders?: ProviderName[] }) => {
	const accessor = useAccessor()
	const settingsStateService = accessor.get('IvoidSettingsService')
	const settingsState = useSettingsState()

	// State to track which model's settings dialog is open
	const [openSettingsModel, setOpenSettingsModel] = useState<{
		modelName: string,
		providerName: ProviderName,
		type: 'custom' | 'default'
	} | null>(null);

	// States for add model functionality
	const [isAddModelOpen, setIsAddModelOpen] = useState(false);
	const [showCheckmark, setShowCheckmark] = useState(false);
	const [userChosenProviderName, setUserChosenProviderName] = useState<ProviderName | null>(null);
	const [modelName, setModelName] = useState<string>('');
	const [errorString, setErrorString] = useState('');

	// a dump of all the enabled providers' models
	const modelDump: (voidStatefulModelInfo & { providerName: ProviderName, providerEnabled: boolean })[] = []

	// Use either filtered providers or all providers
	const providersToShow = filteredProviders || providerNames;

	for (let providerName of providersToShow) {
		const providerSettings = settingsState.settingsOfProvider[providerName]
		// if (!providerSettings.enabled) continue
		modelDump.push(...providerSettings.models.map(model => ({ ...model, providerName, providerEnabled: !!providerSettings._didFillInProviderSettings })))
	}

	// sort by hidden
	modelDump.sort((a, b) => {
		return Number(b.providerEnabled) - Number(a.providerEnabled)
	})

	// Add model handler
	const handleAddModel = () => {
		if (!userChosenProviderName) {
			setErrorString('Please select a provider.');
			return;
		}
		if (!modelName) {
			setErrorString('Please enter a model name.');
			return;
		}

		// Check if model already exists
		if (settingsState.settingsOfProvider[userChosenProviderName].models.find(m => m.modelName === modelName)) {
			setErrorString(`This model already exists.`);
			return;
		}

		settingsStateService.addModel(userChosenProviderName, modelName);
		setShowCheckmark(true);
		setTimeout(() => {
			setShowCheckmark(false);
			setIsAddModelOpen(false);
			setUserChosenProviderName(null);
			setModelName('');
		}, 1500);
		setErrorString('');
	};

	return <div className=''>
		{modelDump.map((m, i) => {
			const { isHidden, type, modelName, providerName, providerEnabled } = m

			const isNewProviderName = (i > 0 ? modelDump[i - 1] : undefined)?.providerName !== providerName

			const providerTitle = displayInfoOfProviderName(providerName).title

			const disabled = !providerEnabled
			const value = disabled ? false : !isHidden

			const tooltipName = (
				disabled ? `Add ${providerTitle} to enable`
					: value === true ? 'Show in Dropdown'
						: 'Hide from Dropdown'
			)


			const detailAboutModel = type === 'custom' ?
					<Asterisk size={14} className="inline-block align-text-top brightness-115 stroke-[2] text-[#0e70c0]" data-tooltip-id='void-tooltip' data-tooltip-place='right' data-tooltip-content='Custom model' />
					: undefined

			const hasOverrides = !!settingsState.overridesOfModel?.[providerName]?.[modelName]

			return <div key={`${modelName}${providerName}`}
				className={`flex items-center justify-between gap-4 hover:bg-black/10 dark:hover:bg-gray-300/10 py-1 px-3 rounded-sm overflow-hidden cursor-default truncate group
				`}
			>
				{/* left part is width:full */}
				<div className={`flex flex-grow items-center gap-4`}>
					<span className='w-full max-w-32'>{isNewProviderName ? providerTitle : ''}</span>
					<span className='w-fit max-w-[400px] truncate'>{modelName}</span>
				</div>

				{/* right part is anything that fits */}
				<div className="flex items-center gap-2 w-fit">

					{/* Advanced Settings button (gear). Hide entirely when provider/model disabled. */}
					{disabled ? null : (
						<div className="w-5 flex items-center justify-center">
							<button
								onClick={() => { setOpenSettingsModel({ modelName, providerName, type: type as any }) }}
								data-tooltip-id='void-tooltip'
								data-tooltip-place='right'
								data-tooltip-content='Advanced Settings'
								className={`${hasOverrides ? '' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}
							>
								<Plus size={12} className="text-void-fg-3 opacity-50" />
							</button>
						</div>
					)}

					{/* Blue star */}
					{detailAboutModel}


					{/* Switch */}
					<voidSwitch
						value={value}
						onChange={() => { settingsStateService.toggleModelHidden(providerName, modelName); }}
						disabled={disabled}
						size='sm'

						data-tooltip-id='void-tooltip'
						data-tooltip-place='right'
						data-tooltip-content={tooltipName}
					/>

					{/* X button */}
					<div className={`w-5 flex items-center justify-center`}>
						{type === 'default' ? null : <button
							onClick={() => { settingsStateService.deleteModel(providerName, modelName); }}
							data-tooltip-id='void-tooltip'
							data-tooltip-place='right'
							data-tooltip-content='Delete'
							className={`${hasOverrides ? '' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}
						>
							<X size={12} className="text-void-fg-3 opacity-50" />
						</button>}
					</div>
				</div>
			</div>
		})}

		{/* Add Model Section */}
		{showCheckmark ? (
			<div className="mt-4">
				<AnimatedCheckmarkButton text='Added' className="bg-[#0e70c0] text-white px-3 py-1 rounded-sm" />
			</div>
		) : isAddModelOpen ? (
			<div className="mt-4">
				<form className="flex items-center gap-2">

					{/* Provider dropdown */}
					<ErrorBoundary>
						<voidCustomDropdownBox
							options={providersToShow}
							selectedOption={userChosenProviderName}
							onChangeOption={(pn) => setUserChosenProviderName(pn)}
							getOptionDisplayName={(pn) => pn ? displayInfoOfProviderName(pn).title : 'Provider Name'}
							getOptionDropdownName={(pn) => pn ? displayInfoOfProviderName(pn).title : 'Provider Name'}
							getOptionsEqual={(a, b) => a === b}
							className="max-w-32 mx-2 w-full resize-none bg-void-bg-1 text-void-fg-1 placeholder:text-void-fg-3 border border-void-border-2 focus:border-void-border-1 py-1 px-2 rounded"
							arrowTouchesText={false}
						/>
					</ErrorBoundary>

					{/* Model name input */}
					<ErrorBoundary>
						<voidSimpleInputBox
							value={modelName}
							compact={true}
							onChangeValue={setModelName}
							placeholder='Model Name'
							className='max-w-32'
						/>
					</ErrorBoundary>

					{/* Add button */}
					<ErrorBoundary>
						<AddButton
							type='button'
							disabled={!modelName || !userChosenProviderName}
							onClick={handleAddModel}
						/>
					</ErrorBoundary>

					{/* X button to cancel */}
					<button
						type="button"
						onClick={() => {
							setIsAddModelOpen(false);
							setErrorString('');
							setModelName('');
							setUserChosenProviderName(null);
						}}
						className='text-void-fg-4'
					>
						<X className='size-4' />
					</button>
				</form>

				{errorString && (
					<div className='text-red-500 truncate whitespace-nowrap mt-1'>
						{errorString}
					</div>
				)}
			</div>
		) : (
			<div
				className="text-void-fg-4 flex flex-nowrap text-nowrap items-center hover:brightness-110 cursor-pointer mt-4"
				onClick={() => setIsAddModelOpen(true)}
			>
				<div className="flex items-center gap-1">
					<Plus size={16} />
					<span>Add a model</span>
				</div>
			</div>
		)}

		{/* Model Settings Dialog */}
		<SimpleModelSettingsDialog
			isOpen={openSettingsModel !== null}
			onClose={() => setOpenSettingsModel(null)}
			modelInfo={openSettingsModel}
		/>
	</div>
}



// providers

const ProviderSetting = ({ providerName, settingName, subTextMd }: { providerName: ProviderName, settingName: SettingName, subTextMd: React.ReactNode }) => {

	const { title: settingTitle, placeholder, isPasswordField } = displayInfoOfSettingName(providerName, settingName)

	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IvoidSettingsService')
	const settingsState = useSettingsState()

	const settingValue = settingsState.settingsOfProvider[providerName][settingName] as string // this should always be a string in this component
	if (typeof settingValue !== 'string') {
		console.log('Error: Provider setting had a non-string value.')
		return
	}

	// Create a stable callback reference using useCallback with proper dependencies
	const handleChangeValue = useCallback((newVal: string) => {
		voidSettingsService.setSettingOfProvider(providerName, settingName, newVal)
	}, [voidSettingsService, providerName, settingName]);

	return <ErrorBoundary>
		<div className='my-1'>
			<voidSimpleInputBox
				value={settingValue}
				onChangeValue={handleChangeValue}
				placeholder={`${settingTitle} (${placeholder})`}
				passwordBlur={isPasswordField}
				compact={true}
			/>
			{!subTextMd ? null : <div className='py-1 px-3 opacity-50 text-sm'>
				{subTextMd}
			</div>}
		</div>
	</ErrorBoundary>
}

// const OldSettingsForProvider = ({ providerName, showProviderTitle }: { providerName: ProviderName, showProviderTitle: boolean }) => {
// 	const voidSettingsState = useSettingsState()

// 	const needsModel = isProviderNameDisabled(providerName, voidSettingsState) === 'addModel'

// 	// const accessor = useAccessor()
// 	// const voidSettingsService = accessor.get('IvoidSettingsService')

// 	// const { enabled } = voidSettingsState.settingsOfProvider[providerName]
// 	const settingNames = customSettingNamesOfProvider(providerName)

// 	const { title: providerTitle } = displayInfoOfProviderName(providerName)

// 	return <div className='my-4'>

// 		<div className='flex items-center w-full gap-4'>
// 			{showProviderTitle && <h3 className='text-xl truncate'>{providerTitle}</h3>}

// 			{/* enable provider switch */}
// 			{/* <voidSwitch
// 				value={!!enabled}
// 				onChange={
// 					useCallback(() => {
// 						const enabledRef = voidSettingsService.state.settingsOfProvider[providerName].enabled
// 						voidSettingsService.setSettingOfProvider(providerName, 'enabled', !enabledRef)
// 					}, [voidSettingsService, providerName])}
// 				size='sm+'
// 			/> */}
// 		</div>

// 		<div className='px-0'>
// 			{/* settings besides models (e.g. api key) */}
// 			{settingNames.map((settingName, i) => {
// 				return <ProviderSetting key={settingName} providerName={providerName} settingName={settingName} />
// 			})}

// 			{needsModel ?
// 				providerName === 'ollama' ?
// 					<WarningBox text={`Please install an Ollama model. We'll auto-detect it.`} />
// 					: <WarningBox text={`Please add a model for ${providerTitle} (Models section).`} />
// 				: null}
// 		</div>
// 	</div >
// }


export const SettingsForProvider = ({ providerName, showProviderTitle, showProviderSuggestions }: { providerName: ProviderName, showProviderTitle: boolean, showProviderSuggestions: boolean }) => {
	const voidSettingsState = useSettingsState()

	const needsModel = isProviderNameDisabled(providerName, voidSettingsState) === 'addModel'

	// const accessor = useAccessor()
	// const voidSettingsService = accessor.get('IvoidSettingsService')

	// const { enabled } = voidSettingsState.settingsOfProvider[providerName]
	const settingNames = customSettingNamesOfProvider(providerName)

	const { title: providerTitle } = displayInfoOfProviderName(providerName)

	return <div>

		<div className='flex items-center w-full gap-4'>
			{showProviderTitle && <h3 className='text-xl truncate'>{providerTitle}</h3>}

			{/* enable provider switch */}
			{/* <voidSwitch
				value={!!enabled}
				onChange={
					useCallback(() => {
						const enabledRef = voidSettingsService.state.settingsOfProvider[providerName].enabled
						voidSettingsService.setSettingOfProvider(providerName, 'enabled', !enabledRef)
					}, [voidSettingsService, providerName])}
				size='sm+'
			/> */}
		</div>

		<div className='px-0'>
			{/* settings besides models (e.g. api key) */}
			{settingNames.map((settingName, i) => {

				return <ProviderSetting
					key={settingName}
					providerName={providerName}
					settingName={settingName}
					subTextMd={i !== settingNames.length - 1 ? null
						: <ChatMarkdownRender string={subTextMdOfProviderName(providerName)} chatMessageLocation={undefined} />}
				/>
			})}

			{showProviderSuggestions && needsModel ?
				<WarningBox className="pl-2 mb-4" text={`Please add a model for ${providerTitle} (Models section).`} />
				: null}
		</div>
	</div >
}


export const voidProviderSettings = ({ providerNames }: { providerNames: ProviderName[] }) => {
	return <>
		{providerNames.map(providerName =>
			<SettingsForProvider key={providerName} providerName={providerName} showProviderTitle={true} showProviderSuggestions={true} />
		)}
	</>
}


export const AIInstructionsBox = () => {
	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IvoidSettingsService')
	const voidSettingsState = useSettingsState()
	return <voidInputBox2
		className='min-h-[81px] p-3 rounded-sm'
		initValue={voidSettingsState.globalSettings.aiInstructions}
		placeholder={`Do not change my indentation or delete my comments. When writing TS or JS, do not add ;'s. Write new code using Rust if possible. `}
		multiline
		onChangeText={(newText) => {
			voidSettingsService.setGlobalSetting('aiInstructions', newText)
		}}
	/>
}

const FastApplyMethodDropdown = () => {
	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IvoidSettingsService')

	const options = useMemo(() => [true, false], [])

	const onChangeOption = useCallback((newVal: boolean) => {
		voidSettingsService.setGlobalSetting('enableFastApply', newVal)
	}, [voidSettingsService])

	return <voidCustomDropdownBox
		className='text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-1 rounded p-0.5 px-1'
		options={options}
		selectedOption={voidSettingsService.state.globalSettings.enableFastApply}
		onChangeOption={onChangeOption}
		getOptionDisplayName={(val) => val ? 'Fast Apply' : 'Slow Apply'}
		getOptionDropdownName={(val) => val ? 'Fast Apply' : 'Slow Apply'}
		getOptionDropdownDetail={(val) => val ? 'Output Search/Replace blocks' : 'Rewrite whole files'}
		getOptionsEqual={(a, b) => a === b}
	/>

}




const RedoOnboardingButton = ({ className }: { className?: string }) => {
	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IvoidSettingsService')
	return <div
		className={`text-void-fg-4 flex flex-nowrap text-nowrap items-center hover:brightness-110 cursor-pointer ${className}`}
		onClick={() => { voidSettingsService.setGlobalSetting('isOnboardingComplete', false) }}
	>
		See onboarding screen?
	</div>

}







export const ToolApprovalTypeSwitch = ({ approvalType, size, desc }: { approvalType: ToolApprovalType, size: "xxs" | "xs" | "sm" | "sm+" | "md", desc: string }) => {
	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IvoidSettingsService')
	const voidSettingsState = useSettingsState()
	const metricsService = accessor.get('IMetricsService')

	const onToggleAutoApprove = useCallback((approvalType: ToolApprovalType, newValue: boolean) => {
		voidSettingsService.setGlobalSetting('autoApprove', {
			...voidSettingsService.state.globalSettings.autoApprove,
			[approvalType]: newValue
		})
		metricsService.capture('Tool Auto-Accept Toggle', { enabled: newValue })
	}, [voidSettingsService, metricsService])

	return <>
		<voidSwitch
			size={size}
			value={voidSettingsState.globalSettings.autoApprove[approvalType] ?? false}
			onChange={(newVal) => onToggleAutoApprove(approvalType, newVal)}
		/>
		<span className="text-void-fg-3 text-xs">{desc}</span>
	</>
}



export const OneClickSwitchButton = ({ fromEditor = 'VS Code', className = '' }: { fromEditor?: TransferEditorType, className?: string }) => {
	const accessor = useAccessor()
	const extensionTransferService = accessor.get('IExtensionTransferService')

	const [transferState, setTransferState] = useState<{ type: 'done', error?: string } | { type: | 'loading' | 'justfinished' }>({ type: 'done' })



	const onClick = async () => {
		if (transferState.type !== 'done') return

		setTransferState({ type: 'loading' })

		const errAcc = await extensionTransferService.transferExtensions(os, fromEditor)

		// Even if some files were missing, consider it a success if no actual errors occurred
		const hadError = !!errAcc
		if (hadError) {
			setTransferState({ type: 'done', error: errAcc })
		}
		else {
			setTransferState({ type: 'justfinished' })
			setTimeout(() => { setTransferState({ type: 'done' }); }, 3000)
		}
	}

	return <>
		<voidButtonBgDarken className={`max-w-48 p-4 ${className}`} disabled={transferState.type !== 'done'} onClick={onClick}>
			{transferState.type === 'done' ? `Transfer from ${fromEditor}`
				: transferState.type === 'loading' ? <span className='text-nowrap flex flex-nowrap'>Transferring<IconLoading /></span>
					: transferState.type === 'justfinished' ? <AnimatedCheckmarkButton text='Settings Transferred' className='bg-none' />
						: null
			}
		</voidButtonBgDarken>
		{transferState.type === 'done' && transferState.error ? <WarningBox text={transferState.error} /> : null}
	</>
}


// full settings

// MCP Server component
const MCPServerComponent = ({ name, server }: { name: string, server: MCPServer }) => {
	const accessor = useAccessor();
	const mcpService = accessor.get('IMCPService');

	const voidSettings = useSettingsState()
	const isOn = voidSettings.mcpUserStateOfName[name]?.isOn

	const removeUniquePrefix = (name: string) => name.split('_').slice(1).join('_')

	return (
		<div className="border border-void-border-2 bg-void-bg-1 py-3 px-4 rounded-sm my-2">
			<div className="flex items-center justify-between">
				{/* Left side - status and name */}
				<div className="flex items-center gap-2">
					{/* Status indicator */}
					<div className={`w-2 h-2 rounded-full
						${server.status === 'success' ? 'bg-green-500'
							: server.status === 'error' ? 'bg-red-500'
								: server.status === 'loading' ? 'bg-yellow-500'
									: server.status === 'offline' ? 'bg-void-fg-3'
										: ''}
					`}></div>

					{/* Server name */}
					<div className="text-sm font-medium text-void-fg-1">{name}</div>
				</div>

				{/* Right side - power toggle switch */}
				<voidSwitch
					value={isOn ?? false}
					size='xs'
					disabled={server.status === 'error'}
					onChange={() => mcpService.toggleServerIsOn(name, !isOn)}
				/>
			</div>

			{/* Tools section */}
			{isOn && (
				<div className="mt-3">
					<div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
						{(server.tools ?? []).length > 0 ? (
							(server.tools ?? []).map((tool: { name: string; description?: string }) => (
								<span
									key={tool.name}
									className="px-2 py-0.5 bg-void-bg-2 text-void-fg-3 rounded-sm text-xs"

									data-tooltip-id='void-tooltip'
									data-tooltip-content={tool.description || ''}
									data-tooltip-class-name='void-max-w-[300px]'
								>
									{removeUniquePrefix(tool.name)}
								</span>
							))
						) : (
							<span className="text-xs text-void-fg-3">No tools available</span>
						)}
					</div>
				</div>
			)}

			{/* Command badge */}
			{isOn && server.command && (
				<div className="mt-3">
					<div className="text-xs text-void-fg-3 mb-1">Command:</div>
					<div className="px-2 py-1 bg-void-bg-2 text-xs font-mono overflow-x-auto whitespace-nowrap text-void-fg-2 rounded-sm">
						{server.command}
					</div>
				</div>
			)}

			{/* Error message if present */}
			{server.error && (
				<div className="mt-3">
					<WarningBox text={server.error} />
				</div>
			)}
		</div>
	);
};

// Main component that renders the list of servers
const MCPServersList = () => {
	const mcpServiceState = useMCPServiceState()

	let content: React.ReactNode
	if (mcpServiceState.error) {
		content = <div className="text-void-fg-3 text-sm mt-2">
			{mcpServiceState.error}
		</div>
	}
	else {
		const entries = Object.entries(mcpServiceState.mcpServerOfName)
		if (entries.length === 0) {
			content = <div className="text-void-fg-3 text-sm mt-2">
				No servers found
			</div>
		}
		else {
			content = entries.map(([name, server]) => (
				<MCPServerComponent key={name} name={name} server={server} />
			))
		}
	}

	return <div className="my-2">{content}</div>
};

// ─── Layout helper components ─────────────────────────────

const SettingRow = ({ title, description, children, noBorder }: {
	title: string | React.ReactNode;
	description?: string | React.ReactNode;
	children?: React.ReactNode;
	noBorder?: boolean;
}) => (
	<div className={`flex items-center justify-between py-3.5 px-4 ${noBorder ? '' : 'border-b border-void-border-1/50'}`}>
		<div className="flex-1 min-w-0 pr-4">
			<div className="text-sm font-medium text-void-fg-1">{title}</div>
			{description && <div className="text-xs text-void-fg-3 mt-0.5">{description}</div>}
		</div>
		{children && <div className="shrink-0 flex items-center">{children}</div>}
	</div>
);

const SectionLabel = ({ label }: { label: string }) => (
	<div className="text-[11px] text-void-fg-3 uppercase tracking-wider mt-6 mb-1 px-4 font-medium">{label}</div>
);

const SettingCard = ({ children }: { children: React.ReactNode }) => (
	<div className="rounded-lg border border-void-border-1/50 bg-void-bg-1/30 overflow-hidden">
		{children}
	</div>
);

const OpenButton = ({ onClick, text = 'Open' }: { onClick: () => void; text?: string }) => (
	<button
		onClick={onClick}
		className="px-3.5 py-1 text-xs border border-void-border-1 rounded-md hover:bg-void-bg-2 text-void-fg-1 cursor-pointer transition-colors"
	>
		{text}
	</button>
);

// ─── Agents & Rules Tab ─────────────────────────────

const AgentsAndRulesTab = () => {
	const accessor = useAccessor()
	const settingsState = useSettingsState()
	const voidSettingsService = accessor.get('IvoidSettingsService')
	const fileService = accessor.get('IFileService')
	const commandService = accessor.get('ICommandService')
	const workspaceContextService = accessor.get('IWorkspaceContextService')
	const agents = useAgentRegistry()
	const rules = useRules()

	const createNewAgent = useCallback(async () => {
		const folders = workspaceContextService.getWorkspace().folders
		if (folders.length === 0) return
		const agentsDir = URI.joinPath(folders[0].uri, '.void', 'agents')
		const templateUri = URI.joinPath(agentsDir, 'my-agent.md')
		const templateContent = `---
name: My Agent
description: A custom agent
model: inherit
readonly: false
timeout: 120000
maxIterations: 25
---

You are a custom agent. Describe your agent's behavior here.
`
		try {
			await fileService.createFolder(agentsDir)
		} catch { /* already exists */ }
		await fileService.writeFile(templateUri, VSBuffer.fromString(templateContent))
		await commandService.executeCommand('vscode.open', templateUri)
	}, [fileService, commandService, workspaceContextService])

	const createNewRule = useCallback(async () => {
		const folders = workspaceContextService.getWorkspace().folders
		if (folders.length === 0) return
		const rulesDir = URI.joinPath(folders[0].uri, '.void', 'rules')
		const templateUri = URI.joinPath(rulesDir, 'my-rule.md')
		const templateContent = `---
description: A custom rule
globs:
alwaysApply: true
---

Describe your rule here.
`
		try {
			await fileService.createFolder(rulesDir)
		} catch { /* already exists */ }
		await fileService.writeFile(templateUri, VSBuffer.fromString(templateContent))
		await commandService.executeCommand('vscode.open', templateUri)
	}, [fileService, commandService, workspaceContextService])

	return (
		<div>
			<h1 className='text-xl font-semibold mb-6'>Agents & Rules</h1>

			{/* Agent List */}
			<SectionLabel label="Available Agents" />
			<SettingCard>
				{agents.map((agent, i) => (
					<SettingRow
						key={agent.id}
						title={agent.name}
						description={agent.description}
						noBorder={i === agents.length - 1}
					>
						<span className="text-xs text-void-fg-3">
							{agent.source === 'builtin' ? 'Built-in' : agent.source === 'project' ? 'Project' : 'User'}
						</span>
					</SettingRow>
				))}
				{agents.length === 0 && (
					<SettingRow title="No agents found" description="Create a custom agent to get started" noBorder>
						<span />
					</SettingRow>
				)}
			</SettingCard>
			<div className='mt-2 px-4'>
				<OpenButton text="+ New Agent" onClick={createNewAgent} />
			</div>

			{/* Rules List */}
			<SectionLabel label="Rules" />
			<SettingCard>
				{rules.map((rule, i) => (
					<SettingRow
						key={rule.name}
						title={rule.name}
						description={`${rule.description}${rule.globs && rule.globs.length ? ' | ' + rule.globs.join(', ') : ''}`}
						noBorder={i === rules.length - 1}
					>
						{rule.alwaysApply && <span className="text-xs text-void-fg-3">Always</span>}
					</SettingRow>
				))}
				{rules.length === 0 && (
					<SettingRow title="No rules found" description="Create a rule in .void/rules/" noBorder>
						<span />
					</SettingRow>
				)}
			</SettingCard>
			<div className='mt-2 px-4'>
				<OpenButton text="+ New Rule" onClick={createNewRule} />
			</div>

			{/* Memory */}
			<SectionLabel label="Memory" />
			<SettingCard>
				<SettingRow title="Enable Memory" description="Allow the AI to remember context across sessions">
					<voidSwitch size='sm' value={settingsState.globalSettings.memoryConfig?.enabled ?? false} onChange={(newVal) => {
						voidSettingsService.setGlobalSetting('memoryConfig', {
							...settingsState.globalSettings.memoryConfig,
							enabled: newVal,
						})
					}} />
				</SettingRow>
				{settingsState.globalSettings.memoryConfig?.enabled && (
					<>
						<SettingRow title="Max Memories" description="Maximum number of stored memories (10-500)">
							<voidSimpleInputBox
								className='w-16 text-xs text-center'
								placeholder='100'
								value={String(settingsState.globalSettings.memoryConfig?.maxMemories ?? 100)}
								onChangeValue={(newVal) => {
									const num = Math.max(10, Math.min(500, parseInt(newVal) || 100))
									voidSettingsService.setGlobalSetting('memoryConfig', {
										...settingsState.globalSettings.memoryConfig,
										maxMemories: num,
									})
								}}
							/>
						</SettingRow>
						<SettingRow title="Auto-Extract Memories" description="Automatically extract memories after each agent loop" noBorder>
							<voidSwitch size='sm' value={settingsState.globalSettings.memoryConfig?.autoExtract ?? false} onChange={(newVal) => {
								voidSettingsService.setGlobalSetting('memoryConfig', {
									...settingsState.globalSettings.memoryConfig,
									autoExtract: newVal,
								})
							}} />
						</SettingRow>
					</>
				)}
			</SettingCard>

			{/* Self-Healing */}
			<SectionLabel label="Self-Healing" />
			<SettingCard>
				<SettingRow title="Enable Self-Healing" description="Automatically enrich terminal errors with file context for smarter fixes">
					<voidSwitch size='sm' value={settingsState.globalSettings.selfHealingConfig?.enabled ?? true} onChange={(newVal) => {
						voidSettingsService.setGlobalSetting('selfHealingConfig', {
							...settingsState.globalSettings.selfHealingConfig,
							enabled: newVal,
						})
					}} />
				</SettingRow>
				{settingsState.globalSettings.selfHealingConfig?.enabled && (
					<>
						<SettingRow title="Max Healing Attempts" description="Maximum attempts before escalating to user (1-5)">
							<voidSimpleInputBox
								className='w-16 text-xs text-center'
								placeholder='3'
								value={String(settingsState.globalSettings.selfHealingConfig?.maxHealingAttempts ?? 3)}
								onChangeValue={(newVal) => {
									const num = Math.max(1, Math.min(5, parseInt(newVal) || 3))
									voidSettingsService.setGlobalSetting('selfHealingConfig', {
										...settingsState.globalSettings.selfHealingConfig,
										maxHealingAttempts: num,
									})
								}}
							/>
						</SettingRow>
						<SettingRow title="Auto-Read Error Context" description="Automatically read source files at error locations" noBorder>
							<voidSwitch size='sm' value={settingsState.globalSettings.selfHealingConfig?.autoReadErrorContext ?? true} onChange={(newVal) => {
								voidSettingsService.setGlobalSetting('selfHealingConfig', {
									...settingsState.globalSettings.selfHealingConfig,
									autoReadErrorContext: newVal,
								})
							}} />
						</SettingRow>
					</>
				)}
			</SettingCard>

			{/* Verification Pipeline */}
			<SectionLabel label="Verification Pipeline" />
			<SettingCard>
				<SettingRow title="Enable Verification Pipeline" description="Enable the run_verification tool for build/test pipeline execution">
					<voidSwitch size='sm' value={settingsState.globalSettings.verificationPipelineConfig?.enabled ?? false} onChange={(newVal) => {
						voidSettingsService.setGlobalSetting('verificationPipelineConfig', {
							...settingsState.globalSettings.verificationPipelineConfig,
							enabled: newVal,
						})
					}} />
				</SettingRow>
				{settingsState.globalSettings.verificationPipelineConfig?.enabled && (
					<SettingRow title="Stop on First Failure" description="Stop the pipeline when the first step fails" noBorder>
						<voidSwitch size='sm' value={settingsState.globalSettings.verificationPipelineConfig?.stopOnFirstFailure ?? true} onChange={(newVal) => {
							voidSettingsService.setGlobalSetting('verificationPipelineConfig', {
								...settingsState.globalSettings.verificationPipelineConfig,
								stopOnFirstFailure: newVal,
							})
						}} />
					</SettingRow>
				)}
			</SettingCard>

			{/* Parallel Agents */}
			<SectionLabel label="Parallel Agents" />
			<SettingCard>
				<SettingRow title="Enable Parallel Agents" description="Allow spawning parallel agents in separate worktrees">
					<voidSwitch size='sm' value={settingsState.globalSettings.parallelAgentConfig?.enabled ?? false} onChange={(newVal) => {
						voidSettingsService.setGlobalSetting('parallelAgentConfig', {
							...settingsState.globalSettings.parallelAgentConfig,
							enabled: newVal,
						})
					}} />
				</SettingRow>
				{settingsState.globalSettings.parallelAgentConfig?.enabled && (
					<>
						<SettingRow title="Max Parallel Agents" description="Maximum concurrent worktree agents (1-10)">
							<voidSimpleInputBox
								className='w-16 text-xs text-center'
								placeholder='3'
								value={String(settingsState.globalSettings.parallelAgentConfig?.maxParallelAgents ?? 3)}
								onChangeValue={(newVal) => {
									const num = Math.max(1, Math.min(10, parseInt(newVal) || 3))
									voidSettingsService.setGlobalSetting('parallelAgentConfig', {
										...settingsState.globalSettings.parallelAgentConfig,
										maxParallelAgents: num,
									})
								}}
							/>
						</SettingRow>
						<SettingRow title="Cleanup After Merge" description="Auto-remove worktrees after merge or rejection" noBorder>
							<voidSwitch size='sm' value={settingsState.globalSettings.parallelAgentConfig?.cleanupAfterMerge ?? true} onChange={(newVal) => {
								voidSettingsService.setGlobalSetting('parallelAgentConfig', {
									...settingsState.globalSettings.parallelAgentConfig,
									cleanupAfterMerge: newVal,
								})
							}} />
						</SettingRow>
					</>
				)}
			</SettingCard>

			{/* Background Agents */}
			<SectionLabel label="Background Agents" />
			<SettingCard>
				<SettingRow title="Enable Background Agents" description="Allow agents to run in the background">
					<voidSwitch size='sm' value={settingsState.globalSettings.backgroundAgentConfig?.enabled ?? false} onChange={(newVal) => {
						voidSettingsService.setGlobalSetting('backgroundAgentConfig', {
							...settingsState.globalSettings.backgroundAgentConfig,
							enabled: newVal,
						})
					}} />
				</SettingRow>
				{settingsState.globalSettings.backgroundAgentConfig?.enabled && (
					<>
						<SettingRow title="Max Background Agents" description="Maximum concurrent background agents (1-20)">
							<voidSimpleInputBox
								className='w-16 text-xs text-center'
								placeholder='5'
								value={String(settingsState.globalSettings.backgroundAgentConfig?.maxBackgroundAgents ?? 5)}
								onChangeValue={(newVal) => {
									const num = Math.max(1, Math.min(20, parseInt(newVal) || 5))
									voidSettingsService.setGlobalSetting('backgroundAgentConfig', {
										...settingsState.globalSettings.backgroundAgentConfig,
										maxBackgroundAgents: num,
									})
								}}
							/>
						</SettingRow>
						<SettingRow title="Notify on Completion" description="Show notification when a background agent finishes" noBorder>
							<voidSwitch size='sm' value={settingsState.globalSettings.backgroundAgentConfig?.notifyOnCompletion ?? true} onChange={(newVal) => {
								voidSettingsService.setGlobalSetting('backgroundAgentConfig', {
									...settingsState.globalSettings.backgroundAgentConfig,
									notifyOnCompletion: newVal,
								})
							}} />
						</SettingRow>
					</>
				)}
			</SettingCard>
		</div>
	)
}

// ─── Indexing Tab ─────────────────────────────

const IndexingTab = () => {
	const accessor = useAccessor()
	const settingsState = useSettingsState()
	const voidSettingsService = accessor.get('IvoidSettingsService')
	const embeddingsService = accessor.get('IEmbeddingsService')
	const fileService = accessor.get('IFileService')
	const commandService = accessor.get('ICommandService')
	const workspaceContextService = accessor.get('IWorkspaceContextService')
	const status = useIndexStatus()

	const embeddingsConfig = settingsState.globalSettings.embeddingsConfig

	const openOrCreatevoidignore = useCallback(async () => {
		const folders = workspaceContextService.getWorkspace().folders
		if (folders.length === 0) return
		const uri = URI.joinPath(folders[0].uri, '.voidignore')
		try {
			await fileService.readFile(uri)
		} catch {
			const defaultContent = `# Files and folders to exclude from codebase indexing
# Uses glob patterns, one per line

node_modules/
dist/
build/
.git/
*.min.js
*.map
`
				await fileService.writeFile(uri, VSBuffer.fromString(defaultContent))
		}
		await commandService.executeCommand('vscode.open', uri)
	}, [fileService, commandService, workspaceContextService])

	return (
		<div>
			<h1 className='text-xl font-semibold mb-6'>Indexing</h1>

			{/* Codebase Search */}
			<SectionLabel label="Codebase Search" />
			<SettingCard>
				<SettingRow title="Enable Codebase Indexing" description="Index workspace for semantic code search">
					<voidSwitch size='sm' value={embeddingsConfig?.enabled ?? false} onChange={(newVal) => {
						voidSettingsService.setGlobalSetting('embeddingsConfig', {
							...embeddingsConfig,
							enabled: newVal,
						})
					}} />
				</SettingRow>
				{embeddingsConfig?.enabled && (
					<>
						<SettingRow title="Index Status" description={
							status.state === 'indexing'
								? `Indexing... ${status.indexedFiles}/${status.totalFiles} files (${status.progress}%)`
								: status.state === 'indexed'
									? `${status.indexedFiles} files indexed`
									: 'Not indexed'
						}>
							{status.state === 'indexing' ? (
								<div className="flex items-center gap-2">
									<div className="w-24 h-1.5 bg-void-bg-2 rounded-full overflow-hidden">
										<div
											className="h-full bg-void-fg-3 rounded-full transition-all duration-300"
											style={{ width: `${status.progress}%` }}
										/>
									</div>
									<span className="text-xs text-void-fg-3">{status.progress}%</span>
								</div>
							) : (
								<OpenButton text="Re-index" onClick={() => embeddingsService.reindex()} />
							)}
						</SettingRow>
						<SettingRow title="Re-index on Save" description="Automatically update index when files change">
							<voidSwitch size='sm' value={embeddingsConfig?.reindexOnSave ?? true} onChange={(newVal) => {
								voidSettingsService.setGlobalSetting('embeddingsConfig', {
									...embeddingsConfig,
									reindexOnSave: newVal,
								})
							}} />
						</SettingRow>
						<SettingRow title="Max Search Results" description="Maximum number of search results returned (1-50)" noBorder>
							<voidSimpleInputBox
								className='w-16 text-xs text-center'
								placeholder='10'
								value={String(embeddingsConfig?.maxResults ?? 10)}
								onChangeValue={(newVal) => {
									const num = Math.max(1, Math.min(50, parseInt(newVal) || 10))
									voidSettingsService.setGlobalSetting('embeddingsConfig', {
										...embeddingsConfig,
										maxResults: num,
									})
								}}
							/>
						</SettingRow>
					</>
				)}
			</SettingCard>

			{/* Ignore Patterns */}
			<SectionLabel label="Ignore Patterns" />
			<SettingCard>
				<SettingRow title=".voidignore" description="Exclude files and folders from indexing" noBorder>
					<OpenButton text="Open" onClick={openOrCreatevoidignore} />
				</SettingRow>
			</SettingCard>
		</div>
	)
}

// ─── Account Tab ─────────────────────────────
const AccountTab = () => {
	const accessor = useAccessor()
	const authService = accessor.get('IvoidAuthService')
	const voidSettingsService = accessor.get('IvoidSettingsService')
	const authState = useAuthState()
	const settingsState = useSettingsState()
	const backendUrl = settingsState.globalSettings.backendUrl || 'http://localhost:3456'

	const [usage, setUsage] = useState<{ messagesUsedToday: number; messagesLimit: number; tokensUsedToday: number; plan: string } | null>(null)

	useEffect(() => {
		if (authState.isAuthenticated) {
			authService.getUsage().then(u => setUsage(u as any))
		}
	}, [authState.isAuthenticated, authService])

	const planLabels: Record<string, string> = { free: 'Free', pro: 'Pro', team: 'Team', enterprise: 'Enterprise' }

	if (!authState.isAuthenticated) {
		return (
			<div>
				<h1 className='text-xl font-semibold mb-6'>Account</h1>
				<SettingCard>
					<div className="p-4 text-center">
						<p className="text-void-fg-3 mb-4">You are not logged in.</p>
						<p className="text-void-fg-3 text-sm">Close this settings panel and the login screen will appear.</p>
					</div>
				</SettingCard>

				<SectionLabel label="Backend" />
				<SettingCard>
					<SettingRow title="Backend URL" description="URL for the void backend server" noBorder>
						<voidSimpleInputBox
							value={backendUrl}
							onChangeValue={(val: string) => voidSettingsService.setGlobalSetting('backendUrl', val)}
							placeholder="http://localhost:3456"
						/>
					</SettingRow>
				</SettingCard>
			</div>
		)
	}

	const user = authState.session!.user
	const plan = user.plan || 'free'
	const planLabel = planLabels[plan] || 'Free'

	// Usage bar
	const messagesUsed = usage?.messagesUsedToday ?? 0
	const messagesLimit = usage?.messagesLimit ?? 50
	const isUnlimited = messagesLimit === -1
	const usagePercent = isUnlimited ? 0 : Math.min(Math.round((messagesUsed / messagesLimit) * 100), 100)

	return (
		<div>
			<h1 className='text-xl font-semibold mb-6'>Account</h1>

			{/* Profile */}
			<SectionLabel label="Profile" />
			<SettingCard>
				<SettingRow title="Name" description={user.name}>
					{user.avatarUrl && (
						<img src={user.avatarUrl} alt="" className="w-8 h-8 rounded-full" />
					)}
				</SettingRow>
				<SettingRow title="Email" description={user.email}>
					<span />
				</SettingRow>
				<SettingRow title="Plan" description={`Current plan: ${planLabel}`}>
					{plan === 'free' && (
						<button className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors">
							Upgrade
						</button>
					)}
				</SettingRow>
				<SettingRow title="Logout" description="Sign out of your account" noBorder>
					<button
						onClick={() => authService.logout()}
						className="px-3 py-1 text-xs border border-void-border-1 rounded-md hover:bg-void-bg-2 text-void-fg-1 cursor-pointer transition-colors"
					>
						Logout
					</button>
				</SettingRow>
			</SettingCard>

			{/* Daily Usage */}
			<SectionLabel label="Daily Usage" />
			<SettingCard>
				<div className="p-3">
					<div className="flex justify-between text-sm mb-2">
						<span className="text-void-fg-3">Messages Today</span>
						<span className="text-void-fg-1">
							{messagesUsed}{isUnlimited ? '' : ` / ${messagesLimit}`}
						</span>
					</div>
					{!isUnlimited && (
						<div className="w-full bg-void-bg-1 rounded-full h-2">
							<div
								className={`h-2 rounded-full transition-all duration-300 ${usagePercent > 90 ? 'bg-red-500' : usagePercent > 70 ? 'bg-amber-500' : 'bg-blue-500'}`}
								style={{ width: `${usagePercent}%` }}
							/>
						</div>
					)}
					{usage && (
						<div className="flex justify-between text-xs text-void-fg-3 mt-2">
							<span>Tokens used today</span>
							<span>{usage.tokensUsedToday.toLocaleString()}</span>
						</div>
					)}
				</div>
			</SettingCard>

			{/* Backend Configuration */}
			<SectionLabel label="Backend" />
			<SettingCard>
				<SettingRow title="Backend URL" description="URL for the void backend server" noBorder>
					<voidSimpleInputBox
						value={backendUrl}
						onChangeValue={(val: string) => voidSettingsService.setGlobalSetting('backendUrl', val)}
						placeholder="http://localhost:3456"
					/>
				</SettingRow>
			</SettingCard>
		</div>
	)
}

// ─── Main Settings component ─────────────────────────────

export const Settings = () => {
	const isDark = useIsDark()
	const [selectedSection, setSelectedSection] = useState<Tab>('general');

	const navItems: { tab: Tab; label: string; icon: string }[] = [
		{ tab: 'account', label: 'Account', icon: '◉' },
		{ tab: 'general', label: 'General', icon: '⚙' },
		{ tab: 'featureOptions', label: 'Feature Options', icon: '∞' },
		{ tab: 'models', label: 'Models', icon: '◎' },
		{ tab: 'mcp', label: 'Tools & MCP', icon: '⚡' },
		{ tab: 'agentsAndRules', label: 'Agents & Rules', icon: '⊕' },
		{ tab: 'indexing', label: 'Indexing', icon: '◈' },
	];

	const accessor = useAccessor()
	const commandService = accessor.get('ICommandService')
	const environmentService = accessor.get('IEnvironmentService')
	const nativeHostService = accessor.get('INativeHostService')
	const settingsState = useSettingsState()
	const voidSettingsService = accessor.get('IvoidSettingsService')
	const chatThreadsService = accessor.get('IChatThreadService')
	const notificationService = accessor.get('INotificationService')
	const mcpService = accessor.get('IMCPService')
	const storageService = accessor.get('IStorageService')
	const metricsService = accessor.get('IMetricsService')
	const isOptedOut = useIsOptedOut()

	const onDownload = (t: 'Chats' | 'Settings') => {
		let dataStr: string
		let downloadName: string
		if (t === 'Chats') {
			dataStr = JSON.stringify(chatThreadsService.state, null, 2)
			downloadName = 'void-chats.json'
		} else if (t === 'Settings') {
			dataStr = JSON.stringify(voidSettingsService.state, null, 2)
			downloadName = 'void-settings.json'
		} else {
			dataStr = ''
			downloadName = ''
		}
		const blob = new Blob([dataStr], { type: 'application/json' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = downloadName
		a.click()
		URL.revokeObjectURL(url)
	}

	const fileInputSettingsRef = useRef<HTMLInputElement>(null)
	const fileInputChatsRef = useRef<HTMLInputElement>(null)
	const [s, ss] = useState(0)

	const handleUpload = (t: 'Chats' | 'Settings') => (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = e.target.files
		if (!files) return;
		const file = files[0]
		if (!file) return
		const reader = new FileReader();
		reader.onload = () => {
			try {
				const json = JSON.parse(reader.result as string);
				if (t === 'Chats') {
					chatThreadsService.dangerousSetState(json as any)
				} else if (t === 'Settings') {
					voidSettingsService.dangerousSetState(json as any)
				}
				notificationService.info(`${t} imported successfully!`)
			} catch (err) {
				notificationService.notify({ message: `Failed to import ${t}`, source: err + '', severity: Severity.Error })
			}
		};
		reader.readAsText(file);
		e.target.value = '';
		ss(s => s + 1)
	}

	// ─── Render ──────────────────────────────────────

	return (
		<div className={`@@void-scope ${isDark ? 'dark' : ''}`} style={{ height: '100%', width: '100%', overflow: 'auto' }}>
			<div className="flex flex-col md:flex-row w-full max-w-[900px] mx-auto mb-32" style={{ minHeight: '80vh' }}>

				{/* ──────── SIDEBAR ──────── */}
				<aside className="md:w-[200px] w-full p-4 pt-8 shrink-0 border-r border-void-border-1/30">
					<div className="flex flex-col gap-0.5 mt-4">
						{navItems.map(({ tab, label, icon }) => (
							<button
								key={tab}
								onClick={() => setSelectedSection(tab)}
								className={`
									py-1.5 px-3 rounded-md text-left text-[13px] transition-all duration-150 flex items-center gap-2
									${selectedSection === tab
										? 'bg-void-bg-2 text-void-fg-1 font-medium'
										: 'text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-2/50'}
								`}
							>
								<span className="text-[11px] w-4 text-center opacity-60">{icon}</span>
								{label}
							</button>
						))}
					</div>
				</aside>

				{/* ──────── MAIN CONTENT ──────── */}
				<main className="flex-1 p-6 pt-8 select-none">
					<div className='max-w-2xl'>

						{/* ═══════════ ACCOUNT ═══════════ */}
						{selectedSection === 'account' && <AccountTab />}

						{/* ═══════════ GENERAL ═══════════ */}
						{selectedSection === 'general' && (
							<div>
								<h1 className='text-xl font-semibold mb-6'>General</h1>

								{/* Preferences */}
								<SectionLabel label="Preferences" />
								<SettingCard>
									<SettingRow title="Editor Settings" description="Configure font, formatting, minimap and more">
										<OpenButton onClick={() => commandService.executeCommand('workbench.action.openSettings')} />
									</SettingRow>
									<SettingRow title="Keyboard Shortcuts" description="Configure keyboard shortcuts">
										<OpenButton onClick={() => commandService.executeCommand('workbench.action.openGlobalKeybindings')} />
									</SettingRow>
									<SettingRow title="Theme Settings" description="Change the color theme">
										<OpenButton onClick={() => commandService.executeCommand('workbench.action.selectTheme')} />
									</SettingRow>
									<SettingRow title="Open Logs" description="View application log files">
										<OpenButton onClick={() => nativeHostService.showItemInFolder(environmentService.logsHome.fsPath)} />
									</SettingRow>
									<SettingRow title="See Onboarding" description="Show the onboarding screen again" noBorder>
										<OpenButton text="Show" onClick={() => voidSettingsService.setGlobalSetting('isOnboardingComplete', false)} />
									</SettingRow>
								</SettingCard>

								{/* Import */}
								<SectionLabel label="Import & Transfer" />
								<SettingCard>
									<SettingRow title="Import from VS Code" description="Transfer settings, extensions, and keybindings">
										<OneClickSwitchButton className='text-xs' fromEditor="VS Code" />
									</SettingRow>
									<SettingRow title="Import from Cursor" description="Transfer settings, extensions, and keybindings">
										<OneClickSwitchButton className='text-xs' fromEditor="Cursor" />
									</SettingRow>
									<SettingRow title="Import from Windsurf" description="Transfer settings, extensions, and keybindings">
										<OneClickSwitchButton className='text-xs' fromEditor="Windsurf" />
									</SettingRow>
									<SettingRow title="Import void Settings" description="Import settings from a JSON file">
										<>
											<input key={2 * s} ref={fileInputSettingsRef} type='file' accept='.json' className='hidden' onChange={handleUpload('Settings')} />
											<OpenButton text="Import" onClick={() => fileInputSettingsRef.current?.click()} />
										</>
									</SettingRow>
									<SettingRow title="Export void Settings" description="Download settings as a JSON file">
										<OpenButton text="Export" onClick={() => onDownload('Settings')} />
									</SettingRow>
									<SettingRow title="Import Chats" description="Import chat threads from a JSON file">
										<>
											<input key={2 * s + 1} ref={fileInputChatsRef} type='file' accept='.json' className='hidden' onChange={handleUpload('Chats')} />
											<OpenButton text="Import" onClick={() => fileInputChatsRef.current?.click()} />
										</>
									</SettingRow>
									<SettingRow title="Export Chats" description="Download chat threads as a JSON file">
										<OpenButton text="Export" onClick={() => onDownload('Chats')} />
									</SettingRow>
									<SettingRow title="Reset Settings" description="Reset all void settings to defaults" noBorder>
										<ConfirmButton className='px-3.5 py-1 text-xs border border-void-border-1 rounded-md hover:bg-void-bg-2 text-void-fg-1 cursor-pointer transition-colors' onConfirm={() => voidSettingsService.resetState()}>
											Reset
										</ConfirmButton>
									</SettingRow>
								</SettingCard>

								{/* Privacy */}
								<SectionLabel label="Privacy" />
								<SettingCard>
									<SettingRow
										title="Metrics Opt-out"
										description="Disable anonymous usage tracking (requires restart)"
									>
										<voidSwitch size='sm' value={isOptedOut} onChange={(newVal) => {
											storageService.store(OPT_OUT_KEY, newVal, StorageScope.APPLICATION, StorageTarget.MACHINE)
											metricsService.capture(`Set metrics opt-out to ${newVal}`, {})
										}} />
									</SettingRow>
									<SettingRow
										title="Disable System Message"
										description="Only include your custom AI instructions, no built-in system message"
										noBorder
									>
										<voidSwitch size='sm' value={!!settingsState.globalSettings.disableSystemMessage} onChange={(newVal) => voidSettingsService.setGlobalSetting('disableSystemMessage', newVal)} />
									</SettingRow>
								</SettingCard>

								{/* AI Instructions */}
								<SectionLabel label="AI Instructions" />
								<div className='px-4 mb-2'>
									<div className='text-xs text-void-fg-3 mb-2'>
										<ChatMarkdownRender inPTag={true} string={`System instructions included with all AI requests. Alternatively, use a \`.voidrules\` file.`} chatMessageLocation={undefined} />
									</div>
									<ErrorBoundary>
										<AIInstructionsBox />
									</ErrorBoundary>
								</div>

								{/* Web Search */}
								<SectionLabel label="Web Search" />
								<SettingCard>
									<SettingRow
										title="Tavily API Key"
										description="Enable web search across all modes. Get your API key at app.tavily.com"
										noBorder
									>
										<voidSimpleInputBox
											className='w-48 text-xs'
											placeholder='tvly-...'
											passwordBlur
											value={settingsState.globalSettings.tavilyApiKey ?? ''}
											onChangeValue={(newVal) => voidSettingsService.setGlobalSetting('tavilyApiKey', newVal)}
										/>
									</SettingRow>
								</SettingCard>

								{/* Subagents */}
								<SectionLabel label="Subagents" />
								<SettingCard>
									<SettingRow
										title="Enable Subagents"
										description="Allow the AI to spawn specialized sub-agents for parallel tasks"
									>
										<voidSwitch size='sm' value={settingsState.globalSettings.subagentConfig?.enabled ?? true} onChange={(newVal) => {
											voidSettingsService.setGlobalSetting('subagentConfig', {
												...settingsState.globalSettings.subagentConfig,
												enabled: newVal,
											})
										}} />
									</SettingRow>
									<SettingRow
										title="Max Concurrent Subagents"
										description="Maximum number of subagents that can run simultaneously (1-8)"
										noBorder
									>
										<voidSimpleInputBox
											className='w-16 text-xs text-center'
											placeholder='3'
											value={String(settingsState.globalSettings.subagentConfig?.maxConcurrent ?? 3)}
											onChangeValue={(newVal) => {
												const num = Math.max(1, Math.min(8, parseInt(newVal) || 3))
												voidSettingsService.setGlobalSetting('subagentConfig', {
													...settingsState.globalSettings.subagentConfig,
													maxConcurrent: num,
												})
											}}
										/>
									</SettingRow>
								</SettingCard>

								{/* Agent Loop */}
								<SectionLabel label="Agent Loop" />
								<SettingCard>
									<SettingRow title="Max Agent Iterations" description="Maximum iterations before the agent loop stops (1-200)">
										<voidSimpleInputBox
											className='w-16 text-xs text-center'
											placeholder='50'
											value={String(settingsState.globalSettings.maxAgentIterations ?? 50)}
											onChangeValue={(newVal) => {
												const num = Math.max(1, Math.min(200, parseInt(newVal) || 50))
												voidSettingsService.setGlobalSetting('maxAgentIterations', num)
											}}
										/>
									</SettingRow>
									<SettingRow title="Lint Retry Limit" description="Number of times to retry fixing lint errors (0-10)" noBorder>
										<voidSimpleInputBox
											className='w-16 text-xs text-center'
											placeholder='3'
											value={String(settingsState.globalSettings.lintRetryLimit ?? 3)}
											onChangeValue={(newVal) => {
												const num = Math.max(0, Math.min(10, parseInt(newVal) || 3))
												voidSettingsService.setGlobalSetting('lintRetryLimit', num)
											}}
										/>
									</SettingRow>
								</SettingCard>

								{/* Sandbox */}
								<SectionLabel label="Sandbox" />
								<SettingCard>
									<SettingRow title="Sandbox Mode" description="Control command execution sandboxing">
										<voidCustomDropdownBox
											options={['off', 'auto_run', 'strict'] as SandboxMode[]}
											selectedOption={settingsState.globalSettings.sandboxMode}
											onChangeOption={(newVal) => voidSettingsService.setGlobalSetting('sandboxMode', newVal as SandboxMode)}
											getOptionDisplayName={(opt: string) => {
												const names: Record<string, string> = { off: 'Off', auto_run: 'Auto Run', strict: 'Strict' }
												return names[opt] ?? opt
											}}
											getOptionDropdownName={(opt: string) => {
												const names: Record<string, string> = { off: 'Off', auto_run: 'Auto Run', strict: 'Strict' }
												return names[opt] ?? opt
											}}
											getOptionsEqual={(a, b) => a === b}
											className='text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-1 rounded p-0.5 px-1'
										/>
									</SettingRow>
									<SettingRow title="Secret Detection" description="Scan for accidentally exposed secrets in tool output" noBorder>
										<voidSwitch size='sm' value={settingsState.globalSettings.secretDetectionEnabled ?? true} onChange={(newVal) => voidSettingsService.setGlobalSetting('secretDetectionEnabled', newVal)} />
									</SettingRow>
								</SettingCard>
							</div>
						)}

						{/* ═══════════ FEATURE OPTIONS ═══════════ */}
						{selectedSection === 'featureOptions' && (
							<div>
								<h1 className='text-xl font-semibold mb-6'>Feature Options</h1>

								{/* Autocomplete */}
								<SectionLabel label="Autocomplete" />
								<SettingCard>
									<SettingRow
										title="Enable Autocomplete"
										description="Works with all providers. Uses native FIM when available, falls back to chat-based completion."
									>
										<voidSwitch size='sm' value={settingsState.globalSettings.enableAutocomplete} onChange={(newVal) => voidSettingsService.setGlobalSetting('enableAutocomplete', newVal)} />
									</SettingRow>
									{settingsState.globalSettings.enableAutocomplete && (<>
										<SettingRow title="Autocomplete Model" description="Select the model used for autocomplete">
											<ModelDropdown featureName={'Autocomplete'} className='text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-1 rounded p-0.5 px-1' />
										</SettingRow>
										<SettingRow title="Debounce (ms)" description="Delay before triggering autocomplete after typing (50-500)">
											<voidSimpleInputBox
												className='w-16 text-xs text-center'
												placeholder='150'
												value={String(settingsState.globalSettings.autocompleteConfig?.debounceMs ?? 150)}
												onChangeValue={(newVal) => {
													const num = Math.min(500, Math.max(50, parseInt(newVal) || 150))
													voidSettingsService.setGlobalSetting('autocompleteConfig', { ...settingsState.globalSettings.autocompleteConfig, debounceMs: num })
												}}
											/>
										</SettingRow>
										<SettingRow title="Max Suggestion Lines" description="Maximum number of lines in a suggestion (1-50)">
											<voidSimpleInputBox
												className='w-16 text-xs text-center'
												placeholder='10'
												value={String(settingsState.globalSettings.autocompleteConfig?.maxSuggestionLines ?? 10)}
												onChangeValue={(newVal) => {
													const num = Math.min(50, Math.max(1, parseInt(newVal) || 10))
													voidSettingsService.setGlobalSetting('autocompleteConfig', { ...settingsState.globalSettings.autocompleteConfig, maxSuggestionLines: num })
												}}
											/>
										</SettingRow>
										<SettingRow title="Post-Accept Prediction" description="Immediately predict next completion after accepting (Tab-Tab flow)" noBorder>
											<voidSwitch size='sm' value={settingsState.globalSettings.autocompleteConfig?.enablePostAcceptPredict ?? true} onChange={(newVal) => {
												voidSettingsService.setGlobalSetting('autocompleteConfig', { ...settingsState.globalSettings.autocompleteConfig, enablePostAcceptPredict: newVal })
											}} />
										</SettingRow>
									</>)}
								</SettingCard>

								{/* Apply */}
								<SectionLabel label="Apply" />
								<SettingCard>
									<SettingRow
										title="Sync Apply to Chat"
										description="Use the same model for Apply as for Chat"
									>
										<voidSwitch size='sm' value={settingsState.globalSettings.syncApplyToChat} onChange={(newVal) => voidSettingsService.setGlobalSetting('syncApplyToChat', newVal)} />
									</SettingRow>
									{!settingsState.globalSettings.syncApplyToChat && (
										<SettingRow title="Apply Model" description="Select a separate model for Apply">
											<ModelDropdown featureName={'Apply'} className='text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-1 rounded p-0.5 px-1' />
										</SettingRow>
									)}
									<SettingRow title="Apply Method" description="Choose between fast (search/replace) or slow (full rewrite)">
										<FastApplyMethodDropdown />
									</SettingRow>
									<SettingRow title="Apply Retries" description="Number of retries when apply fails (0-5)">
										<voidSimpleInputBox
											className='w-16 text-xs text-center'
											placeholder='2'
											value={String(settingsState.globalSettings.applyModelRetries ?? 2)}
											onChangeValue={(newVal) => {
												const num = Math.max(0, Math.min(5, parseInt(newVal) || 2))
												voidSettingsService.setGlobalSetting('applyModelRetries', num)
											}}
										/>
									</SettingRow>
									<SettingRow title="Fallback to Direct Apply" description="Fall back to full-file rewrite if fast apply fails" noBorder>
										<voidSwitch size='sm' value={settingsState.globalSettings.applyFallbackToDirect ?? true} onChange={(newVal) => voidSettingsService.setGlobalSetting('applyFallbackToDirect', newVal)} />
									</SettingRow>
								</SettingCard>

								{/* Tools */}
								<SectionLabel label="Tools" />
								<SettingCard>
									<ErrorBoundary>
										{[...toolApprovalTypes].map((approvalType, i) => (
											<SettingRow
												key={approvalType}
												title={`Auto-approve ${approvalType}`}
												description={`Skip approval dialog for ${approvalType} actions`}
												noBorder={i === toolApprovalTypes.size - 1 && !settingsState.globalSettings.includeToolLintErrors}
											>
												<ToolApprovalTypeSwitch size='sm' approvalType={approvalType} desc="" />
											</SettingRow>
										))}
									</ErrorBoundary>
									<SettingRow title="Fix Lint Errors" description="Automatically include lint errors in tool context">
										<voidSwitch size='sm' value={settingsState.globalSettings.includeToolLintErrors} onChange={(newVal) => voidSettingsService.setGlobalSetting('includeToolLintErrors', newVal)} />
									</SettingRow>
									<SettingRow title="Auto-Accept LLM Changes" description="Automatically accept all changes made by the LLM" noBorder>
										<voidSwitch size='sm' value={settingsState.globalSettings.autoAcceptLLMChanges} onChange={(newVal) => voidSettingsService.setGlobalSetting('autoAcceptLLMChanges', newVal)} />
									</SettingRow>
								</SettingCard>

								{/* Editor */}
								<SectionLabel label="Editor" />
								<SettingCard>
									<SettingRow title="Show Inline Suggestions" description="Show void suggestions in the code editor on select" noBorder>
										<voidSwitch size='sm' value={settingsState.globalSettings.showInlineSuggestions} onChange={(newVal) => voidSettingsService.setGlobalSetting('showInlineSuggestions', newVal)} />
									</SettingRow>
								</SettingCard>

								{/* SCM */}
								<SectionLabel label="Source Control" />
								<SettingCard>
									<SettingRow title="Sync SCM to Chat" description="Use the same model for commit messages as for Chat">
										<voidSwitch size='sm' value={settingsState.globalSettings.syncSCMToChat} onChange={(newVal) => voidSettingsService.setGlobalSetting('syncSCMToChat', newVal)} />
									</SettingRow>
									{!settingsState.globalSettings.syncSCMToChat && (
										<SettingRow title="SCM Model" description="Select a separate model for commit messages" noBorder>
											<ModelDropdown featureName={'SCM'} className='text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-1 rounded p-0.5 px-1' />
										</SettingRow>
									)}
								</SettingCard>

								{/* Chat Mode */}
								<SectionLabel label="Chat Mode" />
								<SettingCard>
									<SettingRow title="Default Chat Mode" description="The mode selected when opening a new chat" noBorder>
										<voidCustomDropdownBox
											options={['agent', 'ask', 'plan', 'debug']}
											selectedOption={settingsState.globalSettings.chatMode}
											onChangeOption={(newVal) => voidSettingsService.setGlobalSetting('chatMode', newVal as any)}
											getOptionDisplayName={(opt: string) => {
												const names: Record<string, string> = { agent: 'Agent', ask: 'Ask', plan: 'Plan', debug: 'Debug' }
												return names[opt] ?? opt
											}}
											getOptionDropdownName={(opt: string) => {
												const names: Record<string, string> = { agent: 'Agent', ask: 'Ask', plan: 'Plan', debug: 'Debug' }
												return names[opt] ?? opt
											}}
											getOptionsEqual={(a, b) => a === b}
											className='text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-1 rounded p-0.5 px-1'
										/>
									</SettingRow>
								</SettingCard>

								{/* Model Router */}
								<SectionLabel label="Model Router" />
								<SettingCard>
									<SettingRow title="Router Mode" description="Manual: you pick the model. Auto: routes by task complexity" noBorder>
										<voidCustomDropdownBox
											options={['manual', 'auto']}
											selectedOption={settingsState.globalSettings.routerConfig?.mode ?? 'manual'}
											onChangeOption={(newVal) => voidSettingsService.setGlobalSetting('routerConfig', {
												...settingsState.globalSettings.routerConfig,
												mode: newVal as 'manual' | 'auto',
											})}
											getOptionDisplayName={(opt: string) => opt === 'manual' ? 'Manual' : 'Auto'}
											getOptionDropdownName={(opt: string) => opt === 'manual' ? 'Manual' : 'Auto'}
											getOptionsEqual={(a, b) => a === b}
											className='text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-1 rounded p-0.5 px-1'
										/>
									</SettingRow>
								</SettingCard>
							</div>
						)}

						{/* ═══════════ MODELS ═══════════ */}
						{selectedSection === 'models' && (
							<div>
								<h1 className='text-xl font-semibold mb-6'>Models</h1>

								<ErrorBoundary>
									<ModelDump />
								</ErrorBoundary>

								<div className='mt-8'>
									<SectionLabel label="Providers" />
									<div className='text-xs text-void-fg-3 px-4 mb-3'>void can access models from Anthropic, OpenAI, OpenRouter, and more.</div>
									<ErrorBoundary>
										<voidProviderSettings providerNames={providerNames} />
									</ErrorBoundary>
								</div>
							</div>
						)}

						{/* ═══════════ MCP ═══════════ */}
						{selectedSection === 'mcp' && (
							<div>
								<h1 className='text-xl font-semibold mb-2'>Tools & MCP</h1>
								<div className='text-xs text-void-fg-3 mb-6'>
									<ChatMarkdownRender inPTag={true} string={'Use Model Context Protocol to provide Agent mode with more tools.'} chatMessageLocation={undefined} />
								</div>

								<SettingCard>
									<SettingRow title="Add MCP Server" description="Open the MCP configuration file to add servers" noBorder>
										<OpenButton text="Add" onClick={async () => { await mcpService.revealMCPConfigFile() }} />
									</SettingRow>
								</SettingCard>

								<div className='mt-4'>
									<ErrorBoundary>
										<MCPServersList />
									</ErrorBoundary>
								</div>
							</div>
						)}

						{/* ═══════════ AGENTS & RULES ═══════════ */}
						{selectedSection === 'agentsAndRules' && (
							<AgentsAndRulesTab />
						)}

						{/* ═══════════ INDEXING ═══════════ */}
						{selectedSection === 'indexing' && (
							<IndexingTab />
						)}

					</div>
				</main>
			</div>
		</div>
	);
}
