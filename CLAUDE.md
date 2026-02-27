# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Void?

Void is an open-source AI code editor, forked from VS Code. Most Void-specific code lives in `src/vs/workbench/contrib/void/`.

## Build & Development Commands

**Prerequisites:** Node v20.18.2 (see `.nvmrc`). On Mac, need Python and XCode. On Linux, need `build-essential`, `g++`, `libx11-dev`, `libxkbfile-dev`, `libsecret-1-dev`, `libkrb5-dev`, `python-is-python3`. On Windows, need Visual Studio 2022 with C++ tools. See `HOW_TO_CONTRIBUTE.md` for full details.

```bash
npm install                    # Install all dependencies
npm run watch                  # Watch-build client + extensions (done when 2/3 spinners turn to checkmarks)
npm run watchreact             # Watch-build React UI layer only
npm run buildreact             # One-shot build React UI layer
./scripts/code.sh              # Launch dev Void window (Mac/Linux)
./scripts/code.bat             # Launch dev Void window (Windows)
```

Reload the dev window with Cmd+R (Mac) or Ctrl+R after code changes.

**Testing:**
```bash
npm run test-node              # Mocha unit tests (Node)
npm run test-browser           # Playwright browser unit tests
npm run eslint                 # ESLint
npm run stylelint              # Stylelint
```

**Local executable build (slow, ~25 min):**
```bash
npm run gulp vscode-darwin-arm64   # Mac Apple Silicon
npm run gulp vscode-darwin-x64     # Mac Intel
npm run gulp vscode-linux-x64      # Linux
npm run gulp vscode-win32-x64      # Windows
```

**Temporary dev data** (allows easy reset):
```bash
./scripts/code.sh --user-data-dir ./.tmp/user-data --extensions-dir ./.tmp/extensions
```

## Architecture

### Process Model (Electron)

VS Code/Void runs two Electron processes:

- **Browser process** (`browser/` folders) — UI, React components. Has `window` access but CANNOT import `node_modules`.
- **Main process** (`electron-main/` folders) — Node.js backend. CAN import `node_modules`.
- **Common** (`common/` folders) — Shared between both processes, no special imports.

Workarounds for browser's no-node-modules constraint:
1. Bundle node_module code to browser (used for React)
2. IPC channel between main/browser (used for LLM calls, MCP)

### Void Service Architecture

All services are VS Code singletons registered via `registerSingleton()`. Entry point: `src/vs/workbench/contrib/void/browser/void.contribution.ts`.

**Browser services** (`src/vs/workbench/contrib/void/browser/`):

Core:
- `chatThreadService` — Chat conversation threads, message history, checkpoint snapshots
- `editCodeService` — Apply/edit functionality (fast apply via search/replace, slow apply via full rewrite). Also used by Edit tool and Cmd+K
- `toolsService` — Built-in tool implementations (read_file, edit_file, run_command, search_for_files, etc.)
- `convertToLLMMessageService` — Converts internal chat format to provider-specific formats
- `subagentService` — Background agent spawning (explore, bash, browser types)
- `autocompleteService` — Inline code completion
- `sidebarPane` — React UI mount point

Agent & AI features:
- `agentRegistryService` — Custom agent definitions
- `agentEventService` — Agent event protocol
- `backgroundAgentService` — Background agent execution
- `parallelAgentService` — Multi-agent parallel execution
- `embeddingsService` — Codebase search via embeddings
- `modelRouterService` — Model routing logic
- `memoryService` — Memory system
- `sandboxService` — Sandbox execution
- `selfHealingService` — Self-healing logic
- `verificationPipelineService` — Verification pipeline execution
- `rulesService` — Custom rules
- `tokenBudgetService` — Token budget tracking
- `errorClassificationService` — Error classification
- `contextGatheringService` — Context gathering from workspace

UI & settings:
- `voidSettingsPane` — Settings panel React mount
- `voidCommandBarService` — Command bar UI
- `voidAuthService` — Authentication
- `voidLoginService` — Login screen
- `voidLandingService` — Landing page
- `voidOnboardingService` — Onboarding flow
- `voidSelectionHelperWidget` — Selection helper widget
- `tooltipService` — Tooltip service

Other:
- `terminalToolService` — Terminal interaction for tool calls
- `envFileService` — .env file support
- `extensionTransferService` — Extension management
- `fileService` — File explorer context menu
- `voidSCMService` — Source control management
- `metricsPollService` — Metrics/ping
- `aiRegexService` — AI-assisted regex
- `planCodeLensService` — Plan file CodeLens

**Common services** (`src/vs/workbench/contrib/void/common/`):
- `voidSettingsService` — Provider config, API keys, model selections, feature toggles. Implicit dependency for most services
- `sendLLMMessageService` — Browser-side IPC wrapper for LLM requests
- `modelCapabilities` — Provider/model metadata (must be updated when new models come out)
- `mcpService` — Model Context Protocol integration
- `voidModelService` — File model loading and URI management
- `refreshModelService` — Model refresh logic (e.g. Ollama model list)
- `metricsService` — Metrics collection
- `voidUpdateService` — Update service
- `directoryStrService` — Directory string utilities

