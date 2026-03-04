import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq from "groq-sdk";
import { env } from "../config/env";
import type { CompletionRequest, CompletionResponse, ChatMessage } from "../shared/types";

// ============================================================
// Lazy-initialized Provider Clients
// ============================================================

let anthropicClient: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return anthropicClient;
}

let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openaiClient) {
    if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");
    openaiClient = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return openaiClient;
}

let geminiClient: GoogleGenerativeAI | null = null;
function getGemini(): GoogleGenerativeAI {
  if (!geminiClient) {
    if (!env.GOOGLE_AI_API_KEY) throw new Error("GOOGLE_AI_API_KEY not configured");
    geminiClient = new GoogleGenerativeAI(env.GOOGLE_AI_API_KEY);
  }
  return geminiClient;
}

let groqClient: Groq | null = null;
function getGroq(): Groq {
  if (!groqClient) {
    if (!env.GROQ_API_KEY) throw new Error("GROQ_API_KEY not configured");
    groqClient = new Groq({ apiKey: env.GROQ_API_KEY });
  }
  return groqClient;
}

// ============================================================
// Model Mappings
// ============================================================

const ANTHROPIC_MODELS: Record<string, string> = {
  "claude-opus-4-5": "claude-opus-4-5-20250514",
  "claude-sonnet-4-5": "claude-sonnet-4-5-20250514",
  "claude-haiku-4-5": "claude-haiku-4-5-20250514",
};

const OPENAI_MODELS: Record<string, string> = {
  "gpt-4.1": "gpt-4.1",
  "gpt-4.1-mini": "gpt-4.1-mini",
  "o3": "o3",
  "o4-mini": "o4-mini",
};

const GEMINI_MODELS: Record<string, string> = {
  "gemini-pro": "gemini-2.5-pro-preview-05-06",
  "gemini-flash": "gemini-2.0-flash",
};

const GROQ_MODELS: Record<string, string> = {
  "qwen-qwq-32b": "qwen-qwq-32b",
  "llama-3.3-70b-versatile": "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant": "llama-3.1-8b-instant",
  "mixtral-8x7b-32768": "mixtral-8x7b-32768",
};

// ============================================================
// Provider Detection
// ============================================================

type ProviderName = "anthropic" | "openai" | "gemini" | "groq";

function getProvider(model: string): ProviderName {
  if (model.startsWith("claude")) return "anthropic";
  if (model in OPENAI_MODELS || model.startsWith("gpt") || model.startsWith("o3") || model.startsWith("o4")) return "openai";
  if (model.startsWith("gemini")) return "gemini";
  if (model in GROQ_MODELS || model.startsWith("llama") || model.startsWith("qwen") || model.startsWith("mixtral")) return "groq";
  throw new Error(`Unsupported model: ${model}`);
}

const PROVIDER_KEY_MAP: Record<ProviderName, string | undefined> = {
  anthropic: env.ANTHROPIC_API_KEY,
  openai: env.OPENAI_API_KEY,
  gemini: env.GOOGLE_AI_API_KEY,
  groq: env.GROQ_API_KEY,
};

export function isProviderConfigured(model: string): { configured: boolean; provider: ProviderName } {
  const provider = getProvider(model);
  return { configured: !!PROVIDER_KEY_MAP[provider], provider };
}

// ============================================================
// Shared Helpers
// ============================================================

function buildSystemMessage(request: CompletionRequest): string {
  let msg = "You are an expert coding assistant inside the Void IDE.";
  if (request.activeFile) {
    msg += `\n\nThe user is currently editing: ${request.activeFile}`;
  }
  if (request.selectedCode) {
    msg += `\n\nCurrently selected code:\n\`\`\`\n${request.selectedCode}\n\`\`\``;
  }
  if (request.projectContext) {
    msg += `\n\nProject context:\n${request.projectContext}`;
  }
  return msg;
}

/**
 * Normalize messages from various formats into simple { role, content: string }.
 * Handles:
 * - Simple: { role, content: "text" }
 * - OpenAI-style: { role, content: [{ type: "text", text: "..." }] }
 * - Gemini-style: { role, parts: [{ text: "..." }] }
 */
export function normalizeMessages(messages: any[]): ChatMessage[] {
  return messages.map((m) => {
    let content: string;
    if (typeof m.content === "string") {
      content = m.content;
    } else if (Array.isArray(m.content)) {
      content = m.content
        .map((part: any) => part.text ?? part.content ?? "")
        .join("");
    } else if (Array.isArray(m.parts)) {
      content = m.parts.map((p: any) => p.text ?? "").join("");
    } else {
      content = String(m.content ?? "");
    }

    const role = m.role === "model" ? "assistant" : m.role;
    return { role, content };
  });
}

