# Endless Mode Analysis Plan

## Goal

Create accurate power consumption data for Endless Mode by analyzing real transcripts with actual observation sizes from the database.

## What's Wrong With Current Post

The `post-about-endless.md` has these issues:

1. **Aggregate data misrepresented as per-session** - 3,185 tool outputs are cross-session, can't apply per-session formulas
2. **Wrong formula** - `N×(N-1)/2` assumes 1 API call per tool, reality is different
3. **Compression ≠ Power savings** - 78% compression doesn't mean 78% power saved

## What We Need To Show

For transcripts with **good observation coverage (60%+)**:

| Metric | Control | Compressed |
|:--|:--|:--|
| Tokens in | X | Y |
| Tokens out | X | Y |
| Power in | X | Y |
| Power out | X | Y |

Rolling through the transcript turn-by-turn to show actual flow.

## Work Done

1. Created `scripts/analyze-power-per-transcript.js` - finds transcripts with observation matches, calculates power
2. Ran analysis on 37 transcripts - showed 31.5% power saved with 36% observation coverage
3. Found per-transcript variance: 3.7% to 83.8% saved

## Next Steps

### Step 1: Find High-Coverage Transcripts

Filter to transcripts with **60%+ observation match rate**. These give accurate picture of what Endless Mode can do with good coverage.

```javascript
// Find transcripts where most tool results have observations
// Require: matchRate >= 0.6 AND totalTools >= 10
```

### Step 2: Build Rolling Analysis

For each high-coverage transcript, parse turn-by-turn:

```
Turn 1: User prompt
Turn 2: Assistant response (API call 1)
Turn 3: Tool result (5KB) → Add to context
Turn 4: Assistant response (API call 2) → Context now includes Turn 3
Turn 5: Tool result (10KB) → Add to context
Turn 6: Assistant response (API call 3) → Context includes Turn 3 + Turn 5
...
```

Track at each API call:
- **Control tokens**: cumulative original tool output bytes
- **Compressed tokens**: cumulative observation bytes (from database)
- **Control power**: sum of (each tool's bytes × its remaining API calls)
- **Compressed power**: sum of (each observation's bytes × its remaining API calls)

### Step 3: Output Format

Per transcript:

```
Transcript: ee5e99bd-96dc-410e-9762-8dec22dde2e8
Match rate: 87% (37/42 tool results have observations)

| Turn | Event | Ctrl Tokens | Comp Tokens | Ctrl Power | Comp Power |
|------|-------|-------------|-------------|------------|------------|
| 3    | Read  | 15,234      | 412         | 152,340    | 4,120      |
| 6    | Bash  | 23,891      | 856         | 191,128    | 6,848      |
| ...  | ...   | ...         | ...         | ...        | ...        |

Final:
- Control tokens: 242,156
- Compressed tokens: 31,847
- Token reduction: 86.8%
- Control power: 4,821,543
- Compressed power: 612,847
- Power reduction: 87.3%
```

### Step 4: Aggregate Across High-Coverage Transcripts

Show summary table:

```
| Transcript | Match% | Token Reduction | Power Reduction |
|------------|--------|-----------------|-----------------|
| ee5e99bd   | 87%    | 86.8%           | 87.3%           |
| 11f990e6   | 71%    | 82.1%           | 80.7%           |
| ...        | ...    | ...             | ...             |
```

## Key Insight

The analysis must use **actual observation sizes from database**, not assumed compression rates. Each tool_use_id in the transcript maps to an observation with a specific `facts` field length.

## Files

- **Script**: `scripts/analyze-power-per-transcript.js`
- **Database**: `~/.claude-mem/claude-mem.db` (observations table with tool_use_id, facts)
- **Transcripts**: `~/.claude/projects/-Users-alexnewman-Scripts-claude-mem/*.jsonl`
- **Output**: Update `docs/context/endless-mode-real-story.md` with accurate data

## Definition of Done

1. Find 5-10 transcripts with 60%+ observation coverage
2. For each, show rolling token/power analysis
3. Calculate accurate reduction percentages
4. Update the real story doc with correct numbers
5. The numbers we publish are backed by reproducible script output