**Main process** (`src/vs/workbench/contrib/void/electron-main/`):
- `sendLLMMessageChannel` — IPC server handling LLM requests from browser
- `llmMessage/sendLLMMessage.impl.ts` — Actual provider API calls (Anthropic, OpenAI, Gemini, etc.)
- `llmMessage/extractGrammar.ts` — XML parsing for tool calls in streaming responses
- `authChannel.ts` — Authentication IPC channel
- `mcpChannel.ts` — MCP protocol IPC channel
- `metricsMainService.ts` — Main process metrics
- `voidSCMMainService.ts` — Source control main service
- `voidUpdateMainService.ts` — Update main service

### LLM Message Pipeline

```
User Input (React Sidebar)
  → chatThreadService.sendMessage()
  → convertToLLMMessageService (format for provider)
  → sendLLMMessageService [Browser, IPC]
  → sendLLMMessageChannel [Main Process]
  → sendLLMMessage.impl.ts → Provider API
  → Streaming response via IPC events back to browser
```

### React UI Layer

Located in `src/vs/workbench/contrib/void/browser/react/`. Build pipeline:
1. `scope-tailwind` scopes Tailwind classes with `void-` prefix (outputs to `src2/`)
2. `tsup` bundles ESM from `src2/` (outputs to `out/`)

Entry points: `sidebar-tsx/`, `void-settings-tsx/`, `void-editor-widgets-tsx/`, `quick-edit-tsx/`, `void-onboarding/`, `diff/`, `void-auth-tsx/`, `void-landing-tsx/`, `void-tooltip/`.

Supporting directories: `util/` (shared components/helpers), `markdown/` (chat markdown rendering).

### Apply (Code Editing) System

Two modes in `editCodeService`:
- **Fast Apply**: LLM outputs search/replace blocks (`<<<<<<< ORIGINAL` / `=======` / `>>>>>>> UPDATED`)
- **Slow Apply**: Full file rewrite

Key concepts:
- **DiffZone** — A {startLine, endLine} region showing red/green diffs. Only type that can stream.
- **DiffArea** — Generalized line number tracker
- **Checkpoints** — File snapshots before each LLM/user message for reverting

### Key Types

- `ChatMode`: `'agent' | 'ask' | 'plan' | 'debug'`
- `ModelSelection`: `{providerName, modelName}` pair
- `ProviderName`: `'anthropic' | 'openAI' | 'deepseek' | 'openRouter' | 'openAICompatible' | 'gemini' | 'groq' | 'xAI' | 'mistral' | 'liteLLM' | 'googleVertex' | 'microsoftAzure' | 'awsBedrock' | 'ollama'`
- `ToolMessage<T>` — Typed tool calls with states: `invalid_params`, `tool_request`, `running_now`, `tool_error`, `success`, `rejected`
- `DecorativeCanceledTool` — Separate type for interrupted streaming tools (role: `interrupted_streaming_tool`)

### Built-in Tools

File operations: `read_file`, `ls_dir`, `get_dir_tree`, `rewrite_file`, `edit_file`, `create_file_or_folder`, `delete_file_or_folder`

Search: `search_pathnames_only`, `search_for_files`, `search_in_file`, `codebase_search` (embeddings-based)

Terminal: `run_command`, `open_persistent_terminal`, `run_persistent_command`, `kill_persistent_terminal`

Code quality: `read_lint_errors`, `run_verification`

Web & agents: `web_search`, `spawn_subagent`

Rules: `fetch_rules`

MCP tools are also available dynamically via `mcpService`.

### Supported LLM Providers

API-key providers: Anthropic, OpenAI, DeepSeek, OpenRouter, Gemini, Groq, xAI, Mistral

Endpoint-configured providers: Ollama (localhost:11434), LiteLLM (localhost:4000), OpenAI-Compatible (custom endpoint)

Cloud providers: Google Vertex AI (region + project), Microsoft Azure (resource + apiKey), AWS Bedrock (region + apiKey)

See `modelCapabilities.ts` for the full default model list per provider.

## Coding Conventions

### ESLint (Void Overrides)

Void relaxes some VS Code lint rules:
- `curly: off` — Braces not required for single-line if/else
- `prefer-const: off` — `let` is acceptable
- `semi: off` / `@stylistic/ts/semi: off` — Semicolons not enforced
- `code-no-dangerous-type-assertions: off`
- `@stylistic/ts/member-delimiter-style: off` — Flexible interface member delimiters

Layer enforcement is active: `common/` cannot import from `browser/` or `node/`. `browser/` cannot import from `node/` or `electron-main/`. All imports in browser must end with `.js`.

### Project Rules (from `.voidrules`)

- Most code lives in `src/vs/workbench/contrib/void/` — never modify files outside this directory without consulting the user first
- Do NOT lazily cast to `any`; find the correct type
- Do not add or remove semicolons — go with convention and minimize changes
- Type naming convention: `bOfA` (e.g., `toolNameOfToolId` for a map from `toolId` → `toolName`)
- Do not run anything to validate your changes; tell the user what to do instead

## Service Registration Pattern

```typescript
export const IMyService = createDecorator<IMyService>('myService');
export interface IMyService {
    readonly _serviceBrand: undefined;
    // methods
}
class MyService extends Disposable implements IMyService {
    declare readonly _serviceBrand: undefined;
    constructor(@IDependency private dep: IDependency) { super(); }
}
registerSingleton(IMyService, MyService, InstantiationType.Eager);
```

Register in `void.contribution.ts`. Use `@IMyService` in constructors for dependency injection.

## Additional Documentation

- `HOW_TO_CONTRIBUTE.md` — Platform-specific setup and contribution workflow
- `VOID_CODEBASE_GUIDE.md` — In-depth architecture walkthrough with diagrams
