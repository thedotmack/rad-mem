# Endless Mode Decision Reference

This document provides detailed citations for the decisions mentioned in the Endless Mode post. Each phase represents a hypothesis we tested, what we learned, and how that informed the next hypothesis.

All decisions are queryable via the API:

```bash
curl "localhost:38888/api/decisions?query=endless+mode"
```

---

## Hypothesis 1: Optional Feature (Nov 16)

### #9965 - Endless Mode Feature as Optional Architectural Addition
**Date**: Nov 16, 2025
**Type**: Decision
**Summary**: The foundational decision to build Endless Mode as an *optional* feature to avoid mandatory architectural refactoring. Let users opt-in to experimental compression without breaking anything for those who don't.

**Key Facts**:
- Endless mode was consciously designed as optional to mitigate major architectural impact
- Approach allows feature to coexist with existing architecture without forcing systemic changes
- Provides flexibility for gradual adoption

---

## Hypothesis 2: Async Compression (Nov 19-20)

**Hypothesis**: Async compression will just work alongside existing code.
**What we learned**: Changes have ripple effects - touched core observation lifecycle, caused regressions.

### #12352 - Reverted Save Hook Changes to Restore Endless Mode Functionality
**Date**: Nov 19, 2025
**Type**: Decision
**Summary**: First revert - something in the save hook changes broke endless mode. Had to roll back to restore functionality.

### #12362 - Comprehensive Launch Strategy for Endless Mode and Context Management
**Date**: Nov 19, 2025
**Type**: Decision
**Summary**: Strategic planning for how to safely launch endless mode alongside existing context management.

### #12630 - Request to develop solution hypotheses for duplicate observation problem
**Date**: Nov 20, 2025
**Type**: Decision
**Summary**: The duplicate observations bug surfaced - classic regression where endless mode changes broke something that was already working.

### #12833 - Duplicate Observations Regression
**Date**: Nov 21, 2025
**Type**: Discovery
**Summary**: Bug manifesting specifically on the 2nd prompt in a session, creating duplicate observations. The bug had been previously fixed but regressed with endless mode implementation changes.

---

## Hypothesis 3: Synchronous Blocking (Nov 21)

**Hypothesis**: Synchronous blocking will ensure data consistency - wait for compression before continuing.
**What we learned**: Synchronous works... until the timeout is too aggressive. 90 seconds caused hangs.

### #13003 - ENDLESS mode planned as experimental feature in main release
**Date**: Nov 21, 2025
**Type**: Decision
**Summary**: Decision to include endless mode in main release as an experimental, opt-in feature.

### #13007 - Save Hook Architectural Change: Deferred to Synchronous
**Date**: Nov 21, 2025
**Type**: Change
**Summary**: **THE CRITICAL CHANGE** - Switched from deferred (async, 5-second timeout) to synchronous (blocking, 90-second timeout) transformation. This change would later cause the hanging issues.

**Key Facts**:
- ENDLESS mode uses 90-second timeout while regular mode uses 5-second timeout
- The runDeferredTransformation function call was removed
- Regular mode continues async processing with queued observations for background processing

### #13015 - Planning ENDLESS mode experimental release with dependency documentation
**Date**: Nov 21, 2025
**Type**: Decision
**Summary**: Decision to document all dependencies before merging to main - identifying all code paths that depend on ENDLESS mode being enabled or disabled.

### #13021 - Planning ENDLESS Mode Experimental Release
**Date**: Nov 21, 2025
**Type**: Decision
**Summary**: Cautious approach - comprehensive dependency documentation required before adding to main release flow. Primary concern: ensuring regular app functionality remains unaffected.

### #13115 - Pre-release validation needed for endless mode on main branch
**Date**: Nov 21, 2025
**Type**: Decision
**Summary**: Explicit decision that validation was required before release.

### #13122 - Verify Default Behavior Changes with Main Branch Diffs
**Date**: Nov 21, 2025
**Type**: Decision
**Summary**: Systematic verification of what changed between working and current state.

---

## Hypothesis 4: Cycle-Based Replacement (Nov 23)

**Hypothesis**: Cycle-based observation replacement with rolling timeline will be more efficient than per-tool replacement.
**What we learned**: Added complexity without solving the core timing problem. Combined with 90s blocking = system hangs.

### #14353 - Comprehensive Plan for Three Rad-Mem Issues
**Date**: Nov 23, 2025
**Type**: Decision
**Summary**: Addressed three issues simultaneously: Context Regression, Structured Outputs, and Rolling Replacement. This was the "experiment" phase.

