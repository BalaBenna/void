import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { env } from "../config/env";
import type {
  CompletionRequest,
  CompletionResponse,
  ContentBlock,
} from "../shared/types";

// ============================================================
// Provider Clients
// ============================================================

const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});

const openai = env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: env.OPENAI_API_KEY })
  : null;

const genai = env.GOOGLE_AI_API_KEY
  ? new GoogleGenAI({ apiKey: env.GOOGLE_AI_API_KEY })
  : null;

// ============================================================
// Model Maps
// ============================================================

const ANTHROPIC_MODEL_MAP: Record<string, string> = {
  // Claude 4 family
  "claude-opus-4-0": "claude-opus-4-20250514",
  "claude-sonnet-4-0": "claude-sonnet-4-20250514",
  // Claude 3.5/3.7 family
  "claude-3-7-sonnet-latest": "claude-3-7-sonnet-latest",
  "claude-3-5-sonnet-latest": "claude-3-5-sonnet-latest",
  "claude-3-5-haiku-latest": "claude-3-5-haiku-latest",
  "claude-3-opus-latest": "claude-3-opus-latest",
};

const GEMINI_MODEL_MAP: Record<string, string> = {
  "gemini-pro": "gemini-2.5-pro",
  "gemini-flash": "gemini-2.5-flash",
};

// ============================================================
// Helpers
// ============================================================

function buildSystemMessage(request: CompletionRequest): string {
  let systemMessage =
    "You are an expert coding assistant inside the Void IDE.";

  if (request.activeFile) {
    systemMessage += `\n\nThe user is currently editing: ${request.activeFile}`;
  }
  if (request.selectedCode) {
    systemMessage += `\n\nCurrently selected code:\n\`\`\`\n${request.selectedCode}\n\`\`\``;
  }
  if (request.projectContext) {
    systemMessage += `\n\nProject context:\n${request.projectContext}`;
  }

  return systemMessage;
}

function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

// ============================================================
// Model Router
// ============================================================

export async function createCompletion(
  request: CompletionRequest
): Promise<CompletionResponse> {
  if (request.model.startsWith("claude")) {
    return handleAnthropicCompletion(request);
  } else if (
    request.model.startsWith("gpt") ||
    request.model.startsWith("o1") ||
    request.model.startsWith("o3") ||
    request.model.startsWith("o4")
  ) {
    return handleOpenAICompletion(request);
  } else if (request.model.startsWith("gemini")) {
    return handleGeminiCompletion(request);
  }

  throw new Error(`Unsupported model: ${request.model}`);
}

// ============================================================
// Anthropic: Reasoning (Extended Thinking) + Tool Calling
// ============================================================

async function handleAnthropicCompletion(
  request: CompletionRequest
): Promise<CompletionResponse> {
  const systemMessage = buildSystemMessage(request);
  const modelId = ANTHROPIC_MODEL_MAP[request.model] || request.model;

  const messages = request.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content as any,
    }));

  const createParams: any = {
    model: modelId,
    max_tokens: request.maxTokens || 4096,
    system: systemMessage,
    messages,
  };

  // Extended thinking: when enabled, temperature must not be set (Anthropic requirement)
  if (request.reasoning?.budgetTokens) {
    createParams.thinking = {
      type: "enabled",
      budget_tokens: request.reasoning.budgetTokens,
    };
    // Anthropic requires no temperature when thinking is enabled
  } else {
    createParams.temperature = request.temperature ?? 0.7;
  }

  // Tools
  if (request.tools && request.tools.length > 0) {
    createParams.tools = request.tools;
    createParams.tool_choice = request.toolChoice
      ? typeof request.toolChoice === "string"
        ? { type: request.toolChoice }
        : request.toolChoice
      : { type: "auto" };
  }

  const response = await anthropic.messages.create(createParams);

  // Extract all content types
  let textContent = "";
  let reasoning = "";
  const contentBlocks: ContentBlock[] = [];

  for (const block of response.content) {
    const blockType = (block as any).type as string;
    if (blockType === "thinking") {
      const thinkingText = (block as any).thinking || "";
      reasoning += (reasoning ? "\n\n" : "") + thinkingText;
      contentBlocks.push({ type: "thinking", thinking: thinkingText });
    } else if (blockType === "redacted_thinking") {
      reasoning += (reasoning ? "\n\n" : "") + "[redacted_thinking]";
      contentBlocks.push({ type: "redacted_thinking" });
    } else if (blockType === "text") {
      textContent += (block as any).text;
      contentBlocks.push({ type: "text", text: (block as any).text });
    } else if (blockType === "tool_use") {
      contentBlocks.push({
        type: "tool_use",
        id: (block as any).id,
        name: (block as any).name,
        input: (block as any).input as Record<string, unknown>,
      });
    }
  }

  return {
    id: response.id,
    content: textContent,
    reasoning,
    contentBlocks,
    model: request.model,
    tokensUsed: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
    },
    finishReason: response.stop_reason || "end_turn",
  };
}

