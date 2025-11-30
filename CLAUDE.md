/* To @claude: Check TEMPORARY NOTES section below. Remove any notes past their expiration date. Today's date is in your <env> context. */

# rad-mem: RAD Protocol Server

## What This Project Is

rad-mem is a **RAD Protocol server** - a platform-agnostic memory system for AI agents. Any platform (Claude Code, Cursor, VS Code, custom) can be a thin HTTP adapter that sends data to this server.

**Current Version**: 6.3.2

## Architecture

**RAD Server** (`src/services/worker-service.ts`) - Express API on port 38888, PM2-managed

**Database** (`src/services/sqlite/`) - SQLite3 at `~/.rad-mem/rad-mem.db` with FTS5 full-text search

**Chroma** (`src/services/sync/ChromaSync.ts`) - Vector embeddings at `~/.rad-mem/vector-db` for semantic search

**Viewer UI** (`src/ui/viewer/`) - React interface at http://localhost:38888

## Build Commands

```bash
npm run build           # Compile TypeScript
npm run worker:restart  # Restart PM2 worker (rad-mem-worker)
npm run worker:logs     # View worker logs
```

## Environment Variables

- `RAD_MEM_PORT` - Server port (default: 38888)
- `CLAUDE_MEM_MODEL` - Model for observations/summaries (default: claude-haiku-4-5)

## RAD Protocol Endpoints

### Session Management
- `POST /api/sessions/ensure` - Idempotent session creation
  - Input: `{ agent_session_id, platform, project, user_prompt? }`
  - Output: `{ id, prompt_number, created }`

### Context Retrieval
- `GET /api/context/:project` - Historical context for injection
  - Query: `?limit=50&summary_limit=10`
  - Output: `{ project, observations[], summaries[], tokenStats }`

### Observation Intake
- `POST /api/observations` - Accept observations from any platform
  - Input: `{ agent_session_id, platform, tool_name, tool_input, tool_response, cwd }`
  - Output: `{ status: 'queued'|'skipped', id?, prompt_number?, reason? }`
  - Filters: TodoWrite, SlashCommand, Skill, AskUserQuestion, ListMcpResourcesTool

### Session Lifecycle
- `POST /api/sessions/summarize` - Queue summary generation
  - Input: `{ agent_session_id, platform, last_user_message?, last_assistant_message? }`
  - Output: `{ status: 'queued', id }`
- `POST /api/sessions/complete` - Mark session complete
  - Input: `{ agent_session_id, platform, reason? }`
  - Output: `{ success: true, id }`

## Glossary

| Term | Definition |
|------|------------|
| `agent_session_id` | The AI agent's session UUID (from external platforms) |
| `platform` | Which platform sent data ("claude-code", "cursor", "vscode") |
| `id` | RAD's internal session ID |
| `observation` | Captured insight from tool use |

## Quick Reference

```bash
npm run build && npm run worker:restart  # Build and restart
pm2 list                                  # Check worker status
pm2 logs rad-mem-worker                   # View logs
curl http://localhost:38888/health        # Health check
```

**Viewer UI**: http://localhost:38888

---

## Temporary Notes

<!-- Remove notes when past expiration date -->
