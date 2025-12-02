# RAD Protocol Migration Plan

> **rad-mem**: Real-time Agent Data Memory System
>
> This document captures the complete transformation plan from rad-mem (a Claude Code plugin) to rad-mem (a standalone RAD Protocol server).

---

## Table of Contents

1. [Vision & Philosophy](#vision--philosophy)
2. [Current Architecture Analysis](#current-architecture-analysis)
3. [Hook-by-Hook Analysis](#hook-by-hook-analysis)
4. [Migration Tasks](#migration-tasks)
5. [New RAD Protocol API Design](#new-rad-protocol-api-design)
6. [Flexible Data Model](#flexible-data-model)
7. [Directory Structure Changes](#directory-structure-changes)
8. [Implementation Phases](#implementation-phases)

---

## Vision & Philosophy

### What is RAD?

**RAD = Real-time Agent Data**

RAD is positioned as a **protocol/pattern** (like RAG), not just a product.

| Aspect | RAG | RAD |
|--------|-----|-----|
| **Full Name** | Retrieval-Augmented Generation | Real-time Agent Data |
| **Data Source** | External documents (PDFs, websites, knowledge bases) | Agent's own actions, decisions, learnings |
| **When Created** | Pre-indexed, static | Real-time during agent execution |
| **Availability** | Query-time retrieval | Same-session + future sessions |
| **Analogy** | Reading a book when needed | Remembering what you did yesterday |

### Core Differentiator

> "RAG captures knowledge. RAD captures intelligence."

The key innovation is **real-time memory creation during agent execution via hooks**:
- Memories are captured while the agent works (not post-hoc transcript analysis)
- Memories can be referenced within the SAME session
- Focuses on what agents DO, not what they SAY

### Why This Matters

Competitors (SuperMemory, Mem0, Zep) analyze conversations **after** they're complete. RAD captures:
- Tool executions as they happen
- Decisions as they're made
- Discoveries as they're found
- Changes as they're implemented

---

## Current Architecture Analysis

### What We Have (rad-mem v6.3.2)

```
rad-mem/
├── src/
│   ├── hooks/                    # Claude Code-specific hooks
│   │   ├── context-hook.ts       # SessionStart - loads context
│   │   ├── new-hook.ts           # UserPromptSubmit - session init
│   │   ├── save-hook.ts          # PostToolUse - captures observations
│   │   ├── summary-hook.ts       # Stop - generates summaries
│   │   ├── cleanup-hook.ts       # SessionEnd - cleanup
│   │   └── user-message-hook.ts  # Display hook
│   │
│   ├── services/
│   │   ├── worker-service.ts     # Express REST API (THE CORE)
│   │   ├── worker/               # Composed services
│   │   │   ├── DatabaseManager.ts
│   │   │   ├── SessionManager.ts
│   │   │   ├── SSEBroadcaster.ts
│   │   │   ├── SDKAgent.ts
│   │   │   ├── PaginationHelper.ts
│   │   │   └── SettingsManager.ts
│   │   │
│   │   └── sqlite/               # Database layer
│   │       ├── SessionStore.ts
│   │       ├── Database.ts
│   │       └── types.ts
│   │
│   └── ui/viewer/                # React web interface
│
├── plugin/                       # Claude Code plugin packaging
│   ├── hooks/hooks.json          # Hook definitions
│   ├── scripts/                  # Compiled JS hooks
│   └── skills/                   # Claude Code skills
```

### The Problem: Split Brain Architecture

Currently, BOTH hooks AND worker access the database directly:

```
┌─────────────────────────────────────────────────────────┐
│                    CURRENT (BAD)                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐                                       │
│  │ context-hook │──────┐                                │
│  └──────────────┘      │                                │
│                        │      ┌──────────────┐          │
│  ┌──────────────┐      ├─────▶│   SQLite DB  │          │
│  │   new-hook   │──────┤      └──────────────┘          │
│  └──────────────┘      │             ▲                  │
│                        │             │                  │
│  ┌──────────────┐      │      ┌──────┴──────┐          │
│  │ cleanup-hook │──────┘      │   Worker    │          │
│  └──────────────┘             └─────────────┘          │
│                                      ▲                  │
│  ┌──────────────┐                    │                  │
│  │  save-hook   │────────────────────┘                  │
│  └──────────────┘      (HTTP only)                      │
│                                                         │
└─────────────────────────────────────────────────────────┘

Multiple entry points to database = race conditions, inconsistency, tight coupling
```

### The Goal: Single Point of Access

```
┌─────────────────────────────────────────────────────────┐
│                    TARGET (GOOD)                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐                                       │
│  │ Claude Code  │──┐                                    │
│  │   Adapter    │  │                                    │
│  └──────────────┘  │                                    │
│                    │      ┌─────────────┐               │
│  ┌──────────────┐  │      │             │    ┌────────┐ │
│  │   Cursor     │──┼─────▶│ RAD Server  │───▶│ SQLite │ │
│  │   Adapter    │  │      │   (HTTP)    │    └────────┘ │
│  └──────────────┘  │      │             │               │
│                    │      └─────────────┘               │
│  ┌──────────────┐  │                                    │
│  │   Custom     │──┘                                    │
│  │   Adapter    │                                       │
│  └──────────────┘                                       │
│                                                         │
└─────────────────────────────────────────────────────────┘

Single API = consistency, testability, multi-client support
```

---

## Hook-by-Hook Analysis

### 1. context-hook.ts (SessionStart)

**Purpose:** Load historical context into the session

**Current Implementation (553 lines):**
```typescript
// DIRECT DATABASE ACCESS - BAD!
const db = new SessionStore();

const allObservations = db.db.prepare(`
  SELECT id, sdk_session_id, type, title, subtitle, narrative,
         facts, concepts, files_read, files_modified, discovery_tokens,
         created_at, created_at_epoch
  FROM observations
  WHERE project = ?
  ORDER BY created_at_epoch DESC
  LIMIT ?
`).all(project, DISPLAY_OBSERVATION_COUNT);

const recentSummaries = db.db.prepare(`
  SELECT id, sdk_session_id, request, investigated, learned,
         completed, next_steps, created_at, created_at_epoch
  FROM session_summaries
  WHERE project = ?
  ORDER BY created_at_epoch DESC
  LIMIT ?
`).all(project, DISPLAY_SESSION_COUNT + SUMMARY_LOOKAHEAD);
```

**What It Does:**
1. Reads settings for context depth (CLAUDE_MEM_CONTEXT_OBSERVATIONS)
2. Queries observations directly from DB
3. Queries summaries directly from DB
4. Calculates token economics (read tokens vs. discovery tokens)
5. Groups observations by day
6. Formats output as markdown/ANSI timeline
7. Returns as `hookSpecificOutput.additionalContext`

**Migration Required:**
- [ ] Create `GET /api/context/:project` endpoint in worker
- [ ] Move all DB queries to worker
- [ ] Move token calculation to worker
- [ ] Worker returns structured JSON
- [ ] Hook becomes thin client that formats output

**New Hook (after migration):**
```typescript
async function contextHook(input: SessionStartInput): Promise<string> {
  const project = path.basename(input.cwd);
  const port = getWorkerPort();

  const response = await fetch(`http://127.0.0.1:${port}/api/context/${project}`);
  const data = await response.json();

  return formatContextOutput(data, input.cwd);
}
```

---

### 2. new-hook.ts (UserPromptSubmit)

**Purpose:** Initialize session, track prompts

**Current Implementation (136 lines):**
```typescript
// DIRECT DATABASE ACCESS - BAD!
const db = new SessionStore();

// Creates session if not exists, returns existing if exists
const sessionDbId = db.createSDKSession(session_id, project, prompt);
const promptNumber = db.incrementPromptCounter(sessionDbId);

// Save user prompt for full-text search
db.saveUserPrompt(session_id, promptNumber, prompt);

db.close();

// THEN calls worker (good)
await fetch(`http://127.0.0.1:${port}/sessions/${sessionDbId}/init`, {
  method: 'POST',
  body: JSON.stringify({ project, userPrompt: cleanedPrompt, promptNumber })
});
```

**What It Does:**
1. Creates SDK session in DB (idempotent)
2. Increments prompt counter
3. Saves raw user prompt for FTS
4. Calls worker `/init` endpoint

**Migration Required:**
- [ ] Enhance `POST /sessions/:id/init` to handle session creation
- [ ] Move prompt counter logic to worker
- [ ] Move user prompt saving to worker
- [ ] Worker returns `{ sessionDbId, promptNumber, status }`

**New Hook (after migration):**
```typescript
async function newHook(input: UserPromptSubmitInput): Promise<void> {
  const project = path.basename(input.cwd);
  const port = getWorkerPort();

  await ensureWorkerRunning();

  const response = await fetch(`http://127.0.0.1:${port}/sessions/init`, {
    method: 'POST',
    body: JSON.stringify({
      claude_session_id: input.session_id,
      project,
      user_prompt: input.prompt
    })
  });

  const { sessionDbId, promptNumber } = await response.json();
  console.error(`[new-hook] Session ${sessionDbId}, prompt #${promptNumber}`);

  console.log(createHookResponse('UserPromptSubmit', true));
}
```

---

### 3. save-hook.ts (PostToolUse)

**Purpose:** Capture tool use as observations

**Current Implementation (107 lines):**
```typescript
// Hardcoded skip list - should be configurable
const SKIP_TOOLS = new Set([
  'ListMcpResourcesTool',
  'SlashCommand',
  'Skill',
  'TodoWrite',
  'AskUserQuestion'
]);

// STILL ACCESSES DB DIRECTLY for session lookup
const db = new SessionStore();
const sessionDbId = db.createSDKSession(session_id, '', '');
const promptNumber = db.getPromptCounter(sessionDbId);
db.close();

// Then calls worker (good)
await fetch(`http://127.0.0.1:${port}/sessions/${sessionDbId}/observations`, {
  method: 'POST',
  body: JSON.stringify({
    tool_name, tool_input, tool_response, prompt_number, cwd
  })
});
```

**What It Does:**
1. Filters skip tools
2. Gets session ID from DB (direct access!)
3. Gets prompt number from DB (direct access!)
4. Sends observation to worker

**Migration Required:**
- [ ] Move SKIP_TOOLS to worker configuration
- [ ] Remove direct DB access for session lookup
- [ ] Worker should accept `claude_session_id` and resolve internally

**New Hook (after migration):**
```typescript
async function saveHook(input: PostToolUseInput): Promise<void> {
  const port = getWorkerPort();

  await ensureWorkerRunning();

  const response = await fetch(`http://127.0.0.1:${port}/observations`, {
    method: 'POST',
    body: JSON.stringify({
      claude_session_id: input.session_id,
      tool_name: input.tool_name,
      tool_input: input.tool_input,
      tool_response: input.tool_response,
      cwd: input.cwd
    })
  });

  console.log(createHookResponse('PostToolUse', true));
}
```

---

### 4. summary-hook.ts (Stop)

**Purpose:** Generate session summary at end

**Current Implementation (236 lines):**
```typescript
// DIRECT FILE ACCESS - Claude Code specific
function extractLastUserMessage(transcriptPath: string): string {
  const content = readFileSync(transcriptPath, 'utf-8');
  // ... parse JSONL transcript format
}

function extractLastAssistantMessage(transcriptPath: string): string {
  // ... parse JSONL transcript format
}

// DIRECT DB ACCESS
const db = new SessionStore();
const sessionDbId = db.createSDKSession(session_id, '', '');
const promptNumber = db.getPromptCounter(sessionDbId);
db.close();

// Then calls worker
await fetch(`http://127.0.0.1:${port}/sessions/${sessionDbId}/summarize`, {
  method: 'POST',
  body: JSON.stringify({
    prompt_number: promptNumber,
    last_user_message: lastUserMessage,
    last_assistant_message: lastAssistantMessage
  })
});
```

**What It Does:**
1. Reads transcript file directly (Claude Code JSONL format)
2. Parses to extract last user/assistant messages
3. Gets session info from DB
4. Sends summary request to worker

**Migration Required:**
- [ ] Remove direct DB access
- [ ] Keep transcript parsing in adapter (it's Claude Code-specific format)
- [ ] Worker accepts parsed messages, not file path

**New Hook (after migration):**
```typescript
async function summaryHook(input: StopInput): Promise<void> {
  const port = getWorkerPort();

  await ensureWorkerRunning();

  // Transcript parsing stays in adapter (Claude Code specific format)
  const lastUserMessage = extractLastUserMessage(input.transcript_path);
  const lastAssistantMessage = extractLastAssistantMessage(input.transcript_path);

  await fetch(`http://127.0.0.1:${port}/sessions/summarize`, {
    method: 'POST',
    body: JSON.stringify({
      claude_session_id: input.session_id,
      last_user_message: lastUserMessage,
      last_assistant_message: lastAssistantMessage
    })
  });

  console.log(createHookResponse('Stop', true));
}
```

---

### 5. cleanup-hook.ts (SessionEnd)

**Purpose:** Mark session complete, stop processing indicator

**Current Implementation (103 lines):**
```typescript
// DIRECT DB ACCESS - BAD!
const db = new SessionStore();
const session = db.findActiveSDKSession(session_id);

if (!session) {
  db.close();
  console.log('{"continue": true, "suppressOutput": true}');
  process.exit(0);
}

// DIRECT DB WRITE - BAD!
db.markSessionCompleted(session.id);
db.close();

// Then tells worker (good)
await fetch(`http://127.0.0.1:${workerPort}/sessions/${session.id}/complete`, {
  method: 'POST'
});
```

**What It Does:**
1. Finds active session in DB
2. Marks session completed in DB
3. Notifies worker to stop spinner

**Migration Required:**
- [ ] Move all logic to worker `/sessions/:id/complete` endpoint
- [ ] Worker handles session lookup and status update

**New Hook (after migration):**
```typescript
async function cleanupHook(input: SessionEndInput): Promise<void> {
  const port = getWorkerPort();

  try {
    await fetch(`http://127.0.0.1:${port}/sessions/complete`, {
      method: 'POST',
      body: JSON.stringify({
        claude_session_id: input.session_id,
        reason: input.reason
      })
    });
  } catch {
    // Non-critical - worker might be down
  }

  console.log('{"continue": true, "suppressOutput": true}');
}
```

---

### 6. user-message-hook.ts (SessionStart)

**Purpose:** Display context to user via stderr

**Current Implementation (63 lines):**
- First-time installation message
- Runs context-hook with colors
- Displays to stderr (only way to show messages in Claude Code UI)

**Migration Required:**
- [ ] This is purely UI/display - stays in Claude Code adapter
- [ ] After context-hook migration, this just calls the new endpoint

---

## Migration Tasks

### Phase 1: Worker API Enhancements

#### Task 1.1: Add Context Endpoint

**File:** `src/services/worker-service.ts`

```typescript
// NEW ENDPOINT
app.get('/api/context/:project', async (req, res) => {
  const { project } = req.params;
  const limit = parseInt(req.query.limit as string) || 50;

  const observations = dbManager.getRecentObservations(project, limit);
  const summaries = dbManager.getRecentSummaries(project, 10);

  // Calculate token economics
  const tokenStats = calculateTokenEconomics(observations);

  res.json({
    observations,
    summaries,
    tokenStats,
    project
  });
});
```

**Required DatabaseManager methods:**
```typescript
// src/services/worker/DatabaseManager.ts
getRecentObservations(project: string, limit: number): Observation[]
getRecentSummaries(project: string, limit: number): SessionSummary[]
```

#### Task 1.2: Enhance Session Init Endpoint

**Current:** `POST /sessions/:id/init`
**New:** `POST /sessions/init` (no ID in path - worker generates it)

```typescript
app.post('/sessions/init', async (req, res) => {
  const { claude_session_id, project, user_prompt } = req.body;

  // All DB operations in worker
  const sessionDbId = dbManager.createOrGetSession(claude_session_id, project, user_prompt);
  const promptNumber = dbManager.incrementPromptCounter(sessionDbId);
  dbManager.saveUserPrompt(claude_session_id, promptNumber, user_prompt);

  // Start SDK agent session
  await sdkAgent.initSession(sessionDbId, project, user_prompt, promptNumber);

  res.json({ sessionDbId, promptNumber, status: 'initialized' });
});
```

#### Task 1.3: Enhance Observations Endpoint

**Current:** `POST /sessions/:id/observations` (requires knowing DB ID)
**New:** `POST /observations` (accepts claude_session_id)

```typescript
app.post('/observations', async (req, res) => {
  const { claude_session_id, tool_name, tool_input, tool_response, cwd } = req.body;

  // Skip tool check in worker
  if (SKIP_TOOLS.has(tool_name)) {
    return res.json({ status: 'skipped', reason: 'tool_in_skip_list' });
  }

  // Resolve session
  const sessionDbId = dbManager.getSessionByClaudeId(claude_session_id);
  const promptNumber = dbManager.getPromptCounter(sessionDbId);

  // Queue observation
  await sdkAgent.queueObservation(sessionDbId, {
    tool_name, tool_input, tool_response, prompt_number: promptNumber, cwd
  });

  res.json({ status: 'queued', sessionDbId });
});
```

#### Task 1.4: Enhance Summarize Endpoint

**New:** `POST /sessions/summarize`

```typescript
app.post('/sessions/summarize', async (req, res) => {
  const { claude_session_id, last_user_message, last_assistant_message } = req.body;

  const sessionDbId = dbManager.getSessionByClaudeId(claude_session_id);
  const promptNumber = dbManager.getPromptCounter(sessionDbId);

  await sdkAgent.queueSummary(sessionDbId, {
    prompt_number: promptNumber,
    last_user_message,
    last_assistant_message
  });

  res.json({ status: 'queued', sessionDbId });
});
```

#### Task 1.5: Enhance Complete Endpoint

**New:** `POST /sessions/complete`

```typescript
app.post('/sessions/complete', async (req, res) => {
  const { claude_session_id, reason } = req.body;

  const session = dbManager.findActiveSession(claude_session_id);

  if (!session) {
    return res.json({ status: 'no_active_session' });
  }

  dbManager.markSessionCompleted(session.id);
  sessionManager.removeSession(session.id);
  broadcastProcessingStatus();

  res.json({ status: 'completed', sessionDbId: session.id });
});
```

---

### Phase 2: Refactor Hooks to Thin Clients

After worker enhancements, each hook becomes ~20-30 lines:

1. Parse stdin JSON
2. Call worker HTTP endpoint
3. Output response

See "New Hook (after migration)" sections above for each hook.

---

### Phase 3: Configuration Migration

#### SKIP_TOOLS Configuration

**Current:** Hardcoded in save-hook.ts
**New:** Worker configuration file

```typescript
// src/config/observation-config.ts
export const OBSERVATION_CONFIG = {
  skipTools: new Set([
    'ListMcpResourcesTool',
    'SlashCommand',
    'Skill',
    'TodoWrite',
    'AskUserQuestion'
  ]),

  // Future: configurable via settings
  loadFromSettings(): void {
    // Load from ~/.rad-mem/config.json
  }
};
```

---

## New RAD Protocol API Design

### Complete API Specification

```
RAD Protocol Server API v1.0
============================

Base URL: http://localhost:38888

CONTEXT
-------
GET  /api/context/:project
     Query params: limit (default: 50)
     Returns: { observations, summaries, tokenStats, project }

SESSIONS
--------
POST /sessions/init
     Body: { claude_session_id, project, user_prompt }
     Returns: { sessionDbId, promptNumber, status }

POST /sessions/complete
     Body: { claude_session_id, reason }
     Returns: { status, sessionDbId? }

POST /sessions/summarize
     Body: { claude_session_id, last_user_message, last_assistant_message }
     Returns: { status, sessionDbId }

OBSERVATIONS
------------
POST /observations
     Body: { claude_session_id, tool_name, tool_input, tool_response, cwd }
     Returns: { status, sessionDbId?, reason? }

SEARCH
------
GET  /api/search
     Query params: query, format, limit, type, project, dateRange, obs_type
     Returns: Search results

GET  /api/observation/:id
     Returns: Full observation

GET  /api/session/:id
     Returns: Session with observations

HEALTH
------
GET  /health
     Returns: { status, uptime, version }

VIEWER
------
GET  /
     Returns: React web UI

GET  /api/events
     SSE stream for real-time updates
```

---

## Flexible Data Model

### Current Rigid Model

```typescript
// Current: Fixed observation types
interface ObservationRow {
  type: 'decision' | 'bugfix' | 'feature' | 'refactor' | 'discovery' | 'change';
  // ... fixed fields
}
```

### Proposed Flexible Model

```typescript
// RAD Protocol: Flexible entity model
interface RADEntity {
  // Identity
  id: string;                    // UUID
  entity_type: string;           // User-defined: "observation", "decision", custom...

  // Source tracking
  source_client: string;         // "claude-code", "cursor", "custom-agent"
  agent_session_id: string;      // Client's session identifier

  // Timestamps
  created_at: string;            // ISO 8601
  created_at_epoch: number;      // Unix ms

  // Content (flexible)
  title?: string;
  subtitle?: string;
  content: Record<string, any>;  // JSON blob - schema varies by entity_type

  // Standard metadata
  concepts?: string[];           // Semantic tags
  files_read?: string[];         // Files accessed
  files_modified?: string[];     // Files changed

  // ROI metrics
  discovery_tokens?: number;     // Work investment
}

// Type-specific content schemas
interface ObservationContent {
  narrative?: string;
  facts?: string[];
  tool_name?: string;
  tool_input?: any;
  tool_response?: any;
}

interface DecisionContent {
  problem: string;
  options: string[];
  chosen: string;
  rationale: string;
}

interface DiscoveryContent {
  question: string;
  finding: string;
  implications?: string[];
}
```

### Database Schema Evolution

```sql
-- Current: Observations table with fixed schema
CREATE TABLE observations (
  id INTEGER PRIMARY KEY,
  type TEXT CHECK(type IN ('decision','bugfix','feature','refactor','discovery','change')),
  title TEXT,
  -- ... many fixed columns
);

-- Future: Flexible entities table
CREATE TABLE rad_entities (
  id TEXT PRIMARY KEY,           -- UUID
  entity_type TEXT NOT NULL,     -- User-defined type
  source_client TEXT NOT NULL,   -- Which client created this
  agent_session_id TEXT NOT NULL,

  title TEXT,
  subtitle TEXT,
  content_json TEXT,             -- Flexible JSON content

  concepts_json TEXT,            -- JSON array
  files_read_json TEXT,          -- JSON array
  files_modified_json TEXT,      -- JSON array

  discovery_tokens INTEGER DEFAULT 0,

  created_at TEXT NOT NULL,
  created_at_epoch INTEGER NOT NULL,

  -- Indexes
  FOREIGN KEY (agent_session_id) REFERENCES rad_sessions(id)
);

-- FTS5 for flexible content search
CREATE VIRTUAL TABLE rad_entities_fts USING fts5(
  title, subtitle, content_json,
  content='rad_entities',
  content_rowid='rowid'
);
```

---

## Directory Structure Changes

### Current Structure

```
rad-mem/
├── src/
│   ├── hooks/           # Claude Code specific - TO REMOVE
│   ├── services/        # Core - KEEP & ENHANCE
│   ├── sdk/             # Agent SDK - KEEP
│   ├── ui/              # Viewer - KEEP
│   └── shared/          # Utils - KEEP
│
├── plugin/              # Claude Code packaging - TO REMOVE
│   ├── hooks/
│   ├── scripts/
│   ├── skills/
│   └── ui/
│
├── package.json         # TO UPDATE
└── CLAUDE.md            # TO UPDATE
```

### Target Structure

```
rad-mem/
├── src/
│   ├── server/                    # RAD Protocol Server (renamed from services)
│   │   ├── rad-server.ts          # Main entry (renamed from worker-service.ts)
│   │   ├── routes/                # Express routes (extracted)
│   │   │   ├── context.ts
│   │   │   ├── sessions.ts
│   │   │   ├── observations.ts
│   │   │   └── search.ts
│   │   │
│   │   ├── services/              # Business logic (from worker/)
│   │   │   ├── DatabaseManager.ts
│   │   │   ├── SessionManager.ts
│   │   │   ├── SSEBroadcaster.ts
│   │   │   ├── SDKAgent.ts
│   │   │   └── ...
│   │   │
│   │   └── config/                # Server configuration
│   │       ├── observation-config.ts
│   │       └── settings.ts
│   │
│   ├── protocol/                  # RAD Protocol definitions
│   │   ├── types.ts               # Core types
│   │   ├── schema.ts              # Zod schemas
│   │   └── events.ts              # Event types
│   │
│   ├── storage/                   # Data layer (from sqlite/)
│   │   ├── sqlite/
│   │   │   ├── Database.ts
│   │   │   ├── SessionStore.ts
│   │   │   ├── migrations.ts
│   │   │   └── types.ts
│   │   │
│   │   └── chroma/                # Vector storage
│   │       └── ChromaSync.ts
│   │
│   ├── sdk/                       # Claude Agent SDK integration
│   │   ├── parser.ts
│   │   └── prompts.ts
│   │
│   └── ui/                        # Web viewer
│       └── viewer/
│
├── adapters/                      # Client adapters (examples)
│   └── claude-code/               # Claude Code adapter (the current hooks)
│       ├── hooks/
│       │   ├── context-hook.ts
│       │   ├── new-hook.ts
│       │   ├── save-hook.ts
│       │   ├── summary-hook.ts
│       │   └── cleanup-hook.ts
│       │
│       ├── plugin/                # Claude Code plugin packaging
│       │   ├── hooks.json
│       │   └── skills/
│       │
│       └── README.md              # How to use Claude Code adapter
│
├── examples/                      # Integration examples
│   ├── simple-client/             # Minimal HTTP client
│   └── custom-adapter/            # How to build adapter
│
├── docs/                          # Documentation
│   ├── protocol.md                # RAD Protocol spec
│   ├── api.md                     # API reference
│   └── adapters.md                # Adapter development guide
│
├── package.json
├── CLAUDE.md
└── README.md
```

---

## Implementation Phases

### Phase 1: Worker API Enhancements (No Breaking Changes)
**Goal:** Add new endpoints while keeping old ones working

1. Add `GET /api/context/:project`
2. Add `POST /sessions/init` (new route, keeps old `/sessions/:id/init`)
3. Add `POST /observations` (new route, keeps old `/sessions/:id/observations`)
4. Add `POST /sessions/summarize` (new route)
5. Add `POST /sessions/complete` (new route)
6. Move SKIP_TOOLS to config

**Tests:**
- All existing hooks still work
- New endpoints work correctly
- No DB access from hooks

### Phase 2: Migrate Hooks to New Endpoints
**Goal:** Hooks become thin HTTP clients

1. Update context-hook.ts to use `/api/context/:project`
2. Update new-hook.ts to use `/sessions/init`
3. Update save-hook.ts to use `/observations`
4. Update summary-hook.ts to use `/sessions/summarize`
5. Update cleanup-hook.ts to use `/sessions/complete`

**Tests:**
- Full integration test of each hook
- No direct SessionStore imports in hooks (except for compatibility)

### Phase 3: Restructure Codebase
**Goal:** Clean architecture for RAD Protocol

1. Rename `services/` to `server/`
2. Extract routes to `server/routes/`
3. Create `protocol/` with types and schemas
4. Move hooks to `adapters/claude-code/`
5. Update imports throughout

### Phase 4: Flexible Data Model (Optional - Future)
**Goal:** Support arbitrary entity types

1. Create `rad_entities` table
2. Add migration from `observations` to `rad_entities`
3. Update SDKAgent for flexible schemas
4. Maintain backward compatibility

### Phase 5: Multi-Client Support (Optional - Future)
**Goal:** Official support for non-Claude Code clients

1. Create adapter interface/SDK
2. Document protocol
3. Build example adapters (Cursor, custom)

---

## Appendix: Key Files to Modify

### Worker Service Changes

**File:** `src/services/worker-service.ts`

New methods needed:
- `setupContextRoutes()`
- `setupSessionRoutes()` (enhanced)
- `setupObservationRoutes()` (enhanced)

### DatabaseManager Changes

**File:** `src/services/worker/DatabaseManager.ts`

New methods needed:
- `getRecentObservations(project: string, limit: number)`
- `getRecentSummaries(project: string, limit: number)`
- `createOrGetSession(claudeSessionId: string, project: string, prompt: string)`
- `getSessionByClaudeId(claudeSessionId: string)`
- `findActiveSession(claudeSessionId: string)`

### SessionStore Changes

**File:** `src/services/sqlite/SessionStore.ts`

Ensure these methods are accessible via DatabaseManager:
- `createSDKSession()` → exposed via DatabaseManager
- `incrementPromptCounter()` → exposed via DatabaseManager
- `saveUserPrompt()` → exposed via DatabaseManager
- `findActiveSDKSession()` → exposed via DatabaseManager
- `markSessionCompleted()` → exposed via DatabaseManager

---

## Summary

This migration transforms rad-mem from a Claude Code-specific plugin to a standalone RAD Protocol server that can serve any AI agent client.

**Key Principles:**
1. Single point of database access (worker only)
2. Thin client adapters (HTTP calls only)
3. Flexible data model for future extensibility
4. Backward compatibility during migration

**Time Estimate:**
- Phase 1: 2-4 hours (worker enhancements)
- Phase 2: 2-3 hours (hook migration)
- Phase 3: 1-2 hours (restructure)
- Phase 4-5: Future work

---

*Document created: 2025-11-26*
*Based on analysis of rad-mem v6.3.2*
