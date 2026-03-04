// Shared types between desktop client and backend server

// ============================================================
// User & Auth
// ============================================================

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  plan: PlanType;
  createdAt: string;
  updatedAt: string;
}

export type PlanType = "free" | "pro" | "team" | "enterprise";

export interface AuthResponse {
  token: string;
  refreshToken: string;
  expiresAt: number;
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
    allowedModels: ["claude-haiku-4-5", "gemini-flash", "llama-3.1-8b-instant"],
    agenticEnabled: false,
    maxProjects: 3,
    maxFileUploads: 10,
  },
  pro: {
    messagesPerDay: 500,
    maxTokensPerRequest: 16384,
    allowedModels: [
      "claude-sonnet-4-5",
      "claude-haiku-4-5",
      "gemini-pro",
      "gemini-flash",
      "gpt-4.1-mini",
      "o4-mini",
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "qwen-qwq-32b",
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
      "gemini-pro",
      "gemini-flash",
      "gpt-4.1",
      "gpt-4.1-mini",
      "o3",
      "o4-mini",
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "qwen-qwq-32b",
      "mixtral-8x7b-32768",
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

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
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
}

export interface CompletionResponse {
  id: string;
  content: string;
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
  PROVIDER_NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;