// ============================================================
// OpenAI: Reasoning (reasoning_effort) + Tool Calling
// ============================================================

async function handleOpenAICompletion(
  request: CompletionRequest
): Promise<CompletionResponse> {
  if (!openai) {
    throw new Error("OpenAI API key not configured");
  }

  const systemMessage = buildSystemMessage(request);

  // Build messages - OpenAI format
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemMessage },
    ...request.messages.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content as any,
    })),
  ];

  // Build tools in OpenAI format
  const tools: OpenAI.ChatCompletionTool[] | undefined = request.tools?.length
    ? request.tools.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema as any,
        },
      }))
    : undefined;

  const createParams: any = {
    model: request.model,
    messages,
    max_tokens: request.maxTokens || 4096,
  };

  // Reasoning effort for o-series models
  if (request.reasoning?.reasoningEffort) {
    createParams.reasoning_effort = request.reasoning.reasoningEffort;
  } else {
    createParams.temperature = request.temperature ?? 0.7;
  }

  if (tools) {
    createParams.tools = tools;
    createParams.tool_choice = request.toolChoice
      ? request.toolChoice === "any"
        ? "required"
        : request.toolChoice
      : "auto";
  }

  const response = await openai.chat.completions.create(createParams);

  const choice = response.choices[0];
  const textContent = choice.message.content || "";

  // Build content blocks
  const contentBlocks: ContentBlock[] = [];
  if (textContent) {
    contentBlocks.push({ type: "text", text: textContent });
  }

  // Handle tool calls
  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls as any[]) {
      let input = {};
      try {
        input = JSON.parse(tc.function?.arguments || "{}");
      } catch {}
      contentBlocks.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function?.name || "",
        input,
      });
    }
  }

  // Map finish reason
  let finishReason = "end_turn";
  if (choice.finish_reason === "tool_calls") finishReason = "tool_use";
  else if (choice.finish_reason === "length") finishReason = "max_tokens";
  else if (choice.finish_reason === "stop") finishReason = "end_turn";

  return {
    id: response.id,
    content: textContent,
    reasoning: "", // OpenAI o-series reasoning is internal, not exposed
    contentBlocks,
    model: request.model,
    tokensUsed: {
      input: response.usage?.prompt_tokens || 0,
      output: response.usage?.completion_tokens || 0,
    },
    finishReason,
  };
}

// ============================================================
// Gemini: Thinking (thinkingBudget) + Tool Calling
// ============================================================

