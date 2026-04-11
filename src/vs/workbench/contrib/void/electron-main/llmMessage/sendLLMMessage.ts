/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { SendLLMMessageParams, OnText, OnFinalMessage, OnError, LLMFIMMessage, LLMChatMessage } from '../../common/sendLLMMessageTypes.js';
import { IMetricsService } from '../../common/metricsService.js';
import { displayInfoOfProviderName } from '../../common/voidSettingsTypes.js';
import { sendLLMMessageToProviderImplementation } from './sendLLMMessage.impl.js';


export const sendLLMMessage = async ({
	messagesType,
	messages: messages_,
	onText: onText_,
	onFinalMessage: onFinalMessage_,
	onError: onError_,
	abortRef: abortRef_,
	logging: { loggingName, loggingExtras },
	settingsOfProvider,
	modelSelection,
	modelSelectionOptions,
	overridesOfModel,
	chatMode,
	separateSystemMessage,
	mcpTools,
}: SendLLMMessageParams,

	metricsService: IMetricsService
) => {


	const { providerName, modelName } = modelSelection

	// only captures number of messages and message "shape", no actual code, instructions, prompts, etc
	const captureLLMEvent = (eventId: string, extras?: object) => {


		metricsService.capture(eventId, {
			providerName,
			modelName,
			customEndpointURL: settingsOfProvider[providerName]?.endpoint,
			numModelsAtEndpoint: settingsOfProvider[providerName]?.models?.length,
			...messagesType === 'chatMessages' ? {
				numMessages: messages_?.length,
			} : messagesType === 'FIMMessage' ? {
				prefixLength: messages_.prefix.length,
				suffixLength: messages_.suffix.length,
			} : {},
			...loggingExtras,
			...extras,
		})
	}
	const submit_time = new Date()

	let _fullTextSoFar = ''
	let _aborter: (() => void) | null = null
	let _setAborter = (fn: () => void) => { _aborter = fn }
	let _didAbort = false

	const onText: OnText = (params) => {
		const { fullText } = params
		if (_didAbort) return
		onText_(params)
		_fullTextSoFar = fullText
	}

	const onFinalMessage: OnFinalMessage = (params) => {
		const { fullText, fullReasoning, toolCall } = params
		if (_didAbort) return
		captureLLMEvent(`${loggingName} - Received Full Message`, { messageLength: fullText.length, reasoningLength: fullReasoning?.length, duration: new Date().getMilliseconds() - submit_time.getMilliseconds(), toolCallName: toolCall?.name })
		onFinalMessage_(params)
	}

	const onError: OnError = ({ message: errorMessage, fullError }) => {
		if (_didAbort) return
		console.error('sendLLMMessage onError:', errorMessage)

		// handle failed to fetch errors, which give 0 information by design
		if (errorMessage === 'TypeError: fetch failed')
			errorMessage = `Failed to fetch from ${displayInfoOfProviderName(providerName).title}. This likely means you specified the wrong endpoint in void's Settings, or your local model provider like Ollama is powered off.`

		captureLLMEvent(`${loggingName} - Error`, { error: errorMessage })
		onError_({ message: errorMessage, fullError })
	}

	// we should NEVER call onAbort internally, only from the outside
	const onAbort = () => {
		captureLLMEvent(`${loggingName} - Abort`, { messageLengthSoFar: _fullTextSoFar.length })
		try { _aborter?.() } // aborter sometimes automatically throws an error
		catch (e) { }
		_didAbort = true
	}
	abortRef_.current = onAbort


	if (messagesType === 'chatMessages')
		captureLLMEvent(`${loggingName} - Sending Message`, {})
	else if (messagesType === 'FIMMessage')
		captureLLMEvent(`${loggingName} - Sending FIM`, { prefixLen: messages_?.prefix?.length, suffixLen: messages_?.suffix?.length })


	try {
		const implementation = sendLLMMessageToProviderImplementation[providerName]
		if (!implementation) {
			onError({ message: `Error: Provider "${providerName}" not recognized.`, fullError: null })
			return
		}
		const { sendFIM, sendChat } = implementation
		if (messagesType === 'chatMessages') {
			await sendChat({ messages: messages_, onText, onFinalMessage, onError, settingsOfProvider, modelSelectionOptions, overridesOfModel, modelName, _setAborter, providerName, separateSystemMessage, chatMode, mcpTools })
			return
		}
		if (messagesType === 'FIMMessage') {
			if (sendFIM) {
				await sendFIM({ messages: messages_, onText, onFinalMessage, onError, settingsOfProvider, modelSelectionOptions, overridesOfModel, modelName, _setAborter, providerName, separateSystemMessage })
				return
			}
			// Fallback: simulate FIM using chat API for providers without native FIM
			const fimMessages = messages_ as LLMFIMMessage

			// Extract language hint from prefix (look for common file extension patterns or shebang)
			const langHint = (() => {
				const lines = fimMessages.prefix.split('\n')
				const firstLine = lines[0] ?? ''
				if (firstLine.startsWith('#!')) {
					if (firstLine.includes('python')) return 'Python'
					if (firstLine.includes('node') || firstLine.includes('deno') || firstLine.includes('bun')) return 'JavaScript'
					if (firstLine.includes('bash') || firstLine.includes('sh')) return 'Shell'
					if (firstLine.includes('ruby')) return 'Ruby'
				}
				// Try to detect from common syntax patterns
				if (fimMessages.prefix.includes('import React') || fimMessages.prefix.includes('from "react"')) return 'TypeScript/React'
				if (fimMessages.prefix.includes('package main') || fimMessages.prefix.includes('func ')) return 'Go'
				if (fimMessages.prefix.includes('def ') || fimMessages.prefix.includes('import ') && fimMessages.prefix.includes(':')) return 'Python'
				if (fimMessages.prefix.includes('fn ') || fimMessages.prefix.includes('let mut ')) return 'Rust'
				return ''
			})()

			const langContext = langHint ? ` The code is written in ${langHint}.` : ''

			// Use a more constrained prompt that reduces hallucination
			const prefixLines = fimMessages.prefix.split('\n')
			const lastPrefixLines = prefixLines.slice(-20).join('\n')
			const suffixLines = fimMessages.suffix.split('\n')
			const firstSuffixLines = suffixLines.slice(0, 10).join('\n')

			const chatMessages: LLMChatMessage[] = [{
				role: 'user',
				content: `Complete the code between <PREFIX> and <SUFFIX>. Output ONLY the missing code. No explanations, no markdown, no surrounding context.${langContext}

<PREFIX>
${lastPrefixLines}
</PREFIX>
<SUFFIX>
${firstSuffixLines}
</SUFFIX>

Output ONLY the code that goes between PREFIX and SUFFIX:`
			}]
			const fimSystemMessage = 'You are an inline code completion engine. Your task is to fill in the missing code between the given prefix and suffix. Rules:\n1. Output ONLY the raw completion code — no markdown fences, no explanations, no comments.\n2. Do NOT repeat any code from the prefix or suffix.\n3. Keep completions short and focused (1-5 lines typical).\n4. Match the indentation and style of the surrounding code.\n5. If you cannot determine what to complete, output nothing.'
			await sendChat({
				messages: chatMessages,
				onText,
				onFinalMessage,
				onError,
				settingsOfProvider,
				modelSelectionOptions,
				overridesOfModel,
				modelName,
				_setAborter,
				providerName,
				separateSystemMessage: fimSystemMessage,
				chatMode: null,
				mcpTools: undefined,
			})
			return
		}
		onError({ message: `Error: Message type "${messagesType}" not recognized.`, fullError: null })
		return
	}

	catch (error) {
		if (error instanceof Error) { onError({ message: error + '', fullError: error }) }
		else { onError({ message: `Unexpected Error in sendLLMMessage: ${error}`, fullError: error }); }
		// ; (_aborter as any)?.()
		// _didAbort = true
	}



}