### #14480 - Redesigning transcript transformation from per-tool to cycle-based
**Date**: Nov 23, 2025
**Type**: Decision
**Summary**: Major architectural shift - instead of replacing individual tool outputs, tried to do cycle-based observation replacement. This was part of the experiment that caused problems.

### #14483 - Rolling timeline replacement strategy for Endless Mode
**Date**: Nov 23, 2025
**Type**: Decision
**Summary**: The rolling timeline strategy for transcript compression. Part of the experimental approach that led to issues.

---

## The Setback (Nov 23)

**What happened**: Hypotheses 3 + 4 combined to cause system-wide hangs. Had to disable and prioritize stability.

### #14657 - Disabled endless mode due to hanging issues
**Date**: Nov 23, 2025
**Type**: Decision
**Summary**: **THE ROLLBACK** - Endless mode was causing everything to hang. The 90-second synchronous blocking was too aggressive. When compression took too long, the whole system locked up. Had to prioritize stability.

**Key Facts**:
- Endless mode was causing the entire system to hang and become unresponsive
- Decision prioritized system stability over endless mode functionality
- Root cause was not fully diagnosed at the time
- 25 sessions had successfully used it before this point

### #14658 - Disabled endless mode due to hanging issues (duplicate)
**Date**: Nov 23, 2025
**Type**: Decision
**Summary**: Same event, captured from different perspective. Represents rollback from the Nov 17 decision to implement endless mode.

---

## Hypothesis 5: Beta Branch Isolation (Nov 25)

**Hypothesis**: Instead of code-level feature flags, use *release channel* isolation. Let users opt-in via git branch switching.
**What we learned**: This works! Git branches as feature toggle is unconventional but perfect for plugins.

### #14844 - Proposed Beta Branch Strategy for Endless Mode Feature Isolation
**Date**: Nov 25, 2025
**Type**: Decision
**Summary**: **THE SOLUTION** - Instead of keeping endless mode on main, isolate it on a beta branch. Users can opt-in via git branch switching. This way:
- Main branch stays stable
- Adventurous users can try beta features
- Easy rollback if issues occur

**Key Facts**:
- Initial idea: isolate endless mode code into dedicated folder structure
- Better alternative: dynamically switch plugin folder to beta/release branch
- Allows main branch to evolve independently
- User data stored at ~/.rad-mem/ separate from plugin code (safe switching)

### #14896 / #14899 / #14901 / #14902 - Beta Branch Backup Before Continuing
**Date**: Nov 25, 2025
**Type**: Decision
**Summary**: Multiple backup checkpoints during beta branch implementation, ensuring working state was preserved.

### #14954 - Version Channel UI Implementation
**Date**: Nov 25, 2025
**Type**: Feature
**Summary**: Complete UI section in Sidebar with color-coded badges and conditional channel controls. Users on stable see invitation to try beta; beta users see options to return to stable.

### #14985 - Git-Based Beta Branch Switching System
**Date**: Nov 25, 2025
**Type**: Discovery
**Summary**: BranchManager enables UI-driven switching between stable and beta branches with safety features: discards local changes (safe), auto-rollback on failure, npm install with timeout.

---

## Timeline Summary

| Date | Hypothesis | What We Learned | Key Decision |
|------|------------|-----------------|--------------|
| Nov 16 | H1: Optional feature | Avoid mandatory refactoring | #9965 |
| Nov 19 | H2: Async compression | Ripple effects, regressions | #12352 |
| Nov 21 | H3: Synchronous blocking | Works until timeout too aggressive | #13007 |
| Nov 23 | H4: Cycle-based replacement | Added complexity, didn't solve timing | #14480, #14483 |
| Nov 23 | **SETBACK** | H3 + H4 = system hangs | #14657 |
| Nov 25 | H5: Beta branch isolation | Git branches work great for plugins | #14844, #14954 |

**Key Insight**: The problem wasn't the compression algorithm - it was the delivery mechanism. Synchronous blocking + complex replacement = hanging. Solution: simple compression + release channel isolation.

---

## Query Examples

```bash
# Get all endless mode decisions
curl "localhost:38888/api/decisions?query=endless+mode"

# Search for specific topics
curl "localhost:38888/api/search?query=synchronous+transformation+90+second&format=full"

# Get the hanging/disabled decisions
curl "localhost:38888/api/decisions?query=disabled+hanging"

# Get the beta branch strategy
curl "localhost:38888/api/decisions?query=beta+branch+strategy"
```

---

*Generated by rad-mem using its own memory system. 5 hypotheses, 22 decisions, 10 days - iterating toward a working solution.*
