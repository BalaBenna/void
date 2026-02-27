/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/


// register inline diffs
import './editCodeService.js'

// register Sidebar pane, state, actions (keybinds, menus) (Ctrl+L)
import './sidebarActions.js'
import './sidebarPane.js'

// register quick edit (Ctrl+K)
import './quickEditActions.js'


// register Autocomplete
import './autocompleteService.js'

// register Context services
// import './contextGatheringService.js'
// import './contextUserChangesService.js'

// settings pane
import './voidSettingsPane.js'

// register css
import './media/void.css'
import './media/islands-dark-ui.css'

// update (frontend part, also see platform/)
import './voidUpdateActions.js'

import './convertToLLMMessageWorkbenchContrib.js'

// tools
import './toolsService.js'
import './terminalToolService.js'

// Error Classification Service
import './errorClassificationService.js'

// Self-Healing Service
import './selfHealingService.js'

// Verification Pipeline Service
import './verificationPipelineService.js'

// register Command Bar Service
import './voidCommandBarService.js'

// register Thread History
import './chatThreadService.js'

// Plan file CodeLens
import './planCodeLensService.js'

// register Subagent service
import './subagentService.js'

// Agent Registry (custom agent definitions)
import './agentRegistryService.js'

// .env file support
import './envFileService.js'

// Phase 1: Agent Event Protocol
import './agentEventService.js'

// Phase 3: Rules Service
import './rulesService.js'

// Phase 1: Token Budget Service
import './tokenBudgetService.js'

// Phase 2: Sandbox Service
import './sandboxService.js'

// Phase 6: Embeddings / Codebase Search Service
import './embeddingsService.js'

// Phase 7: Model Router Service
import './modelRouterService.js'

// Phase 8: Memory Service
import './memoryService.js'

// Phase 9: Parallel Agent Service
import './parallelAgentService.js'

// Phase 10: Background Agent Service
import './backgroundAgentService.js'

// ping
import './metricsPollService.js'

// helper services
import './helperServices/consistentItemService.js'

// register selection helper
import './voidSelectionHelperWidget.js'

// register tooltip service
import './tooltipService.js'

// register auth service
import './voidAuthService.js'

// register login screen
import './voidLoginService.js'

// register landing page
import './voidLandingService.js'

// register onboarding service
import './voidOnboardingService.js'

// register misc service
import './miscWokrbenchContrib.js'

// register file service (for explorer context menu)
import './fileService.js'

// register source control management
import './voidSCMService.js'

// ---------- common (unclear if these actually need to be imported, because they're already imported wherever they're used) ----------

// llmMessage
import '../common/sendLLMMessageService.js'

// voidSettings
import '../common/voidSettingsService.js'

// refreshModel
import '../common/refreshModelService.js'

// metrics
import '../common/metricsService.js'

// updates
import '../common/voidUpdateService.js'

// model service
import '../common/voidModelService.js'
