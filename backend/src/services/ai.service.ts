import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env";
import type { CompletionRequest, CompletionResponse } from "../shared/types";

// ============================================================
// Anthropic Client
// ============================================================

const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});

// ============================================================
// Model Router
// ============================================================

/**
 * Route a completion request to the appropriate AI provider.
 * This acts as a proxy -- the desktop client never sees raw API keys.
 */
export async function createCompletion(
  request: CompletionRequest
): Promise<CompletionResponse> {
  if (request.model.startsWith("claude")) {
    return handleAnthropicCompletion(request);
  } else if (request.model.startsWith("gemini")) {
    return handleGeminiCompletion(request);
  }

  throw new Error(`Unsupported model: ${request.model}`);
}

/**
 * Handle Anthropic (Claude) completions.
 */
async function handleAnthropicCompletion(
  request: CompletionRequest
): Promise<CompletionResponse> {
  let systemMessage = "You are an expert coding assistant inside the Void IDE.";

  if (request.activeFile) {
    systemMessage += `\n\nThe user is currently editing: ${request.activeFile}`;
  }
  if (request.selectedCode) {
    systemMessage += `\n\nCurrently selected code:\n\`\`\`\n${request.selectedCode}\n\`\`\``;
  }
  if (request.projectContext) {
    systemMessage += `\n\nProject context:\n${request.projectContext}`;
  }

  const modelMap: Record<string, string> = {
    "claude-opus-4-5": "claude-opus-4-5-20250514",
    "claude-sonnet-4-5": "claude-sonnet-4-5-20250514",
    "claude-haiku-4-5": "claude-haiku-4-5-20250514",
  };

  const modelId = modelMap[request.model] || request.model;

  const response = await anthropic.messages.create({
    model: modelId,
    max_tokens: request.maxTokens || 4096,
    temperature: request.temperature ?? 0.7,
    system: systemMessage,
    messages: request.messages.map((m) => ({
      role: m.role === "system" ? "user" : m.role,
      content: m.content,
    })),
  });

  const content =
    response.content[0].type === "text" ? response.content[0].text : "";

  return {
    id: response.id,
    content,
    model: request.model,
    tokensUsed: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
    },
    finishReason: response.stop_reason || "end_turn",
  };
}

/**
 * Handle Google Gemini completions.
 * Placeholder -- implement with @google/generative-ai SDK.
 */
async function handleGeminiCompletion(
  request: CompletionRequest
): Promise<CompletionResponse> {
  throw new Error("Gemini integration not yet implemented. Coming soon!");
}

/**
 * Stream a completion (returns an async iterator for SSE).
 */
export async function* streamCompletion(
  request: CompletionRequest
): AsyncGenerator<string> {
  if (!request.model.startsWith("claude")) {
    throw new Error("Streaming only supported for Claude models currently");
  }

  let systemMessage = "You are an expert coding assistant inside the Void IDE.";
  if (request.activeFile) {
    systemMessage += `\n\nThe user is currently editing: ${request.activeFile}`;
  }
  if (request.selectedCode) {
    systemMessage += `\n\nCurrently selected code:\n\`\`\`\n${request.selectedCode}\n\`\`\``;
  }

  const modelMap: Record<string, string> = {
    "claude-opus-4-5": "claude-opus-4-5-20250514",
    "claude-sonnet-4-5": "claude-sonnet-4-5-20250514",
    "claude-haiku-4-5": "claude-haiku-4-5-20250514",
  };

  const stream = anthropic.messages.stream({
    model: modelMap[request.model] || request.model,
    max_tokens: request.maxTokens || 4096,
    temperature: request.temperature ?? 0.7,
    system: systemMessage,
    messages: request.messages.map((m) => ({
      role: m.role === "system" ? "user" : m.role,
      content: m.content,
    })),
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield `data: ${JSON.stringify({ type: "text", text: event.delta.text })}\n\n`;
    }
  }

  const finalMessage = await stream.finalMessage();
  yield `data: ${JSON.stringify({
    type: "done",
    usage: {
      input: finalMessage.usage.input_tokens,
      output: finalMessage.usage.output_tokens,
    },
  })}\n\n`;
}
