# RAD-MEM: Observation Protocol & Domain Organization

**Created:** 2025-11-30
**Purpose:** Define the complete organizational structure of how observations flow through the system, what the inputs/outputs are, and how domains customize this process.

**IMPORTANT:** This is an ORGANIZATIONAL document - NO CODE. This defines structure, flow, inputs, outputs, and methodology.

---

## Table of Contents

1. [Current Observation Protocol](#current-observation-protocol)
2. [Session Lifecycle Flow](#session-lifecycle-flow)
3. [Observation Intake System](#observation-intake-system)
4. [Observation Extraction Methodology](#observation-extraction-methodology)
5. [Data Structures: Inputs and Outputs](#data-structures-inputs-and-outputs)
6. [Domain System Architecture](#domain-system-architecture)
7. [Platform vs Domain Separation](#platform-vs-domain-separation)
8. [Domain Customization Points](#domain-customization-points)

---

## Current Observation Protocol

### What It Does

The RAD-MEM observation protocol is a **memory extraction pipeline** that:

1. **Watches** tool executions from AI agents (Read, Write, Edit, Bash, etc.)
2. **Extracts** meaningful observations from those tool uses via AI analysis
3. **Structures** the observations into searchable, reusable memory
4. **Stores** observations in both SQLite (structured search) and Chroma (semantic search)
5. **Retrieves** relevant context for future sessions

### Core Philosophy

**Observer Pattern:** RAD-MEM is a "memory agent" that observes a PRIMARY agent's work. It never does work itself - it only watches and records what the primary agent builds, fixes, configures, or discovers.

**Event-Driven:** Zero-latency queue system. No polling. Messages flow through EventEmitters, waking up the SDK agent immediately when new tool uses arrive.

**Dual Storage:** Structured data in SQLite for exact queries, vector embeddings in Chroma for semantic similarity.

---

## Session Lifecycle Flow

### Phase 1: Session Initialization

**Trigger:** Platform detects new user request

**Inputs:**
- `agent_session_id` - The primary agent's session UUID (from platform)
- `platform` - Which platform is sending data ("claude-code", "cursor", etc.)
- `project` - Project identifier (usually directory name)
- `user_prompt` - The user's request text
- `domain` - (FUTURE) Domain type ("coding", "emails", "books")

**Flow:**
1. Platform adapter intercepts session start
2. Sends `POST /api/sessions/ensure` to RAD server
3. Server checks if session exists (idempotent - safe to call multiple times)
4. Creates database row with session metadata
5. Initializes in-memory session object
6. Returns session ID and prompt number

**Outputs:**
- Internal session ID (database primary key)
- Prompt number (increments with each user request)
- Created flag (true if new, false if existing)

**State Changes:**
- Database: New row in `sdk_sessions` table
- Memory: ActiveSession object created in SessionManager
- Event system: EventEmitter registered for this session

---

### Phase 2: Observation Intake

**Trigger:** Platform detects tool execution

**Inputs:**
- `agent_session_id` - Session identifier
- `platform` - Platform identifier
- `tool_name` - Name of tool executed (Read, Write, Bash, etc.)
- `tool_input` - JSON of tool parameters
- `tool_response` - JSON of tool output
- `cwd` - Current working directory (for spatial context)
- `prompt_number` - Which user request this belongs to

**Flow:**
1. Platform adapter intercepts tool completion
2. Filters out meta-tools (TodoWrite, SlashCommand, AskUserQuestion)
3. Sends `POST /api/observations` to RAD server
4. Server resolves session (finds database ID from agent_session_id)
5. Queues observation in SessionManager's event-driven queue
6. Emits 'message' event to wake up SDK agent
7. Returns immediately (queued, not processed yet)

**Outputs:**
- Status: "queued" or "skipped"
- Session ID and prompt number (for tracking)

**State Changes:**
- Memory: Observation added to session's `pendingMessages` array
- Event: EventEmitter fires 'message', waking SDK agent's iterator
- Queue depth: Increments by 1

**Important:** This is **asynchronous**. The tool observation is queued instantly, but extraction happens later when the SDK agent processes it.

---

### Phase 3: Observation Extraction

**Trigger:** SDK agent consumes next item from queue

**The SDK Agent:**
- Runs as a subprocess using Claude Agent SDK
- Has NO tools available (observer only - no Read, Write, Bash, etc.)
- Receives all information via synthetic user messages
- Responds with XML-formatted observations

**Extraction Flow:**

**3.1 - Prompt Generation**

For each queued observation, build prompt:
```
<observed_from_primary_session>
  <what_happened>{tool_name}</what_happened>
  <occurred_at>{timestamp}</occurred_at>
  <working_directory>{cwd}</working_directory>
  <parameters>{tool_input as JSON}</parameters>
  <outcome>{tool_response as JSON}</outcome>
</observed_from_primary_session>
```

**3.2 - Send to Claude**

- Model: claude-haiku-4-5 (configurable)
- System prompt: Instructs agent to extract observations from tool use
- Disallowed tools: All tools (agent is observer only)
- Context: Init prompt sets up the observer role and output format

**3.3 - Parse Response**

Agent responds with XML:
```xml
<observation>
  <type>discovery</type>
  <title>Database Schema Uses UUID Primary Keys</title>
  <subtitle>All tables use UUID v4 for primary keys instead of auto-incrementing integers</subtitle>
  <facts>
    <fact>users table has id column type UUID with DEFAULT gen_random_uuid()</fact>
    <fact>posts table references users.id via FOREIGN KEY constraint</fact>
    <fact>UUID format prevents enumeration attacks on API endpoints</fact>
  </facts>
  <narrative>The database schema uses PostgreSQL's UUID type for all primary keys, generated via gen_random_uuid(). This architectural choice prevents ID enumeration attacks and enables distributed ID generation without coordination.</narrative>
  <concepts>
    <concept>how-it-works</concept>
    <concept>why-it-exists</concept>
    <concept>pattern</concept>
  </concepts>
  <files_read>
    <file>db/migrations/001_create_users.sql</file>
    <file>db/migrations/002_create_posts.sql</file>
  </files_read>
  <files_modified>
  </files_modified>
</observation>
```

**3.4 - Store Observation**

- Parse XML into structured data
- Calculate discovery tokens (cost to extract this observation)
- Insert into `observations` table in SQLite
- Generate embedding and sync to Chroma vector DB
- Broadcast SSE event to web UI viewers

**Outputs:**
- Observation ID (database primary key)
- Timestamp (epoch milliseconds)
- All structured fields (type, title, subtitle, facts, narrative, concepts, files)

**State Changes:**
- Database: New row in `observations` table
- Chroma: New vector embedding added
- Memory: Queue depth decrements by 1
- Event: SSE broadcast sent to UI clients

---

### Phase 4: Summary Generation

**Trigger:** Platform signals end of user request

**Inputs:**
- `agent_session_id` - Session identifier
- `platform` - Platform identifier
- `last_user_message` - The user's request text
- `last_assistant_message` - Claude's full response to user

**Flow:**
1. Platform sends `POST /api/sessions/summarize`
2. Server queues summarize message in SessionManager
3. SDK agent receives summary prompt with context
4. Agent generates progress checkpoint summary
5. Parser extracts summary XML
6. Store in `session_summaries` table

**Summary Prompt Context:**

The summary prompt includes:
- The user's original request
- Claude's full response text
- Instructions to write progress notes in 5 sections

**Summary Structure:**
```xml
<summary>
  <request>Add UUID primary keys to database schema</request>
  <investigated>Examined existing schema in db/migrations/</investigated>
  <learned>Current schema uses integer IDs, which are enumerable</learned>
  <completed>Created new migration to convert all tables to UUID primary keys</completed>
  <next_steps>Run migration on staging environment, verify foreign key constraints</next_steps>
  <notes>UUID generation uses PostgreSQL's gen_random_uuid() for efficiency</notes>
</summary>
```

**Outputs:**
- Summary ID (database primary key)
- 6 text fields (request, investigated, learned, completed, next_steps, notes)
- Timestamp and token cost

**State Changes:**
- Database: New row in `session_summaries` table
- Chroma: Summary embedding stored for semantic search

---

### Phase 5: Session Completion

**Trigger:** Platform detects session end

**Flow:**
1. Platform sends `POST /api/sessions/complete`
2. Server marks session as completed in database
3. SessionManager deletes in-memory session
4. Aborts any running SDK agent processes
5. Cleans up event emitters and queues

**State Changes:**
- Database: Session marked completed (timestamp recorded)
- Memory: ActiveSession object removed
- Event system: EventEmitter destroyed

---

## Observation Intake System

### Filtering Logic

**Platform Adapters** decide which tools to skip:

**Currently Filtered (Coding Domain):**
- TodoWrite - Meta-tool for task tracking
- SlashCommand - Meta-command execution
- Skill - Meta-tool for loading skills
- AskUserQuestion - Meta-tool for user interaction
- ListMcpResourcesTool - Meta-tool for MCP inspection

**Why Filter?** These tools don't represent substantive work. They're organizational or meta-level operations that don't produce deliverables.

**Domain Consideration:** Different domains might filter different tools. Email domain might filter different tools than coding domain.

---

### Queue Architecture

**Event-Driven Design:**

1. **No Polling:** SDK agent doesn't check queue repeatedly. It waits on EventEmitter.
2. **Instant Wake-Up:** When observation queued, emitter fires, agent wakes immediately.
3. **Async Iterator:** Agent consumes queue via `for await` loop on message iterator.
4. **Backpressure:** If Claude is slow, queue grows. No data loss - everything waits its turn.

**Queue States:**

- **Empty, No Generator:** Session exists, but no work happening
- **Empty, Generator Running:** Agent waiting for next tool use
- **Items Queued, Generator Running:** Normal processing state
- **Items Queued, No Generator:** Startup needed (auto-starts on next intake)

---

## Observation Extraction Methodology

### The Observer Role

**Critical Principle:** The SDK agent is NOT doing the work. It's OBSERVING work done by the primary agent.

**Prompting Strategy:**

**Init Prompt (First User Request):**
- Establishes observer role
- Provides output format (XML schema)
- Explains type taxonomy (bugfix, feature, refactor, change, discovery, decision)
- Defines concept vocabulary (how-it-works, why-it-exists, what-changed, etc.)
- Sets expectations: record DELIVERABLES, not the observation process

**Continuation Prompt (Subsequent Requests):**
- Reminds agent it's continuing an existing observation session
- Restates output format (shorter version)
- No need to re-explain the role

**Observation Prompt (Each Tool Use):**
- Wraps tool execution in `<observed_from_primary_session>` tags
- Includes spatial context (cwd) for file path resolution
- Provides structured input (parameters) and output (outcome)

**Summary Prompt (Progress Checkpoints):**
- Requests 5-section summary (request, investigated, learned, completed, next_steps)
- Includes Claude's full response for context
- Emphasizes current trajectory, not future planning

---

### Type Taxonomy

**6 Observation Types:**

| Type | When to Use | Example Title |
|------|-------------|---------------|
| **bugfix** | Something was broken, now fixed | "Fixed race condition in user authentication" |
| **feature** | New capability added | "Added email notifications for password resets" |
| **refactor** | Code restructured, behavior unchanged | "Extracted shared logic into BaseController class" |
| **change** | Generic modification (docs, config, misc) | "Updated README with new installation steps" |
| **discovery** | Learning about existing system | "Database uses optimistic locking for concurrency" |
| **decision** | Architectural/design choice with rationale | "Chose PostgreSQL over MongoDB for relational data" |

**Important:** Types are **descriptive categories**, not commands. They describe what happened, not what should happen next.

---

### Concept Vocabulary

**7 Knowledge Categories:**

| Concept | Meaning | Example |
|---------|---------|---------|
| **how-it-works** | Understanding mechanisms | "Authentication uses JWT tokens with refresh rotation" |
| **why-it-exists** | Purpose or rationale | "Rate limiting prevents API abuse" |
| **what-changed** | Modifications made | "Migration added indexes to users table" |
| **problem-solution** | Issues and their fixes | "Deadlock solved by acquiring locks in consistent order" |
| **gotcha** | Traps or edge cases | "NULL values excluded from unique constraint" |
| **pattern** | Reusable approach | "Repository pattern separates data access from business logic" |
| **trade-off** | Pros/cons of a decision | "Denormalization improves read speed but complicates updates" |

**Separation of Concerns:** Types (bugfix, feature, etc.) and concepts (how-it-works, etc.) are **orthogonal dimensions**. A single observation has ONE type but MULTIPLE concepts.

---

### Structured Output Format

**Observation Schema:**

```
type: string (required) - One of 6 types
title: string (nullable) - Short, action-oriented headline
subtitle: string (nullable) - One sentence explanation (max 24 words)
facts: array<string> - Concise, self-contained statements
narrative: string (nullable) - Full context paragraph
concepts: array<string> - 2-5 knowledge categories
files_read: array<string> - File paths that were examined
files_modified: array<string> - File paths that were changed
```

**Design Rationale:**

- **Facts vs Narrative:** Facts are atomic (one idea each), narrative is holistic (full context)
- **Title vs Subtitle:** Title is short/scannable, subtitle adds essential context
- **Files Arrays:** Enable file-based search ("show me all observations about auth.ts")
- **Nullable Fields:** Not every observation has all fields. That's okay - save what we have.

---

## Data Structures: Inputs and Outputs

### Session Inputs

**API Endpoint:** `POST /api/sessions/ensure`

**Request Body:**
```json
{
  "agent_session_id": "abc-123-def",
  "platform": "claude-code",
  "project": "my-app",
  "user_prompt": "Add user authentication",
  "domain": "coding"
}
```

**Field Descriptions:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| agent_session_id | string | Yes | Primary agent's session UUID (from platform) |
| platform | string | Yes | Platform identifier ("claude-code", "cursor", "vscode") |
| project | string | Yes | Project name (directory name or explicit identifier) |
| user_prompt | string | Optional | User's request text (stored for context) |
| domain | string | Optional | Domain type (FUTURE: "coding", "emails", "books") |

**Response:**
```json
{
  "id": 42,
  "prompt_number": 1,
  "created": true
}
```

**Field Descriptions:**

| Field | Type | Description |
|-------|------|-------------|
| id | integer | Internal session ID (database primary key) |
| prompt_number | integer | Current prompt counter (increments per user request) |
| created | boolean | true if new session, false if existing |

---

### Observation Inputs

**API Endpoint:** `POST /api/observations`

**Request Body:**
```json
{
  "agent_session_id": "abc-123-def",
  "platform": "claude-code",
  "tool_name": "Read",
  "tool_input": {
    "file_path": "/Users/me/project/src/auth.ts",
    "limit": 100
  },
  "tool_response": {
    "content": "export function authenticate(...) { ... }"
  },
  "cwd": "/Users/me/project"
}
```

**Field Descriptions:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| agent_session_id | string | Yes | Session identifier |
| platform | string | Yes | Platform identifier |
| tool_name | string | Yes | Tool name (Read, Write, Edit, Bash, etc.) |
| tool_input | object | Yes | Tool parameters as JSON |
| tool_response | object | Yes | Tool output as JSON |
| cwd | string | Optional | Current working directory (spatial context) |

**Response:**
```json
{
  "status": "queued",
  "id": 42,
  "prompt_number": 1
}
```

**Status Values:**
- `"queued"` - Accepted and queued for processing
- `"skipped"` - Filtered out (meta-tool or duplicate)

---

### Observation Outputs

**Database Row (observations table):**

| Field | Type | Description |
|-------|------|-------------|
| id | integer | Primary key |
| sdk_session_id | integer | Foreign key to sessions |
| project | string | Project identifier |
| type | string | Observation type (bugfix, feature, etc.) |
| title | string? | Short headline |
| subtitle | string? | One-sentence explanation |
| facts | JSON array | List of fact strings |
| narrative | string? | Full context paragraph |
| concepts | JSON array | Knowledge categories |
| files_read | JSON array | File paths examined |
| files_modified | JSON array | File paths changed |
| prompt_number | integer | Which user request this belongs to |
| discovery_tokens | integer | Token cost to extract this observation |
| created_at | ISO string | When observation was created |
| created_at_epoch | integer | Timestamp in milliseconds |

**Chroma Vector Embedding:**

Observations are also stored in Chroma for semantic search:
- **ID:** `obs_{id}` (e.g., `obs_142`)
- **Embedding:** Generated from title + subtitle + narrative
- **Metadata:** type, project, prompt_number, concepts, files
- **Purpose:** Enable "find observations similar to this query" searches

---

### Summary Outputs

**Database Row (session_summaries table):**

| Field | Type | Description |
|-------|------|-------------|
| id | integer | Primary key |
| sdk_session_id | integer | Foreign key to sessions |
| project | string | Project identifier |
| request | string? | User's request (title) |
| investigated | string? | What was explored |
| learned | string? | What was discovered |
| completed | string? | What was shipped/changed |
| next_steps | string? | Current trajectory |
| notes | string? | Additional insights |
| prompt_number | integer | Which user request this summarizes |
| discovery_tokens | integer | Token cost to generate summary |
| created_at | ISO string | When summary was created |
| created_at_epoch | integer | Timestamp in milliseconds |

---

### Context Retrieval Outputs

**API Endpoint:** `GET /api/context/:project?limit=50&summary_limit=10`

**Response:**
```json
{
  "project": "my-app",
  "observations": [
    {
      "id": 142,
      "type": "feature",
      "title": "Added JWT authentication",
      "subtitle": "Users can now log in with email/password and receive JWT tokens",
      "narrative": "Implemented JWT-based authentication...",
      "facts": ["...", "..."],
      "concepts": ["how-it-works", "pattern"],
      "files_read": ["src/auth.ts"],
      "files_modified": ["src/auth.ts", "src/routes.ts"],
      "created_at": "2025-11-30T14:32:00Z"
    }
  ],
  "summaries": [
    {
      "id": 15,
      "request": "Add user authentication",
      "investigated": "Examined existing auth in codebase",
      "learned": "No auth currently exists",
      "completed": "Implemented JWT auth with refresh tokens",
      "next_steps": "Add role-based access control",
      "notes": null,
      "created_at": "2025-11-30T14:45:00Z"
    }
  ],
  "tokenStats": {
    "readTokens": 1200,
    "workTokens": 15000,
    "savings": 13800,
    "savingsPercent": 92
  }
}
```

**Token Statistics:**

- **readTokens:** Cost to read these observations now (compressed memory)
- **workTokens:** Original cost to discover/generate these observations
- **savings:** workTokens - readTokens (reuse efficiency)
- **savingsPercent:** (savings / workTokens) × 100

**Purpose:** This context is injected into future Claude sessions to provide continuity and prevent redundant work.

---

## Domain System Architecture

### What Is a Domain?

A **domain** is a vertical category that customizes how observations are extracted and structured based on the TYPE of work being done.

**Examples:**

| Domain | Work Type | Key Concepts | Example Observations |
|--------|-----------|--------------|----------------------|
| **coding** | Software development | functions, classes, bugs, features | "Refactored auth logic into AuthService class" |
| **emails** | Email management | threads, recipients, topics, actions | "Scheduled follow-up with john@acme.com about Q4 budget" |
| **books** | Reading/research | chapters, themes, arguments, quotes | "Author argues markets are inherently unstable (Chapter 3)" |
| **research** | Academic/scientific | hypotheses, methods, findings, sources | "Study found 32% improvement in user retention (p<0.05)" |
| **devops** | Infrastructure/ops | services, deployments, configs, incidents | "Configured auto-scaling for web tier (min=2, max=10)" |

### Why Domains Matter

**Problem:** The current system assumes ALL work is software coding. The prompts, concept vocabulary, and observation structure are optimized for code.

**Limitation Example:**

If you're managing emails, the current system would try to extract:
- `files_read` / `files_modified` - Not relevant for emails
- `concepts` like "pattern" or "refactor" - Code-centric language
- `type` like "bugfix" or "feature" - Doesn't fit email work

**Solution:** Domains customize:

1. **Prompts** - What to look for in tool executions
2. **Concept Vocabulary** - Domain-specific knowledge categories
3. **Observation Schema** - Domain-specific fields
4. **Type Taxonomy** - Domain-appropriate action categories

---

### Domain Architecture Layers

```
┌──────────────────────────────────────────────────────┐
│                  PLATFORM LAYER                       │
│  (How to hook into Claude Code, Cursor, VS Code)     │
│                                                       │
│  PlatformAdapter:                                     │
│  - shouldSkipTool(toolName) → boolean                │
│  - extractProject(context) → string                  │
│  - hookInto(platformAPI) → void                      │
└──────────────────────────────────────────────────────┘
                          │
                          ↓ sends tool executions
┌──────────────────────────────────────────────────────┐
│                   DOMAIN LAYER                        │
│  (What concepts to extract, how to structure them)    │
│                                                       │
│  DomainConfig:                                        │
│  - domain_type: "coding" | "emails" | "books"        │
│  - prompts: { system, user, summary }                │
│  - concept_vocabulary: { types, hints }              │
│  - observation_schema: { fields, types }             │
└──────────────────────────────────────────────────────┘
                          │
                          ↓ extracted observations
┌──────────────────────────────────────────────────────┐
│                  STORAGE LAYER                        │
│  (Database and vector embeddings)                     │
│                                                       │
│  SQLite + Chroma:                                     │
│  - observations table (structured search)            │
│  - Chroma collection (semantic search)               │
└──────────────────────────────────────────────────────┘
```

**Key Insight:** Platforms and Domains are **orthogonal concerns**:

- **Platform** = WHERE the work happens (Claude Code vs Cursor vs VS Code)
- **Domain** = WHAT KIND of work it is (coding vs emails vs books)

You can have:
- Claude Code + Coding Domain
- Claude Code + Email Domain (e.g., processing email via Claude Code)
- Cursor + Coding Domain
- Custom Platform + Books Domain

---

## Platform vs Domain Separation

### Platform Adapter Responsibility

**Scope:** Integration with specific AI agent platforms

**Responsibilities:**

1. **Hook into platform events** - Intercept tool executions, session starts/ends
2. **Filter meta-tools** - Decide which tools represent substantive work
3. **Extract project identifier** - Determine project from platform context
4. **Send data to server** - Make HTTP calls to RAD server API

**Does NOT decide:**
- What concepts to extract (that's domain-specific)
- How to structure observations (that's domain-specific)
- What prompts to use (that's domain-specific)

**Example: ClaudeCodeAdapter**

```
shouldSkipTool(tool):
  return tool in [TodoWrite, SlashCommand, Skill, AskUserQuestion]

extractProject(context):
  return path.basename(context.cwd)

hookInto(claudeCodeAPI):
  claudeCodeAPI.on('tool-use', (tool, input, output, context) => {
    if shouldSkipTool(tool): return

    client.track(tool, input, output, context.cwd)
  })
```

**Platform-Specific Examples:**

| Platform | Tool Filtering | Project Extraction | Hook Integration |
|----------|----------------|-------------------|------------------|
| Claude Code | Skip TodoWrite, SlashCommand | Directory name from cwd | Hook into tool-use events |
| Cursor | Skip ApplyDiff, InternalStateUpdate | Workspace name from API | Hook into onAIAction |
| VS Code | Skip QuickPick, ShowMessage | Workspace folder name | Hook into language server events |

---

### Domain Config Responsibility

**Scope:** Customization of observation extraction for specific work types

**Responsibilities:**

1. **Define prompts** - System prompts, observation prompts, summary prompts
2. **Define concept vocabulary** - Domain-specific knowledge categories
3. **Define observation schema** - Which fields are relevant for this domain
4. **Define type taxonomy** - Domain-appropriate action categories (optional)

**Does NOT decide:**
- Which platform is being used (that's platform-specific)
- How to intercept tool executions (that's platform-specific)

**Example: Coding Domain Config**

```
domain_type: "coding"

prompts:
  observation_system_prompt: "You are observing a software development session..."
  observation_user_prompt: "Analyze this tool execution for code changes..."
  summary_system_prompt: "Summarize coding progress..."

concept_vocabulary:
  types: [how-it-works, why-it-exists, what-changed, problem-solution,
          gotcha, pattern, trade-off]
  extraction_hints: "Focus on code structure, dependencies, architecture"

observation_schema:
  fields:
    files_read: array<string> - File paths examined
    files_modified: array<string> - File paths changed
    functions_touched: array<string> - Function signatures changed
    classes_touched: array<string> - Classes modified
```

**Example: Email Domain Config**

```
domain_type: "emails"

prompts:
  observation_system_prompt: "You are observing email management work..."
  observation_user_prompt: "Analyze this tool execution for email patterns..."
  summary_system_prompt: "Summarize email session..."

concept_vocabulary:
  types: [thread-context, communication-pattern, action-item,
          decision-made, follow-up-needed, key-person]
  extraction_hints: "Focus on communication flow, key people, decisions"

observation_schema:
  fields:
    thread_ids: array<string> - Email thread identifiers
    recipients: array<string> - People involved
    topics: array<string> - Discussion topics
    action_items: array<string> - Tasks identified
    attachments: array<string> - File attachments mentioned
```

---

## Domain Customization Points

### 1. Prompt Customization

**What Changes:** The prompts sent to Claude for observation extraction

**Coding Domain Prompt:**
```
You are observing a software development session.

Focus on deliverables and capabilities:
- What the system NOW DOES differently (new capabilities)
- What shipped to users/production (features, fixes, configs)
- Changes in technical domains (auth, data, UI, infra)

Use verbs like: implemented, fixed, deployed, configured, migrated

Example: "Authentication now supports OAuth2 with PKCE flow"
```

**Email Domain Prompt:**
```
You are observing an email management session.

Focus on communication patterns and decisions:
- Who is involved in discussions (key people, recipients)
- What topics are being discussed (threads, subjects)
- What decisions were made (agreements, action items)
- What follow-ups are needed (pending tasks)

Use verbs like: scheduled, decided, agreed, followed-up, delegated

Example: "Scheduled Q4 budget review with john@acme.com for Dec 15th"
```

**Books Domain Prompt:**
```
You are observing a reading/research session.

Focus on ideas and connections:
- What arguments or themes are presented (key concepts)
- What evidence supports claims (quotes, references)
- What connections exist between ideas (relationships)
- What questions or critiques emerge (analysis)

Use verbs like: argues, demonstrates, connects, questions, analyzes

Example: "Author argues markets are inherently unstable (Chapter 3, p.42)"
```

---

### 2. Concept Vocabulary Customization

**What Changes:** The knowledge categories used to tag observations

**Coding Domain Concepts:**
| Concept | Meaning |
|---------|---------|
| how-it-works | Understanding mechanisms (authentication flow, data pipeline) |
| why-it-exists | Purpose or rationale (why this pattern, why this choice) |
| what-changed | Modifications made (files changed, APIs updated) |
| problem-solution | Issues and their fixes (bug identified, solution implemented) |
| gotcha | Traps or edge cases (NULL handling, race conditions) |
| pattern | Reusable approach (repository pattern, factory pattern) |
| trade-off | Pros/cons of a decision (speed vs memory, sync vs async) |

**Email Domain Concepts:**
| Concept | Meaning |
|---------|---------|
| thread-context | Background of email conversation (original request, history) |
| communication-pattern | How people interact (escalation path, delegation) |
| action-item | Tasks identified (who should do what by when) |
| decision-made | Agreements reached (approvals, commitments) |
| follow-up-needed | Pending actions (waiting on response, scheduled check-in) |
| key-person | Important stakeholder (decision maker, domain expert) |
| topic | Discussion subject (budget, hiring, strategy) |

**Books Domain Concepts:**
| Concept | Meaning |
|---------|---------|
| argument | Author's claim or thesis (central argument, sub-claims) |
| evidence | Supporting data (quotes, studies, examples) |
| theme | Recurring idea (power dynamics, human nature) |
| connection | Relationship between ideas (builds on, contradicts, extends) |
| question | Critique or uncertainty (unanswered question, objection) |
| source | Referenced work (cited author, external study) |
| method | Research approach (qualitative, quantitative, case study) |

---

### 3. Observation Schema Customization

**What Changes:** The fields stored in observations

**Coding Domain Schema:**
```
Standard fields (all domains):
- id, type, title, subtitle, narrative, concepts
- created_at, discovery_tokens

Coding-specific fields:
- files_read: array<string>
- files_modified: array<string>
- functions_touched: array<string> (optional)
- classes_touched: array<string> (optional)
- modules_affected: array<string> (optional)
```

**Email Domain Schema:**
```
Standard fields (all domains):
- id, type, title, subtitle, narrative, concepts
- created_at, discovery_tokens

Email-specific fields:
- thread_ids: array<string>
- recipients: array<string>
- senders: array<string>
- topics: array<string>
- action_items: array<string>
- attachments: array<string>
- scheduled_date: ISO string (optional)
```

**Books Domain Schema:**
```
Standard fields (all domains):
- id, type, title, subtitle, narrative, concepts
- created_at, discovery_tokens

Books-specific fields:
- book_title: string
- chapter: string
- page_numbers: array<integer>
- quotes: array<string>
- authors_cited: array<string>
- themes: array<string>
- related_books: array<string>
```

**Implementation Note:** Domain-specific fields can be stored as JSON in a flexible `metadata` column, or separate tables can be created per domain.

---

### 4. Type Taxonomy Customization (Optional)

**What Changes:** The observation types used to categorize work

**Coding Domain Types (Current):**
- bugfix, feature, refactor, change, discovery, decision

**Email Domain Types (Proposed):**
- sent, received, scheduled, decided, delegated, archived

**Books Domain Types (Proposed):**
- argument, critique, connection, quote, summary, question

**Decision:** Whether to use domain-specific types or keep universal types is an open question. Universal types (discovery, decision, change) may be sufficient across domains, with concepts providing domain-specific nuance.

---

### 5. Summary Prompt Customization

**What Changes:** How progress summaries are generated

**Coding Domain Summary:**
```
Sections:
- request: What feature/fix was requested
- investigated: What code/systems were examined
- learned: Technical insights gained
- completed: Code shipped, features deployed
- next_steps: Current development trajectory
- notes: Architecture notes, gotchas, trade-offs
```

**Email Domain Summary:**
```
Sections:
- request: What communication goal was pursued
- investigated: Which threads/conversations were examined
- learned: Key decisions, stakeholder positions
- completed: Emails sent, meetings scheduled, decisions made
- next_steps: Pending responses, upcoming meetings
- notes: Key people, sensitive topics, deadlines
```

**Books Domain Summary:**
```
Sections:
- request: What research question was explored
- investigated: Which chapters/sources were examined
- learned: Key arguments, evidence, connections
- completed: Notes taken, quotes captured, connections made
- next_steps: Chapters to read, questions to explore
- notes: Themes emerging, critiques forming, related works
```

---

## Domain Configuration Storage

### Per-Project Domain Assignment

**Database Schema:**

```sql
-- Add domain column to sessions
ALTER TABLE sdk_sessions ADD COLUMN domain TEXT DEFAULT 'coding';

-- Store custom domain configs
CREATE TABLE domain_configs (
  id INTEGER PRIMARY KEY,
  project TEXT NOT NULL,
  domain_type TEXT NOT NULL,
  config_json TEXT NOT NULL,  -- Serialized DomainConfig
  created_at TEXT NOT NULL,
  UNIQUE(project)
);
```

**Project-Domain Mapping:**

| Project | Domain | Rationale |
|---------|--------|-----------|
| my-web-app | coding | Software development project |
| email-inbox | emails | Email management workflow |
| research-notes | books | Reading and research tracking |
| infra-ops | devops | Infrastructure and operations |

**Configuration Precedence:**

1. **Custom config** - If project has custom domain config in database, use it
2. **Preset config** - If domain type matches a built-in preset, use preset
3. **Default config** - Fall back to "coding" domain

---

### Built-in Domain Presets

**Presets Provided:**

- `coding` - Software development (default)
- `emails` - Email management
- `books` - Reading and research
- `research` - Academic/scientific work
- `devops` - Infrastructure and operations

**Custom Domains:**

Projects can create fully custom domain configs with:
- Custom prompts
- Custom concept vocabularies
- Custom observation schemas
- Custom type taxonomies

---

## Integration Flow: Platform + Domain

### Complete Observation Flow

**Step 1: Platform Intercepts Tool Use**

```
Claude Code detects:
  Tool: Read
  Input: { file_path: "emails/inbox.json" }
  Output: { content: "..." }
  Context: { cwd: "/Users/me/email-client", project: "email-inbox" }
```

**Step 2: Platform Adapter Filters and Sends**

```
ClaudeCodeAdapter:
  shouldSkipTool("Read") → false (substantive work)
  extractProject(context) → "email-inbox"

  POST /api/observations
  {
    agent_session_id: "abc-123",
    platform: "claude-code",
    tool_name: "Read",
    tool_input: { file_path: "emails/inbox.json" },
    tool_response: { content: "..." },
    cwd: "/Users/me/email-client"
  }
```

**Step 3: Server Resolves Domain**

```
RADServer.trackObservation():
  Resolve session from agent_session_id
  Load domain config for project "email-inbox"

  Domain config found: "emails"
  Load email domain preset:
    - Email-specific prompts
    - Email concept vocabulary (thread-context, action-item, etc.)
    - Email observation schema (recipients, topics, action_items)
```

**Step 4: SDK Agent Uses Domain Prompts**

```
SDKAgent.extractObservation():
  Use email domain system prompt:
    "You are observing email management work..."

  Build observation prompt:
    <observed_from_primary_session>
      <what_happened>Read</what_happened>
      <parameters>{ file_path: "emails/inbox.json" }</parameters>
      <outcome>{ content: "..." }</outcome>
    </observed_from_primary_session>

  Expected output:
    <observation>
      <type>received</type>
      <title>Email from john@acme.com about Q4 budget</title>
      <recipients>john@acme.com, finance@acme.com</recipients>
      <topics>budget, Q4, approval</topics>
      <action_items>Review budget proposal by Dec 1st</action_items>
    </observation>
```

**Step 5: Storage with Domain Schema**

```
Database observation:
  type: "received"
  title: "Email from john@acme.com about Q4 budget"
  subtitle: "Request for budget approval by Dec 1st"
  narrative: "John requested review of Q4 budget proposal..."
  concepts: ["action-item", "decision-needed"]
  metadata: {
    recipients: ["john@acme.com", "finance@acme.com"],
    topics: ["budget", "Q4", "approval"],
    action_items: ["Review budget proposal by Dec 1st"]
  }
```

---

## Summary

### Current System (Coding-Only)

**Strengths:**
- Well-defined observation structure
- Event-driven architecture (zero latency)
- Dual storage (SQLite + Chroma)
- Token-efficient context retrieval

**Limitations:**
- Hardcoded for software development
- Prompts assume code-centric work
- Concept vocabulary is coding-specific
- Schema includes files_read/files_modified (not universal)

---

### Future System (Multi-Domain)

**Additions:**

1. **Domain Layer** - Between platform and storage
2. **Domain Configs** - Per-project customization
3. **Domain Presets** - Built-in configs for common verticals
4. **Flexible Schemas** - Domain-specific metadata fields

**Preserved:**

1. **Platform Adapters** - Still handle tool interception
2. **Event-Driven Queues** - Still zero-latency
3. **Observation Protocol** - Still XML-based extraction
4. **Dual Storage** - Still SQLite + Chroma

**Key Principle:**

> Platforms determine HOW to capture tool executions.
> Domains determine WHAT to extract and HOW to structure it.

This separation enables:
- **Any platform** (Claude Code, Cursor, VS Code) + **Any domain** (coding, emails, books)
- **Mix and match** without cross-contamination
- **Custom domains** for specialized workflows

---

**End of Document**
