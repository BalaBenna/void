# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Void?

Void is an open-source AI code editor, forked from VS Code. Most Void-specific code lives in `src/vs/workbench/contrib/void/`.

## Build & Development Commands

**Prerequisites:** Node v20.18.2 (see `.nvmrc`). On Mac, need Python and XCode. On Linux, need native build dependencies (see HOW_TO_CONTRIBUTE.md).

```bash
npm install                    # Install all dependencies
npm run watch                  # Watch-build client + extensions (done when 2/3 spinners turn to checkmarks)
npm run watchreact             # Watch-build React UI layer only
npm run buildreact             # One-shot build React UI layer
./scripts/code.sh              # Launch dev Void window (Mac/Linux)
./scripts/code.bat             # Launch dev Void window (Windows)
```

Reload the dev window with Cmd+R (Mac) or Ctrl+R after code changes.

**Additional useful scripts:**
```bash
npm run watchd                 # Watch-build as background daemon (detached)
npm run kill-watchd            # Kill the daemon
npm run compile                # One-shot compile (no watch)
npm run valid-layers-check     # Validate import layer rules
npm run hygiene                # Code hygiene checks (license headers, etc.)
```

**Testing:**
```bash
npm run test-node              # Mocha unit tests (Node)
npm run test-browser           # Playwright browser unit tests
npm run eslint                 # ESLint
npm run stylelint              # Stylelint
```

Note: There are no Void-specific test files. The test commands run VS Code's inherited test suites.

**Local executable build (slow, ~25 min):**
```bash
npm run gulp vscode-darwin-arm64   # Mac Apple Silicon
npm run gulp vscode-darwin-x64     # Mac Intel
npm run gulp vscode-linux-x64      # Linux
npm run gulp vscode-win32-x64      # Windows
```

**Backend (separate Bun server):**
```bash
cd backend
bun run dev        # Development with hot reload
bun run build      # Compile to dist/
bun run start      # Run compiled build
bun run db:migrate # Run Drizzle migrations
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
- `chatThreadService` — Chat conversation threads, message history, checkpoint snapshots
- `editCodeService` — Apply/edit functionality (fast apply via search/replace, slow apply via full rewrite). Also used by Edit tool and Cmd+K
- `toolsService` — Built-in tool implementations (read_file, edit_file, run_command, search_for_files, etc.)
- `convertToLLMMessageService` — Converts internal chat format to provider-specific formats
- `subagentService` — Background agent spawning (explore, bash, browser types)
- `autocompleteService` — Inline code completion
- `sandboxService` — Sandboxed execution (E2B cloud and local)
- `embeddingsService` — Codebase vector indexing and semantic search
- `modelRouterService` — Routes requests to different models automatically
- `memoryService` — Persistent memory across sessions
- `rulesService` — `.void/rules` file parsing and injection
- `agentRegistryService` — Custom user-defined agent definitions
- `agentEventService` — Agent lifecycle event protocol
- `backgroundAgentService` — Long-running background agents
- `parallelAgentService` — Runs multiple agents concurrently
- `errorClassificationService` — Classifies terminal/lint errors
- `selfHealingService` — Auto-retry/repair on failures
- `verificationPipelineService` — Post-edit verification steps
- `tokenBudgetService` — Tracks token usage budgets
- `voidCommandBarService` — Floating command bar above files
- `planCodeLensService` — CodeLens overlay for plan files
- `envFileService` — Reads `.env` files and injects vars into agent context
- `voidAuthService` / `voidLoginService` — Auth state and login UI
- `sidebarPane` — React UI mount point

**Common services** (`src/vs/workbench/contrib/void/common/`):
- `voidSettingsService` — Provider config, API keys, model selections, feature toggles. Implicit dependency for most services
- `sendLLMMessageService` — Browser-side IPC wrapper for LLM requests
- `modelCapabilities` — Provider/model metadata (must be updated when new models come out)
- `mcpService` — Model Context Protocol integration
- `voidModelService` — File model loading and URI management

**Main process** (`src/vs/workbench/contrib/void/electron-main/`):
- `sendLLMMessageChannel` — IPC server handling LLM requests from browser
- `llmMessage/sendLLMMessage.impl.ts` — Actual provider API calls (Anthropic, OpenAI, Gemini, etc.)
- `llmMessage/extractGrammar.ts` — XML parsing for tool calls in streaming responses
- `authChannel` — Google OAuth + encrypted token storage via `electron.safeStorage`

### IPC Channels

Browser↔Main communication uses named channels. All implement `IServerChannel` with `listen()` (events) and `call()` (commands). Browser gets a channel via `this.mainProcessService.getChannel('channel-name')`.

| Channel | Purpose |
|---|---|
| `void-channel-llmMessage` | All LLM API calls + model listing |
| `void-channel-mcp` | MCP server connections |
| `void-channel-auth` | Google OAuth + token storage |
| `void-channel-metrics` | Usage metrics |
| `void-channel-update` | Auto-update checks |
| `void-channel-scm` | Source control operations |

Note: Channels cannot use `@IService` decorator injection — dependencies must be passed manually in constructor.

### LLM Message Pipeline

```
User Input (React Sidebar)
  → chatThreadService.sendMessage()
  → convertToLLMMessageService (format for provider)
  → sendLLMMessageService [Browser, IPC]
  → sendLLMMessageChannel [Main Process]
  → sendLLMMessage.impl.ts → Provider API (direct)
     OR → backend proxy (when user is logged in and not in self-hosted mode)
  → Streaming response via IPC events back to browser
