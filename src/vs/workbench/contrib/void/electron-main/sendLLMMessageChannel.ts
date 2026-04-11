/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// registered in app.ts
// code convention is to make a service responsible for this stuff, and not a channel, but having fewer files is simpler...

import { IServerChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { EventLLMMessageOnTextParams, EventLLMMessageOnErrorParams, EventLLMMessageOnFinalMessageParams, MainSendLLMMessageParams, AbortRef, SendLLMMessageParams, MainLLMMessageAbortParams, ModelListParams, EventModelListOnSuccessParams, EventModelListOnErrorParams, OllamaModelResponse, OpenaiCompatibleModelResponse, MainModelListParams, RawToolCallObj, AnthropicReasoning, } from '../common/sendLLMMessageTypes.js';
import { sendLLMMessage } from './llmMessage/sendLLMMessage.js'
import { IMetricsService } from '../common/metricsService.js';
import { sendLLMMessageToProviderImplementation } from './llmMessage/sendLLMMessage.impl.js';
import { availableTools, InternalToolInfo } from '../common/prompt/prompts.js';

// NODE IMPLEMENTATION - calls actual sendLLMMessage() and returns listeners to it

export class LLMMessageChannel implements IServerChannel {

	// sendLLMMessage
	private readonly llmMessageEmitters = {
		onText: new Emitter<EventLLMMessageOnTextParams>(),
		onFinalMessage: new Emitter<EventLLMMessageOnFinalMessageParams>(),
		onError: new Emitter<EventLLMMessageOnErrorParams>(),
	}

	// aborters for above
	private readonly _infoOfRunningRequest: Record<string, { waitForSend: Promise<void> | undefined, abortRef: AbortRef }> = {}


	// list
	private readonly listEmitters = {
		ollama: {
			success: new Emitter<EventModelListOnSuccessParams<OllamaModelResponse>>(),
			error: new Emitter<EventModelListOnErrorParams<OllamaModelResponse>>(),
		},
		openaiCompat: {
			success: new Emitter<EventModelListOnSuccessParams<OpenaiCompatibleModelResponse>>(),
			error: new Emitter<EventModelListOnErrorParams<OpenaiCompatibleModelResponse>>(),
		},
	} satisfies {
		[providerName in 'ollama' | 'openaiCompat']: {
			success: Emitter<EventModelListOnSuccessParams<any>>,
			error: Emitter<EventModelListOnErrorParams<any>>,
		}
	}

	// stupidly, channels can't take in @IService
	constructor(
		private readonly metricsService: IMetricsService,
	) { }

	// browser uses this to listen for changes
	listen(_: unknown, event: string): Event<any> {
		// text
		if (event === 'onText_sendLLMMessage') return this.llmMessageEmitters.onText.event;
		else if (event === 'onFinalMessage_sendLLMMessage') return this.llmMessageEmitters.onFinalMessage.event;
		else if (event === 'onError_sendLLMMessage') return this.llmMessageEmitters.onError.event;
		// list
		else if (event === 'onSuccess_list_ollama') return this.listEmitters.ollama.success.event;
		else if (event === 'onError_list_ollama') return this.listEmitters.ollama.error.event;
		else if (event === 'onSuccess_list_openAICompatible') return this.listEmitters.openaiCompat.success.event;
		else if (event === 'onError_list_openAICompatible') return this.listEmitters.openaiCompat.error.event;

		else throw new Error(`Event not found: ${event}`);
	}

	// browser uses this to call (see this.channel.call() in llmMessageService.ts for all usages)
	async call(_: unknown, command: string, params: any): Promise<any> {
		try {
			if (command === 'sendLLMMessage') {
				this._callSendLLMMessage(params)
			}
			else if (command === 'sendProxiedLLMMessage') {
				this._callSendProxiedLLMMessage(params)
			}
			else if (command === 'abort') {
				await this._callAbort(params)
			}
			else if (command === 'ollamaList') {
				this._callOllamaList(params)
			}
			else if (command === 'openAICompatibleList') {
				this._callOpenAICompatibleList(params)
			}
			else {
				throw new Error(`void sendLLM: command "${command}" not recognized.`)
			}
		}
		catch (e) {
			console.log('llmMessageChannel: Call Error:', e)
		}
	}

	// the only place sendLLMMessage is actually called
	private _callSendLLMMessage(params: MainSendLLMMessageParams) {
		const { requestId } = params;

		if (!(requestId in this._infoOfRunningRequest))
			this._infoOfRunningRequest[requestId] = { waitForSend: undefined, abortRef: { current: null } }

		const mainThreadParams: SendLLMMessageParams = {
			...params,
			onText: (p) => {
				this.llmMessageEmitters.onText.fire({ requestId, ...p });
			},
			onFinalMessage: (p) => {
				this.llmMessageEmitters.onFinalMessage.fire({ requestId, ...p });
			},
			onError: (p) => {
				console.log('sendLLM: firing err');
				this.llmMessageEmitters.onError.fire({ requestId, ...p });
			},
			abortRef: this._infoOfRunningRequest[requestId].abortRef,
		}
		const p = sendLLMMessage(mainThreadParams, this.metricsService);
		this._infoOfRunningRequest[requestId].waitForSend = p
	}

	// Convert InternalToolInfo[] to backend ToolDefinition format
	private _convertToolsForBackend(tools: InternalToolInfo[] | undefined): any[] {
		if (!tools || tools.length === 0) return []
		return tools.map(tool => ({
			name: tool.name,
			description: tool.description,
			input_schema: {
				type: 'object',
				properties: Object.fromEntries(
					Object.entries(tool.params).map(([paramName, paramInfo]) => [
						paramName,
						{ type: 'string', description: paramInfo.description }
					])
				),
			},
		}))
	}

	// Proxied LLM call — sends request to backend server instead of calling providers directly
	private async _callSendProxiedLLMMessage(params: MainSendLLMMessageParams) {
		const { requestId, proxyConfig, modelSelection, messagesType, messages, modelSelectionOptions } = params;

		if (!proxyConfig) {
			this.llmMessageEmitters.onError.fire({ requestId, message: 'No proxy config provided', fullError: null });
			return;
		}

		let chatMessages: import('../common/sendLLMMessageTypes.js').LLMChatMessage[];
		if (messagesType === 'chatMessages') {
			chatMessages = messages as import('../common/sendLLMMessageTypes.js').LLMChatMessage[];
		} else if (messagesType === 'FIMMessage') {
			const fimMessages = messages as import('../common/sendLLMMessageTypes.js').LLMFIMMessage;
			chatMessages = [
				{
					role: 'system',
					content: 'You are a code completion engine. Output ONLY the raw code that should replace <FILL_HERE>. Do not include the surrounding code. No explanations, no markdown, no comments about what you did. Just the code completion, nothing else.'
				},
				{
					role: 'user',
					content: `Continue the code at <FILL_HERE>. Output ONLY the completion code. No explanation, no markdown fences, no extra text.\n\n${fimMessages.prefix}<FILL_HERE>${fimMessages.suffix}`
				}
			];
		} else {
			this.llmMessageEmitters.onError.fire({ requestId, message: 'Message type not supported via proxy', fullError: null });
			return;
		}

		// Prepend system message if provided separately
		const separateSystemMessage = (params as any).separateSystemMessage as string | undefined;
		if (separateSystemMessage) {
			chatMessages = [{ role: 'system', content: separateSystemMessage } as any, ...chatMessages];
		}

		// Convert tools to backend format
		const chatMode = (params as any).chatMode ?? null;
		const mcpTools = (params as any).mcpTools as InternalToolInfo[] | undefined;
		const allTools = availableTools(chatMode, mcpTools);
		const toolDefs = this._convertToolsForBackend(allTools);

		// Build reasoning config from modelSelectionOptions
		let reasoning: any = undefined;
		if (modelSelectionOptions?.reasoningEnabled) {
			reasoning = {
				budgetTokens: modelSelectionOptions.reasoningBudget,
				reasoningEffort: modelSelectionOptions.reasoningEffort,
				thinkingBudget: modelSelectionOptions.reasoningBudget,
			}
		}

		if (!(requestId in this._infoOfRunningRequest))
			this._infoOfRunningRequest[requestId] = { waitForSend: undefined, abortRef: { current: null } }

		const abortController = new AbortController();
		this._infoOfRunningRequest[requestId].abortRef.current = () => abortController.abort();

		const p = (async () => {
			try {
				const response = await fetch(`${proxyConfig.backendUrl}/v1/completions/stream`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Authorization': `Bearer ${proxyConfig.authToken}`,
					},
					body: JSON.stringify({
						model: modelSelection.modelName,
						messages: chatMessages,
						maxTokens: 4096,
						stream: true,
						tools: toolDefs.length > 0 ? toolDefs : undefined,
						toolChoice: toolDefs.length > 0 ? 'auto' : undefined,
						reasoning,
					}),
					signal: abortController.signal,
				});

				if (!response.ok) {
					const errData = await response.json().catch(() => ({ error: 'Unknown error' }));
					this.llmMessageEmitters.onError.fire({
						requestId,
						message: errData.error || `Backend returned ${response.status}`,
						fullError: null,
					});
					return;
				}

				// Parse SSE stream with full reasoning + tool call support
				const reader = response.body?.getReader();
				if (!reader) {
					this.llmMessageEmitters.onError.fire({ requestId, message: 'No response body', fullError: null });
					return;
				}

				const decoder = new TextDecoder();
				let buffer = '';
				let fullText = '';
				let fullReasoning = '';
				let currentToolCall: RawToolCallObj | undefined = undefined;
				let toolParamsJson = '';
				let anthropicReasoning: AnthropicReasoning[] | null = null;

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split('\n');
					buffer = lines.pop() || '';

					for (const line of lines) {
						if (!line.startsWith('data: ')) continue;
						const jsonStr = line.slice(6).trim();
						if (!jsonStr) continue;

						try {
							const event = JSON.parse(jsonStr);

							if (event.type === 'text') {
								fullText += event.text;
								this.llmMessageEmitters.onText.fire({
									requestId, fullText, fullReasoning, toolCall: currentToolCall,
								});
							}
							else if (event.type === 'reasoning') {
								fullReasoning += event.text;
								// Build anthropicReasoning array for display
								if (!anthropicReasoning) anthropicReasoning = [];
								const last = anthropicReasoning[anthropicReasoning.length - 1];
								if (last && last.type === 'thinking') {
									(last as any).thinking += event.text;
								} else {
									anthropicReasoning.push({ type: 'thinking', thinking: event.text, signature: '' });
								}
								this.llmMessageEmitters.onText.fire({
									requestId, fullText, fullReasoning, toolCall: currentToolCall,
								});
							}
							else if (event.type === 'tool_use_start') {
								toolParamsJson = '';
								currentToolCall = {
									name: event.name,
									id: event.id,
									rawParams: {},
									doneParams: [],
									isDone: false,
								};
								this.llmMessageEmitters.onText.fire({
									requestId, fullText, fullReasoning, toolCall: currentToolCall,
								});
							}
							else if (event.type === 'tool_use_delta') {
								toolParamsJson += event.partial_json;
								// Try partial parse for progressive UI
								try {
									const partialParams = JSON.parse(toolParamsJson);
									if (currentToolCall && typeof partialParams === 'object') {
										currentToolCall.rawParams = partialParams;
										currentToolCall.doneParams = Object.keys(partialParams) as any;
									}
								} catch { /* partial JSON, can't parse yet */ }
								this.llmMessageEmitters.onText.fire({
									requestId, fullText, fullReasoning, toolCall: currentToolCall,
								});
							}
							else if (event.type === 'tool_use_end') {
								if (currentToolCall) {
									const input = event.input || {};
									currentToolCall.rawParams = input;
									currentToolCall.doneParams = Object.keys(input) as any;
									currentToolCall.isDone = true;
								}
								this.llmMessageEmitters.onText.fire({
									requestId, fullText, fullReasoning, toolCall: currentToolCall,
								});
							}
							else if (event.type === 'done') {
								this.llmMessageEmitters.onFinalMessage.fire({
									requestId,
									fullText,
									fullReasoning,
									toolCall: currentToolCall,
									anthropicReasoning,
								});
							}
							else if (event.type === 'error') {
								this.llmMessageEmitters.onError.fire({
									requestId,
									message: event.error || event.message,
									fullError: null,
								});
							}
						} catch {
							// skip malformed JSON lines
						}
					}
				}
			} catch (e: any) {
				if (e.name === 'AbortError') return;
				this.llmMessageEmitters.onError.fire({
					requestId,
					message: e.message || 'Proxy request failed',
					fullError: null,
				});
			}
		})();

		this._infoOfRunningRequest[requestId].waitForSend = p;
	}

	private async _callAbort(params: MainLLMMessageAbortParams) {
		const { requestId } = params;
		if (!(requestId in this._infoOfRunningRequest)) return
		const { waitForSend, abortRef } = this._infoOfRunningRequest[requestId]
		await waitForSend // wait for the send to finish so we know abortRef was set
		abortRef?.current?.()
		delete this._infoOfRunningRequest[requestId]
	}





	_callOllamaList = (params: MainModelListParams<OllamaModelResponse>) => {
		const { requestId } = params
		const emitters = this.listEmitters.ollama
		const mainThreadParams: ModelListParams<OllamaModelResponse> = {
			...params,
			onSuccess: (p) => { emitters.success.fire({ requestId, ...p }); },
			onError: (p) => { emitters.error.fire({ requestId, ...p }); },
		}
		sendLLMMessageToProviderImplementation.ollama.list(mainThreadParams)
	}

	_callOpenAICompatibleList = (params: MainModelListParams<OpenaiCompatibleModelResponse>) => {
		const { requestId, providerName } = params
		const emitters = this.listEmitters.openaiCompat
		const mainThreadParams: ModelListParams<OpenaiCompatibleModelResponse> = {
			...params,
			onSuccess: (p) => { emitters.success.fire({ requestId, ...p }); },
			onError: (p) => { emitters.error.fire({ requestId, ...p }); },
		};
		(sendLLMMessageToProviderImplementation[providerName] as any).list(mainThreadParams)
	}





}