async function handleGeminiCompletion(
  request: CompletionRequest
): Promise<CompletionResponse> {
  if (!genai) {
    throw new Error("Gemini API key not configured");
  }

  const modelId = GEMINI_MODEL_MAP[request.model] || request.model;
  const systemMessage = buildSystemMessage(request);

  const contents = request.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [
        {
          text:
            typeof m.content === "string"
              ? m.content
              : m.content
                  .filter(
                    (b): b is { type: "text"; text: string } =>
                      b.type === "text"
                  )
                  .map((b) => b.text)
                  .join("") || JSON.stringify(m.content),
        },
      ],
    }));

  const tools = request.tools?.length
    ? [
        {
          functionDeclarations: request.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.input_schema,
          })),
        },
      ]
    : undefined;

  // Gemini thinking config
  const thinkingConfig = request.reasoning?.thinkingBudget
    ? { thinkingBudget: request.reasoning.thinkingBudget }
    : undefined;

  const response = await genai.models.generateContent({
    model: modelId,
    contents,
    config: {
      systemInstruction: systemMessage,
      maxOutputTokens: request.maxTokens || 4096,
      temperature: request.temperature ?? 0.7,
      tools: tools as any,
      thinkingConfig: thinkingConfig as any,
    },
  });

  const textContent =
    response.candidates?.[0]?.content?.parts
      ?.filter((p: any) => p.text && !p.thought)
      .map((p: any) => p.text)
      .join("") || "";

  // Extract thinking text (Gemini marks thinking parts with thought=true)
  const thinkingText =
    response.candidates?.[0]?.content?.parts
      ?.filter((p: any) => p.thought && p.text)
      .map((p: any) => p.text)
      .join("\n\n") || "";

  const contentBlocks: ContentBlock[] = [];
  const parts = response.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if ((part as any).thought && (part as any).text) {
      contentBlocks.push({
        type: "thinking",
        thinking: (part as any).text,
      });
    } else if ((part as any).text) {
      contentBlocks.push({ type: "text", text: (part as any).text });
    } else if ((part as any).functionCall) {
      const fc = (part as any).functionCall;
      contentBlocks.push({
        type: "tool_use",
        id: `gemini-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: fc.name,
        input: fc.args || {},
      });
    }
  }

  const finishReason = contentBlocks.some((b) => b.type === "tool_use")
    ? "tool_use"
    : "end_turn";

  const usage = response.usageMetadata;

  return {
    id: `gemini-${Date.now()}`,
    content: textContent,
    reasoning: thinkingText,
    contentBlocks,
    model: request.model,
    tokensUsed: {
      input: usage?.promptTokenCount || 0,
      output: usage?.candidatesTokenCount || 0,
    },
    finishReason,
  };
}

// ============================================================
// Streaming Router
// ============================================================

export async function* streamCompletion(
  request: CompletionRequest
): AsyncGenerator<string> {
  if (request.model.startsWith("gemini")) {
    yield* streamGeminiCompletion(request);
    return;
  }

  if (
    request.model.startsWith("gpt") ||
    request.model.startsWith("o1") ||
    request.model.startsWith("o3") ||
    request.model.startsWith("o4")
  ) {
    yield* streamOpenAICompletion(request);
    return;
  }

  if (request.model.startsWith("claude")) {
    yield* streamAnthropicCompletion(request);
    return;
  }

  throw new Error(`Streaming not supported for model: ${request.model}`);
}

// ============================================================
// Anthropic Streaming: Reasoning + Text + Tool Calls in parallel
// ============================================================

async function* streamAnthropicCompletion(
  request: CompletionRequest
): AsyncGenerator<string> {
  const systemMessage = buildSystemMessage(request);
  const modelId = ANTHROPIC_MODEL_MAP[request.model] || request.model;

  const messages = request.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content as any,
    }));

  const streamParams: any = {
    model: modelId,
    max_tokens: request.maxTokens || 4096,
    system: systemMessage,
    messages,
  };

  // Extended thinking
  if (request.reasoning?.budgetTokens) {
    streamParams.thinking = {
      type: "enabled",
      budget_tokens: request.reasoning.budgetTokens,
    };
  } else {
    streamParams.temperature = request.temperature ?? 0.7;
  }

  // Tools
  if (request.tools && request.tools.length > 0) {
    streamParams.tools = request.tools;
    streamParams.tool_choice = request.toolChoice
      ? typeof request.toolChoice === "string"
        ? { type: request.toolChoice }
        : request.toolChoice
      : { type: "auto" };
  }

  const stream = anthropic.messages.stream(streamParams);

  // Track streaming state
  let currentToolId = "";
  let currentToolName = "";
  let currentToolJson = "";
  let inThinkingBlock = false;

  for await (const event of stream) {
    if (event.type === "content_block_start") {
      const block = (event as any).content_block;

      if (block?.type === "thinking") {
        inThinkingBlock = true;
        // Emit initial thinking text if present
        if (block.thinking) {
          yield sseEvent({ type: "reasoning", text: block.thinking });
        }
      } else if (block?.type === "redacted_thinking") {
        yield sseEvent({
          type: "reasoning",
          text: "[redacted_thinking]",
        });
      } else if (block?.type === "tool_use") {
        currentToolId = block.id;
        currentToolName = block.name;
        currentToolJson = "";
        yield sseEvent({
          type: "tool_use_start",
          id: currentToolId,
          name: currentToolName,
        });
      }
    } else if (event.type === "content_block_delta") {
      if (event.delta.type === "text_delta") {
        yield sseEvent({ type: "text", text: event.delta.text });
      } else if ((event.delta as any).type === "thinking_delta") {
        // Stream thinking tokens as they arrive
        yield sseEvent({
          type: "reasoning",
          text: (event.delta as any).thinking,
        });
      } else if ((event.delta as any).type === "input_json_delta") {
        const partialJson = (event.delta as any).partial_json;
        currentToolJson += partialJson;
        yield sseEvent({
          type: "tool_use_delta",
          partial_json: partialJson,
        });
      }
    } else if (event.type === "content_block_stop") {
      if (inThinkingBlock) {
        inThinkingBlock = false;
      }
      if (currentToolName) {
        let input = {};
        try {
          input = JSON.parse(currentToolJson || "{}");
        } catch {}
        yield sseEvent({
          type: "tool_use_end",
          id: currentToolId,
          name: currentToolName,
          input,
        });
        currentToolId = "";
        currentToolName = "";
        currentToolJson = "";
      }
    }
  }

  const finalMessage = await stream.finalMessage();
  yield sseEvent({
    type: "done",
    finishReason: finalMessage.stop_reason || "end_turn",
    usage: {
      input: finalMessage.usage.input_tokens,
      output: finalMessage.usage.output_tokens,
    },
  });
}

// ============================================================
// OpenAI Streaming: Reasoning (internal) + Text + Tool Calls
// ============================================================

async function* streamOpenAICompletion(
  request: CompletionRequest
): AsyncGenerator<string> {
  if (!openai) {
    throw new Error("OpenAI API key not configured");
  }

  const systemMessage = buildSystemMessage(request);

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemMessage },
    ...request.messages.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content as any,
    })),
  ];

  const tools: OpenAI.ChatCompletionTool[] | undefined = request.tools?.length
    ? request.tools.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema as any,
        },
      }))
    : undefined;

  const createParams: any = {
    model: request.model,
    messages,
    max_tokens: request.maxTokens || 4096,
    stream: true,
  };

  if (request.reasoning?.reasoningEffort) {
    createParams.reasoning_effort = request.reasoning.reasoningEffort;
  } else {
    createParams.temperature = request.temperature ?? 0.7;
  }

  if (tools) {
    createParams.tools = tools;
    createParams.tool_choice = request.toolChoice
      ? request.toolChoice === "any"
        ? "required"
        : request.toolChoice
      : "auto";
  }

  const stream = await openai.chat.completions.create(createParams);

  let toolName = "";
  let toolParamsStr = "";
  let toolId = "";
  let toolStarted = false;
  let totalInput = 0;
  let totalOutput = 0;
  let finishReason = "end_turn";

  for await (const chunk of stream as any) {
    const choice = chunk.choices?.[0];
    if (!choice) continue;

    // Text content
    const newText = choice.delta?.content;
    if (newText) {
      yield sseEvent({ type: "text", text: newText });
    }

    // Tool calls
    if (choice.delta?.tool_calls) {
      for (const tc of choice.delta.tool_calls) {
        if (tc.function?.name) {
          toolName += tc.function.name;
          toolId += tc.id || "";
          if (!toolStarted) {
            toolStarted = true;
            yield sseEvent({
              type: "tool_use_start",
              id: toolId,
              name: toolName,
            });
          }
        }
        if (tc.function?.arguments) {
          toolParamsStr += tc.function.arguments;
          yield sseEvent({
            type: "tool_use_delta",
            partial_json: tc.function.arguments,
          });
        }
      }
    }

    // Reasoning content (for models like deepseek-reasoner via OpenAI-compat)
    const reasoningContent =
      (choice.delta as any)?.reasoning_content ||
      (choice.delta as any)?.reasoning;
    if (reasoningContent) {
      yield sseEvent({ type: "reasoning", text: reasoningContent });
    }

    // Finish reason
    if (choice.finish_reason) {
      if (choice.finish_reason === "tool_calls") finishReason = "tool_use";
      else if (choice.finish_reason === "length") finishReason = "max_tokens";
      else finishReason = "end_turn";
    }

    // Usage (may come in final chunk)
    if (chunk.usage) {
      totalInput = chunk.usage.prompt_tokens || 0;
      totalOutput = chunk.usage.completion_tokens || 0;
    }
  }

  // Finalize tool call
  if (toolStarted && toolName) {
    let input = {};
    try {
      input = JSON.parse(toolParamsStr || "{}");
    } catch {}
    yield sseEvent({
      type: "tool_use_end",
      id: toolId,
      name: toolName,
      input,
    });
  }

  yield sseEvent({
    type: "done",
    finishReason,
    usage: { input: totalInput, output: totalOutput },
  });
}

// ============================================================
// Gemini Streaming: Thinking + Text + Tool Calls
// ============================================================

async function* streamGeminiCompletion(
  request: CompletionRequest
): AsyncGenerator<string> {
  if (!genai) {
    throw new Error("Gemini API key not configured");
  }

  const modelId = GEMINI_MODEL_MAP[request.model] || request.model;
  const systemMessage = buildSystemMessage(request);

  const contents = request.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [
        {
          text:
            typeof m.content === "string"
              ? m.content
              : m.content
                  .filter(
                    (b): b is { type: "text"; text: string } =>
                      b.type === "text"
                  )
                  .map((b) => b.text)
                  .join("") || JSON.stringify(m.content),
        },
      ],
    }));

  const tools = request.tools?.length
    ? [
        {
          functionDeclarations: request.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.input_schema,
          })),
        },
      ]
    : undefined;

  const thinkingConfig = request.reasoning?.thinkingBudget
    ? { thinkingBudget: request.reasoning.thinkingBudget }
    : undefined;

  const stream = await genai.models.generateContentStream({
    model: modelId,
    contents,
    config: {
      systemInstruction: systemMessage,
      maxOutputTokens: request.maxTokens || 4096,
      temperature: request.temperature ?? 0.7,
      tools: tools as any,
      thinkingConfig: thinkingConfig as any,
    },
  });

  let totalInput = 0;
  let totalOutput = 0;
  let hasToolUse = false;

  for await (const chunk of stream) {
    const parts = chunk.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if ((part as any).thought && (part as any).text) {
        // Gemini thinking part
        yield sseEvent({ type: "reasoning", text: (part as any).text });
      } else if ((part as any).text) {
        yield sseEvent({ type: "text", text: (part as any).text });
      } else if ((part as any).functionCall) {
        hasToolUse = true;
        const fc = (part as any).functionCall;
        const id = `gemini-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        yield sseEvent({ type: "tool_use_start", id, name: fc.name });
        yield sseEvent({
          type: "tool_use_end",
          id,
          name: fc.name,
          input: fc.args || {},
        });
      }
    }

    if (chunk.usageMetadata) {
      totalInput = chunk.usageMetadata.promptTokenCount || 0;
      totalOutput = chunk.usageMetadata.candidatesTokenCount || 0;
    }
  }

  yield sseEvent({
    type: "done",
    finishReason: hasToolUse ? "tool_use" : "end_turn",
    usage: { input: totalInput, output: totalOutput },
  });
}