// ============================================================
// Router
// ============================================================

export async function createCompletion(request: CompletionRequest): Promise<CompletionResponse> {
  const provider = getProvider(request.model);
  request.messages = normalizeMessages(request.messages);

  switch (provider) {
    case "anthropic": return handleAnthropicCompletion(request);
    case "openai": return handleOpenAICompletion(request);
    case "gemini": return handleGeminiCompletion(request);
    case "groq": return handleGroqCompletion(request);
  }
}

export async function* streamCompletion(request: CompletionRequest): AsyncGenerator<string> {
  const provider = getProvider(request.model);
  request.messages = normalizeMessages(request.messages);

  switch (provider) {
    case "anthropic": yield* streamAnthropicCompletion(request); return;
    case "openai": yield* streamOpenAICompletion(request); return;
    case "gemini": yield* streamGeminiCompletion(request); return;
    case "groq": yield* streamGroqCompletion(request); return;
  }
}

// ============================================================
// Anthropic
// ============================================================

async function handleAnthropicCompletion(request: CompletionRequest): Promise<CompletionResponse> {
  const client = getAnthropic();
  const systemMessage = buildSystemMessage(request);
  const modelId = ANTHROPIC_MODELS[request.model] || request.model;

  const response = await client.messages.create({
    model: modelId,
    max_tokens: request.maxTokens || 4096,
    temperature: request.temperature ?? 0.7,
    system: systemMessage,
    messages: request.messages.map((m) => ({
      role: m.role === "system" ? "user" : m.role,
      content: m.content,
    })),
  });

  const content = response.content[0].type === "text" ? response.content[0].text : "";
  return {
    id: response.id,
    content,
    model: request.model,
    tokensUsed: { input: response.usage.input_tokens, output: response.usage.output_tokens },
    finishReason: response.stop_reason || "end_turn",
  };
}

async function* streamAnthropicCompletion(request: CompletionRequest): AsyncGenerator<string> {
  const client = getAnthropic();
  const systemMessage = buildSystemMessage(request);
  const modelId = ANTHROPIC_MODELS[request.model] || request.model;

  const stream = client.messages.stream({
    model: modelId,
    max_tokens: request.maxTokens || 4096,
    temperature: request.temperature ?? 0.7,
    system: systemMessage,
    messages: request.messages.map((m) => ({
      role: m.role === "system" ? "user" : m.role,
      content: m.content,
    })),
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield `data: ${JSON.stringify({ type: "text", text: event.delta.text })}\n\n`;
    }
  }

  const finalMessage = await stream.finalMessage();
  yield `data: ${JSON.stringify({
    type: "done",
    usage: { input: finalMessage.usage.input_tokens, output: finalMessage.usage.output_tokens },
  })}\n\n`;
}

// ============================================================
// OpenAI
// ============================================================

async function handleOpenAICompletion(request: CompletionRequest): Promise<CompletionResponse> {
  const client = getOpenAI();
  const systemMessage = buildSystemMessage(request);
  const modelId = OPENAI_MODELS[request.model] || request.model;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemMessage },
    ...request.messages.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    })),
  ];

  const response = await client.chat.completions.create({
    model: modelId,
    messages,
    max_tokens: request.maxTokens || 4096,
    temperature: request.temperature ?? 0.7,
  });

  const choice = response.choices[0];
  return {
    id: response.id,
    content: choice.message.content || "",
    model: request.model,
    tokensUsed: {
      input: response.usage?.prompt_tokens || 0,
      output: response.usage?.completion_tokens || 0,
    },
    finishReason: choice.finish_reason || "stop",
  };
}

async function* streamOpenAICompletion(request: CompletionRequest): AsyncGenerator<string> {
  const client = getOpenAI();
  const systemMessage = buildSystemMessage(request);
  const modelId = OPENAI_MODELS[request.model] || request.model;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemMessage },
    ...request.messages.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    })),
  ];

  const stream = await client.chat.completions.create({
    model: modelId,
    messages,
    max_tokens: request.maxTokens || 4096,
    temperature: request.temperature ?? 0.7,
    stream: true,
    stream_options: { include_usage: true },
  });

  let totalInput = 0;
  let totalOutput = 0;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (delta?.content) {
      yield `data: ${JSON.stringify({ type: "text", text: delta.content })}\n\n`;
    }
    if (chunk.usage) {
      totalInput = chunk.usage.prompt_tokens || 0;
      totalOutput = chunk.usage.completion_tokens || 0;
    }
  }

  yield `data: ${JSON.stringify({
    type: "done",
    usage: { input: totalInput, output: totalOutput },
  })}\n\n`;
}

