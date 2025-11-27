# Endless Mode: The Real Story

## The Vision

**Persistent agentic memory that runs on any model.**

Every Claude Code user knows the frustration: hit 67% context, forced to restart. "Let me explain again what we're building..." Previous decisions forgotten. Mistakes repeated. It's like training a goldfish.

What if Claude remembered?

- Start a session and it already knows your project
- "Last time we fixed the auth bug, today we should test edge cases"
- Decisions persist, patterns emerge, the agent learns YOUR codebase
- Not just today's work, but weeks of accumulated understanding

This is **agentic continuity** - the agent maintains coherent identity and work across sessions. It knows:

| Dimension | What the Agent Knows |
|:--|:--|
| **Before** | What happened in previous sessions |
| **Current** | Present context and recent work |
| **Next** | What comes next, pending work, plans |

## The Problem: Memory Costs Tokens

Storing full context history is expensive:

- Full tool outputs add up fast (50KB file reads, 30KB API responses)
- Only works on models with 200k+ context windows
- Exclusive to expensive deployments
- Most users priced out

Without compression, persistent memory is a luxury feature.

## The Solution: Compress the Observations

Endless Mode replaces tool outputs with compressed observations. Instead of keeping the full 500-line file in context:

> "Read worker-service.ts - Express server with 15 route handlers, uses DatabaseManager and SSEBroadcaster composition pattern"

**The result**: Memory fits on any model. Same understanding, fraction of the tokens.

## The Math

### How Context Works

Every tool output stays in context for all subsequent API calls:

```
Power = Σ(tool_output_bytes × subsequent_api_calls)
```

A 64KB file read early in a session with 86 subsequent API calls consumes **5.4 MB** of compute.

### What We Measured

Analyzed **11 high-coverage transcripts** (60%+ observation match rate):

| Transcript | Coverage | Token Reduction | Power Reduction |
|:--|--:|--:|--:|
| a712307c | 95% | 75.1% | 73.5% |
| 268ed9e1 | 74% | 80.4% | **78.0%** |
| 96890334 | 74% | 58.1% | 62.9% |
| f89f0ec0 | 79% | 58.4% | 62.6% |
| ee5e99bd | 63% | 54.2% | 57.3% |

**Totals (high-coverage only):**
- Control tokens: 722 KB → Compressed: 281 KB
- **Token reduction: 60.2%**
- Control power: 34.6 MB → Compressed: 15.1 MB
- **Power reduction: 56.5%**

### What This Enables

| Without Compression | With Compression |
|:--|:--|
| Need 200k+ context for useful history | Works on 32k, 64k, any model |
| Expensive, exclusive | Accessible, affordable |
| Memory as luxury feature | Memory as standard capability |

## The Stacked Benefits

Compression enables persistent memory. Persistent memory delivers:

### 1. Continuity
Agent remembers across sessions. No more "start from scratch."

### 2. Accessibility
Works on any model, not just expensive large-context ones.

### 3. Security
Pattern detection across sessions. The agent can recognize: "I've done 7 security assessments across 7 organizations in 5 days - this is inconsistent with legitimate work." (See: [Cross-Session Memory as Defense](./cross-section-memory-defense.md))

### 4. Economics
Lower compute costs as bonus. 56.5% power reduction means lower infrastructure costs.

## The Journey: 5 Hypotheses

### Hypothesis 1: "Add compression as optional feature"
**Nov 16** - Started building Endless Mode as opt-in to avoid breaking existing functionality.

### Hypothesis 2: "Async compression will just work"
**Nov 19-20** - Hit first bug: duplicate observations on 2nd prompt. Async changes had ripple effects. Reverted.

### Hypothesis 3: "Synchronous blocking ensures consistency"
**Nov 21** - Switched from deferred (async, 5s timeout) to synchronous (blocking, 90s timeout). Worked for 25 sessions.

### Hypothesis 4: "Cycle-based replacement will be more efficient"
**Nov 23** - Redesigned to cycle-based observation replacement. Combined with 90s blocking, system started hanging. **Disabled Endless Mode.**

### Hypothesis 5: "Isolate on beta branch"
**Nov 25** - Created `beta/7.0` branch. Git-based feature toggle. Users opt-in by switching branches. Data stays in `~/.claude-mem/`, separate from code.

## Current Status

The problem wasn't the compression algorithm - it was the delivery mechanism. Synchronous blocking + complex replacement = hanging.

**What works:**
- Observation capture and compression
- Context injection at session start (50 observations, ~15-20k tokens)
- Search across historical observations
- 60% token reduction, 56% power reduction measured

**What's isolated on beta:**
- Real-time transcript replacement
- The "endless" part of Endless Mode

## How to Try It

1. Open http://localhost:37777
2. Find "Version Channel" in Settings
3. Click "Try Beta (Endless Mode)"
4. Your data is safe - it lives in `~/.claude-mem/`, separate from plugin code

---

## Methodology

**High-coverage analysis script**: `scripts/analyze-high-coverage.js`

1. Finds transcripts with 60%+ observation match rate (filters for quality data)
2. Parses each transcript chronologically with rolling token/power calculation
3. For each tool_result: counts subsequent API calls
4. Calculates control power (original bytes × calls) and compressed power (observation bytes × calls)
5. Shows turn-by-turn accumulation tables
6. Reports per-transcript and aggregate stats

**Data sources**:
- Transcript files: `~/.claude/projects/-Users-alexnewman-Scripts-claude-mem/*.jsonl`
- Observation sizes: `~/.claude-mem/claude-mem.db` (facts field length)
- Filtering: 60%+ observation match rate, 10+ tool results, skip contaminated transcripts

**Run it yourself**: `node scripts/analyze-high-coverage.js`
