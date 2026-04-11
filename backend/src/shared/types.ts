// Shared types between desktop client and backend server

// ============================================================
// User & Auth
// ============================================================

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  plan: PlanType;
  createdAt: string;
  updatedAt: string;
}

export type PlanType = "free" | "pro" | "team" | "enterprise";

export interface AuthTokenPayload {
  userId: string;
  email: string;
  plan: PlanType;
  iat: number;
  exp: number;
}

export interface AuthResponse {
  token: string;
  refreshToken: string;
  user: User;
}

// ============================================================
// Plans & Usage
// ============================================================

export interface PlanLimits {
  messagesPerDay: number;
  maxTokensPerRequest: number;
  allowedModels: string[];
  agenticEnabled: boolean;
  maxProjects: number;
  maxFileUploads: number;
}

export const PLAN_LIMITS: Record<PlanType, PlanLimits> = {
  free: {
    messagesPerDay: 50,
    maxTokensPerRequest: 4096,
    allowedModels: ["*"],
    agenticEnabled: true,
    maxProjects: 3,
    maxFileUploads: 10,
  },
  pro: {
    messagesPerDay: 500,
    maxTokensPerRequest: 16384,
    allowedModels: [
      "claude-sonnet-4-5",
      "claude-haiku-4-5",
      "gpt-4o",
      "gpt-4o-mini",
      "o4-mini",
      "gemini-pro",
      "gemini-flash",
    ],
    agenticEnabled: true,
    maxProjects: 50,
    maxFileUploads: 100,
  },
  team: {
    messagesPerDay: 1000,
    maxTokensPerRequest: 32768,
    allowedModels: [
      "claude-opus-4-5",
      "claude-sonnet-4-5",
      "claude-haiku-4-5",
      "gpt-4o",
      "gpt-4o-mini",
      "o3",
      "o4-mini",
      "gemini-pro",
      "gemini-flash",
    ],
    agenticEnabled: true,
    maxProjects: -1,
    maxFileUploads: -1,
  },
  enterprise: {
    messagesPerDay: -1,
    maxTokensPerRequest: 65536,
    allowedModels: ["*"],
    agenticEnabled: true,
    maxProjects: -1,
    maxFileUploads: -1,
  },
};

// ============================================================
// AI Chat / Completion
// ============================================================

// Content block types (matching Anthropic API format)
export type TextBlock = { type: "text"; text: string };
export type ThinkingBlock = { type: "thinking"; thinking: string };
export type RedactedThinkingBlock = { type: "redacted_thinking" };
export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};
export type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};
export type ImageBlock = {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
};
export type ContentBlock =
  | TextBlock
  | ThinkingBlock
  | RedactedThinkingBlock
  | ToolUseBlock
  | ToolResultBlock
  | ImageBlock;

// Tool definition (matches Anthropic's Tool schema)
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<
      string,
      { type: string; description?: string; enum?: string[] }
    >;
    required?: string[];
  };
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string | ContentBlock[];
}

// Reasoning/thinking configuration per provider
export interface ReasoningConfig {
  // Anthropic extended thinking: budget in tokens (1024-8192)
  budgetTokens?: number;
  // OpenAI reasoning: effort level
  reasoningEffort?: "low" | "medium" | "high";
  // Gemini thinking: budget in tokens
  thinkingBudget?: number;
}

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  activeFile?: string;
  selectedCode?: string;
  projectContext?: string;
  // Tool calling support
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "any" | "none" | { type: "tool"; name: string };
  // Reasoning/thinking support
  reasoning?: ReasoningConfig;
}

export interface CompletionResponse {
  id: string;
  content: string;
  reasoning: string;
  contentBlocks: ContentBlock[];
  model: string;
  tokensUsed: {
    input: number;
    output: number;
  };
  finishReason: string;
}

export interface UsageStats {
  messagesUsedToday: number;
  messagesLimit: number;
  tokensUsedToday: number;
  plan: PlanType;
}

// ============================================================
// API Error
// ============================================================

export interface ApiError {
  error: string;
  code: string;
  details?: Record<string, unknown>;
}

export const ERROR_CODES = {
  UNAUTHORIZED: "UNAUTHORIZED",
  PLAN_LIMIT_EXCEEDED: "PLAN_LIMIT_EXCEEDED",
  MODEL_NOT_ALLOWED: "MODEL_NOT_ALLOWED",
  RATE_LIMITED: "RATE_LIMITED",
  INVALID_REQUEST: "INVALID_REQUEST",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;