// ============================================================
// Gemini
// ============================================================

async function handleGeminiCompletion(request: CompletionRequest): Promise<CompletionResponse> {
  const client = getGemini();
  const systemMessage = buildSystemMessage(request);
  const modelId = GEMINI_MODELS[request.model] || request.model;

  const model = client.getGenerativeModel({
    model: modelId,
    systemInstruction: systemMessage,
  });

  const history = request.messages.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const lastMessage = request.messages[request.messages.length - 1];
  const chat = model.startChat({
    history,
    generationConfig: {
      maxOutputTokens: request.maxTokens || 4096,
      temperature: request.temperature ?? 0.7,
    },
  });

  const result = await chat.sendMessage(lastMessage.content);
  const response = result.response;
  const text = response.text();
  const usage = response.usageMetadata;

  return {
    id: `gemini-${Date.now()}`,
    content: text,
    model: request.model,
    tokensUsed: {
      input: usage?.promptTokenCount || 0,
      output: usage?.candidatesTokenCount || 0,
    },
    finishReason: "stop",
  };
}

async function* streamGeminiCompletion(request: CompletionRequest): AsyncGenerator<string> {
  const client = getGemini();
  const systemMessage = buildSystemMessage(request);
  const modelId = GEMINI_MODELS[request.model] || request.model;

  const model = client.getGenerativeModel({
    model: modelId,
    systemInstruction: systemMessage,
  });

  const history = request.messages.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const lastMessage = request.messages[request.messages.length - 1];
  const chat = model.startChat({
    history,
    generationConfig: {
      maxOutputTokens: request.maxTokens || 4096,
      temperature: request.temperature ?? 0.7,
    },
  });

  const result = await chat.sendMessageStream(lastMessage.content);

  let totalInput = 0;
  let totalOutput = 0;

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) {
      yield `data: ${JSON.stringify({ type: "text", text })}\n\n`;
    }
    if (chunk.usageMetadata) {
      totalInput = chunk.usageMetadata.promptTokenCount || 0;
      totalOutput = chunk.usageMetadata.candidatesTokenCount || 0;
    }
  }

  yield `data: ${JSON.stringify({
    type: "done",
    usage: { input: totalInput, output: totalOutput },
  })}\n\n`;
}

// ============================================================
// Groq
// ============================================================

const GROQ_ALLOWLIST = new Set(Object.keys(GROQ_MODELS));

async function handleGroqCompletion(request: CompletionRequest): Promise<CompletionResponse> {
  if (!GROQ_ALLOWLIST.has(request.model)) {
    throw new Error(`Model "${request.model}" is not available via Groq. Allowed: ${[...GROQ_ALLOWLIST].join(", ")}`);
  }

  const client = getGroq();
  const systemMessage = buildSystemMessage(request);
  const modelId = GROQ_MODELS[request.model] || request.model;

  const response = await client.chat.completions.create({
    model: modelId,
    messages: [
      { role: "system", content: systemMessage },
      ...request.messages.map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })),
    ],
    max_tokens: request.maxTokens || 4096,
    temperature: request.temperature ?? 0.7,
  });

  const choice = response.choices[0];
  return {
    id: response.id,
    content: choice.message.content || "",
    model: request.model,
    tokensUsed: {
      input: response.usage?.prompt_tokens || 0,
      output: response.usage?.completion_tokens || 0,
    },
    finishReason: choice.finish_reason || "stop",
  };
}

async function* streamGroqCompletion(request: CompletionRequest): AsyncGenerator<string> {
  if (!GROQ_ALLOWLIST.has(request.model)) {
    throw new Error(`Model "${request.model}" is not available via Groq. Allowed: ${[...GROQ_ALLOWLIST].join(", ")}`);
  }

  const client = getGroq();
  const systemMessage = buildSystemMessage(request);
  const modelId = GROQ_MODELS[request.model] || request.model;

  const stream = await client.chat.completions.create({
    model: modelId,
    messages: [
      { role: "system", content: systemMessage },
      ...request.messages.map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })),
    ],
    max_tokens: request.maxTokens || 4096,
    temperature: request.temperature ?? 0.7,
    stream: true,
  });

  let totalInput = 0;
  let totalOutput = 0;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (delta?.content) {
      yield `data: ${JSON.stringify({ type: "text", text: delta.content })}\n\n`;
    }
    if ((chunk as any).x_groq?.usage) {
      const usage = (chunk as any).x_groq.usage;
      totalInput = usage.prompt_tokens || 0;
      totalOutput = usage.completion_tokens || 0;
    }
  }

  yield `data: ${JSON.stringify({
    type: "done",
    usage: { input: totalInput, output: totalOutput },
  })}\n\n`;
}
