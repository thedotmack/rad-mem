# Endless Mode: Persistent Agentic Memory That Runs on Any Model

## The Problem

Every Claude Code user knows this pain: hit 67% context, forced to restart. "Let me explain again what we're building..." Previous decisions forgotten. Mistakes repeated.

It's like training a goldfish.

## The Vision

What if Claude **remembered**?

- Start a session and it already knows your project
- "Last time we fixed the auth bug, today we should test edge cases"
- Decisions persist, patterns emerge
- Not just today's work, but weeks of accumulated understanding

This is **agentic continuity** - the agent maintains coherent identity across sessions. It knows:

| Before | Current | Next |
|:--|:--|:--|
| What happened in previous sessions | Present context and recent work | What comes next, pending tasks |

## The Obstacle: Memory Costs Tokens

Storing full context history is expensive:

- 50KB file reads, 30KB API responses add up fast
- Only works on models with 200k+ context windows
- Exclusive to expensive deployments
- Most users priced out

Without compression, persistent memory is a luxury feature for large-context models only.

## The Solution: Compress the Observations

Endless Mode replaces tool outputs with compressed observations. Instead of keeping the full 500-line file:

> "Read worker-service.ts - Express server with 15 route handlers, uses DatabaseManager and SSEBroadcaster composition pattern"

**The result**: Memory fits on any model. Same understanding, fraction of the tokens.

---

## The Numbers (Real Data)

We analyzed **11 transcripts with 60%+ observation coverage**:

| Transcript | Coverage | Token Reduction | Power Reduction |
|:--|--:|--:|--:|
| a712307c | 95% | 75.1% | 73.5% |
| 268ed9e1 | 74% | 80.4% | **78.0%** |
| 96890334 | 74% | 58.1% | 62.9% |

**Totals:**

| Metric | Value |
|:--|:--|
| Control tokens | 722 KB |
| Compressed tokens | 281 KB |
| **Token reduction** | **60.2%** |
| Control power | 34.6 MB |
| Compressed power | 15.1 MB |
| **Power reduction** | **56.5%** |

### What This Means

| Without Compression | With Compression |
|:--|:--|
| Need 200k+ context for useful history | Works on 32k, 64k, any model |
| Memory as luxury feature | Memory as standard capability |
| Expensive, exclusive | Accessible, affordable |

---

## The Stacked Benefits

Compression enables persistent memory. Persistent memory delivers:

**1. Continuity** - Agent remembers across sessions. No more "start from scratch."

**2. Accessibility** - Works on any model, not just expensive large-context ones.

**3. Security** - Pattern detection across sessions. The agent can recognize manipulation patterns spanning multiple sessions. (See our [security whitepaper](./cross-section-memory-defense.md) on how persistent memory prevents AI-orchestrated attacks.)

**4. Economics** - 56.5% power reduction means lower infrastructure costs.

---

## The Journey: 5 Hypotheses, 10 Days

*These decisions are queryable via our API:* `curl "localhost:37777/api/decisions?query=endless+mode"`

### Hypothesis 1: "Add compression as optional feature"
**Nov 16** - Started building Endless Mode as opt-in.

### Hypothesis 2: "Async compression will just work"
**Nov 19-20** - Hit bugs immediately. Duplicate observations on 2nd prompt. Reverted.

### Hypothesis 3: "Synchronous blocking ensures consistency"
**Nov 21** - Switched to 90-second blocking. Worked for 25 sessions.

### Hypothesis 4: "Cycle-based replacement will be more efficient"
**Nov 23** - System started hanging. **Disabled Endless Mode.**

### Hypothesis 5: "Isolate on beta branch"
**Nov 25** - Git-based feature toggle. Users opt-in by switching branches.

---

## Current Status

The problem wasn't the compression algorithm - it was the delivery mechanism.

**What works now:**
- Observation capture and compression (60% token reduction)
- Context injection at session start (50 observations, ~15-20k tokens)
- Search across historical observations
- Before/Current/Next awareness

**What's on beta branch:**
- Real-time transcript replacement
- The "endless" part of Endless Mode

---

## How to Try It

**v6.3.2** added a Version Channel switcher:

1. Open http://localhost:37777
2. Find **"Version Channel"** in Settings sidebar
3. Click **"Try Beta (Endless Mode)"**
4. Refresh the UI after switching

**Safe to try**: Your memory data lives in `~/.claude-mem/` - completely separate from the plugin code. Switching branches won't touch your data.

---

## The Bigger Picture

This is the foundation for **agents that remember**.

The same capability that makes AI agents more useful - persistent memory and context awareness - is also what makes them more secure and more affordable. Security + accessibility + economics converge.

Endless Mode is how we make persistent agentic memory run on any model, not just expensive large-context ones.

---

**Meta**: This post was written using claude-mem's own memory. Key decisions queryable via:

```
curl "localhost:37777/api/decisions?query=endless+mode"
```

*claude-mem eating its own dog food.*
