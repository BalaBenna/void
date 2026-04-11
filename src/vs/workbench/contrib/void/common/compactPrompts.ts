/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// System prompt for the compaction summarization LLM call
export const COMPACT_SYSTEM_PROMPT = `You are a conversation summarizer. Your job is to create a concise summary of a conversation between a user and an AI coding assistant.

The summary should:
1. Preserve all important context: what files were discussed, what changes were made, what decisions were taken
2. Preserve any file paths, function names, variable names, and code snippets that were important
3. Preserve the user's intent and any pending tasks
4. Be structured clearly with sections if needed
5. Omit verbose tool outputs, repetitive explanations, and small talk
6. Keep the summary under 2000 tokens

Format the summary as:
## Conversation Summary
### Context
[What the user is working on and their goals]

### Changes Made
[List of files modified/created and what was done]

### Key Decisions
[Important decisions or findings]

### Current State
[Where things stand, any pending work]`

// User prompt template for compact
export function getCompactUserPrompt(messageCount: number): string {
	return `Summarize the following conversation (${messageCount} messages). Preserve all important context for continuing the work.`
}
