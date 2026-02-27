/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export type PlanType = 'free' | 'pro' | 'team' | 'enterprise'

export type AuthUser = {
	id: string
	email: string
	name: string
	avatarUrl: string | null
	plan: PlanType
	createdAt: string
}

export type AuthSession = {
	accessToken: string
	refreshToken: string
	expiresAt: number // unix timestamp in seconds
	user: AuthUser
}

export type AuthState = {
	isAuthenticated: boolean
	session: AuthSession | null
	isLoading: boolean
	error: string | null
}

export const defaultAuthState: AuthState = {
	isAuthenticated: false,
	session: null,
	isLoading: true,
	error: null,
}

export type AuthStateChangedEvent = {
	session: AuthSession | null
}

export type UsageStats = {
	messagesUsedToday: number
	messagesLimit: number
	tokensUsedToday: number
	plan: PlanType
}

export type PlanLimits = {
	messagesPerDay: number
	maxTokensPerRequest: number
	allowedModels: string[]
	features: string[]
}

export const PLAN_LIMITS: Record<PlanType, PlanLimits> = {
	free: {
		messagesPerDay: 50,
		maxTokensPerRequest: 4096,
		allowedModels: ['claude-haiku-4-5'],
		features: ['basic_chat'],
	},
	pro: {
		messagesPerDay: 500,
		maxTokensPerRequest: 8192,
		allowedModels: ['claude-sonnet-4-5', 'claude-haiku-4-5'],
		features: ['basic_chat', 'code_generation', 'agentic'],
	},
	team: {
		messagesPerDay: 1000,
		maxTokensPerRequest: 16384,
		allowedModels: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
		features: ['basic_chat', 'code_generation', 'agentic', 'team_sharing'],
	},
	enterprise: {
		messagesPerDay: -1,
		maxTokensPerRequest: 32768,
		allowedModels: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
		features: ['basic_chat', 'code_generation', 'agentic', 'team_sharing', 'custom_models', 'sso'],
	},
}