```

### React UI Layer

Located in `src/vs/workbench/contrib/void/browser/react/`. Build pipeline:
1. `scope-tailwind` scopes Tailwind classes with `void-` prefix (outputs to `src2/`)
2. `tsup` bundles ESM from `src2/` (outputs to `out/`)

All npm packages are bundled INTO the output (not external). Only `../../../*.js` VS Code platform imports are kept external. CSS is injected into JS via `injectStyle: true`.

Entry points: `sidebar-tsx/`, `void-settings-tsx/`, `void-editor-widgets-tsx/`, `quick-edit-tsx/`, `void-onboarding/`, `diff/`, `void-tooltip/`, `void-auth-tsx/`, `void-landing-tsx/`.

**React↔VS Code bridge** (`src/util/services.tsx`): `_registerServices(accessor)` initializes all global state listeners. Hooks like `useSettingsState`, `useChatThreadsState`, `useAuthState` etc. use module-level variables (not React context) for performance. `useAccessor()` provides direct access to VS Code services from React.

All Tailwind components must be wrapped in a `void-scope` class container. Custom CSS variables use the `--void-*` namespace (e.g., `--void-bg-1`, `--void-fg-1`).

### Apply (Code Editing) System

Two modes in `editCodeService`:
- **Fast Apply**: LLM outputs search/replace blocks (`<<<<<<< ORIGINAL` / `=======` / `>>>>>>> UPDATED`)
- **Slow Apply**: Full file rewrite

Key concepts:
- **DiffZone** — A {startLine, endLine} region showing red/green diffs. Only type that can stream.
- **DiffArea** — Generalized line number tracker
- **Checkpoints** — File snapshots before each LLM/user message for reverting

### Backend Server

The `backend/` directory is a separate **Bun + Hono** server (not part of the Electron app build).

**Stack:** Hono (HTTP), Drizzle ORM (PostgreSQL), Redis (ioredis), Google OAuth 2.0 + JWT, Stripe payments, Anthropic SDK (proxied LLM calls), E2B (sandboxed execution).

**Auth flow (desktop):** Electron opens system browser → Google OAuth → backend callback → `void://auth/callback` deep link → Electron intercepts protocol → stores encrypted tokens via `safeStorage` → browser process gets `onAuthStateChanged` IPC event.

**Key routes:** `/auth/google` (OAuth), `/auth/refresh`, `/v1/completions/stream` (proxied LLM), `/v1/user/me`, `/v1/user/usage`, `/v1/sandbox/*`.

**Database tables:** `users`, `refresh_tokens`, `daily_usage`, `request_logs`, `projects`.

Requires a `.env` file (not committed) with `DATABASE_URL`, `REDIS_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ANTHROPIC_API_KEY`, and optional `STRIPE_SECRET_KEY`, `E2B_API_KEY`.

### Key Types

- `ChatMode`: `'agent' | 'ask' | 'plan' | 'debug'`
- `FeatureName`: `'Chat' | 'Ctrl+K' | 'Autocomplete' | 'Apply' | 'SCM'`
- `ModelSelection`: `{providerName, modelName}` pair
- `ProviderName`: `'anthropic' | 'openAI' | 'deepseek' | 'gemini' | 'groq' | 'mistral' | 'xAI' | 'openAICompatible' | 'ollama' | 'openRouter' | 'liteLLM' | 'googleVertex' | 'microsoftAzure' | 'awsBedrock'`
- `ToolMessage<T>` — Typed tool calls with validation states (invalid_params, tool_request, running_now, success, rejected)

## ESLint Conventions (Void Overrides)

Void relaxes some VS Code lint rules:
- `curly: off` — Braces not required for single-line if/else
- `prefer-const: off` — `let` is acceptable
- `semi: off` — Semicolons not enforced
- `code-no-dangerous-type-assertions: off`

Layer enforcement is active: `common/` cannot import from `browser/` or `node/`. `browser/` cannot import from `node/` or `electron-main/`. All imports in browser must end with `.js`.

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

## Common Troubleshooting

- `"TypeError: Failed to fetch dynamically imported module"` → Ensure all imports end with `.js`.
- React build errors → Try `NODE_OPTIONS="--max-old-space-size=8192" npm run buildreact`.
- Missing styles after build → Wait a few seconds, then reload (Cmd+R).
- Path with spaces → Ensure the repo path has no spaces.
- `npm error libtool: error: unrecognised option: '-static'` → Install GNU libtool (macOS defaults to BSD libtool).
- Kill build scripts with Ctrl+D (not Ctrl+C, which leaves them running in background).
