# Plan: Proper Transcript Import Script

## Problem Summary

The current `scripts/import-transcript.ts` has critical reliability issues:

1. **No Wait for Processing**: Returns immediately with `status: 'queued'` but observations aren't saved yet
2. **Race Conditions**: Summary generation runs before observations finish processing
3. **No Verification**: Never confirms observations were actually written to database
4. **Arbitrary 100ms Delay**: Band-aid that's sometimes too short, sometimes too long
5. **Silent Failures**: No detection when SDK agent fails to process observations

## Root Cause

The RAD Protocol API is **asynchronous**:
- `POST /api/observations` queues to in-memory buffer and returns immediately
- SDK agent processes queue in background (variable latency)
- Database writes happen during async processing
- No feedback mechanism to know when processing is complete

## Key Findings

### Current Flow (Broken)
```
Submit observation → HTTP 200 {status: 'queued'} → Continue immediately
                                                  ↓
                                            [Still processing in background...]
                                                  ↓
                                            Generate summary (TOO EARLY!)
```

### What Should Happen
```
Submit observation → Wait for processing → Verify saved → Continue
```

### Available APIs
- `GET /api/processing-status` - Returns `{ isProcessing, queueDepth }`
- `GET /api/observations?project=X` - Can verify saved count
- SSE `/stream` endpoint - Real-time observation events

## Solution: Batch Submit + Poll + Verify

**Approach**: Use a 4-phase process that leverages existing APIs without modifying the worker.

### Why This Approach?
- **Simple**: Uses existing `/api/processing-status` endpoint
- **Reliable**: Explicit verification that observations were saved to database
- **Fast**: Batch submission allows parallel processing in the worker
- **YAGNI-compliant**: No over-engineering, solves the actual problem

### The 4 Phases

```
Phase 1: SUBMIT    → Batch queue all observations to API
Phase 2: WAIT      → Poll /api/processing-status until queue empty
Phase 3: VERIFY    → Query /api/observations to confirm saved
Phase 4: SUMMARIZE → Generate summary (now safe - observations saved)
```

## Implementation Plan

**IMPORTANT**: This plan reuses ALL existing logic. We're NOT rebuilding the import pipeline. We're ONLY adding two small helper functions to fix the race condition.

**What stays the same**:
- `submitObservation()` - Already calls `POST /api/observations` correctly
- `generateSummary()` - Already works
- `completeSession()` - Already works
- All transcript parsing logic - Already works

**What we're adding**:
- `waitForProcessingComplete()` - NEW: Poll until queue empty
- `verifyObservationsSaved()` - NEW: Confirm observations saved
- Updated flow in `importTranscript()` to call these helpers

### 1. Add Helper Function: `waitForProcessingComplete()`

Poll `/api/processing-status` until queue is empty:

```typescript
async function waitForProcessingComplete(
  sessionId: string,
  expectedCount: number,
  project: string
): Promise<void> {
  const startTime = Date.now();
  let lastQueueDepth = -1;
  let stuckCount = 0;

  while (true) {
    // Timeout check (10 minutes)
    if (Date.now() - startTime > 600000) {
      throw new Error('Processing timeout - SDK agent may be stuck');
    }

    // Poll status
    const response = await fetch(`${RAD_API_BASE}/api/processing-status`);
    const status = await response.json();

    // Show progress
    process.stdout.write(`\rProcessing: ${status.queueDepth} items remaining...`);

    // Done when no active work
    if (!status.isProcessing && status.queueDepth === 0) {
      console.log('\n');
      break;
    }

    // Detect stuck processing (queue depth unchanged for 10 seconds)
    if (status.queueDepth === lastQueueDepth && status.queueDepth > 0) {
      stuckCount++;
      if (stuckCount >= 20) { // 20 polls * 500ms = 10 seconds
        throw new Error('Processing appears stuck');
      }
    } else {
      stuckCount = 0;
    }
    lastQueueDepth = status.queueDepth;

    // Wait 500ms before next poll
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}
```

**What it does**:
- Polls every 500ms until `queueDepth: 0` and `isProcessing: false`
- Shows progress: "Processing: 23 items remaining..."
- Detects stuck processing (10 seconds with no progress)
- Times out after 10 minutes

### 2. Add Helper Function: `verifyObservationsSaved()`

Query database to confirm observations were saved:

```typescript
async function verifyObservationsSaved(
  sessionId: string,
  project: string
): Promise<number> {
  const response = await fetch(
    `${RAD_API_BASE}/api/observations?project=${encodeURIComponent(project)}&limit=200`
  );

  const result = await response.json();
  return result.observations.length;
}
```

**What it does**:
- Queries `/api/observations?project=X` to count saved observations
- Returns the count (no comparison - filtering is expected)

### 3. Update Main `importTranscript()` Function

Replace the submission loop and summary generation with 4-phase approach:

```typescript
async function importTranscript(transcriptPath: string): Promise<void> {
  // ... existing parsing code ...

  // PHASE 1: Submit all observations (batch)
  console.log('\n=== Phase 1: Submitting observations ===');
  let queued = 0;
  let skipped = 0;

  for (const execution of executions) {
    const result = await submitObservation(sessionId, execution);
    if (result.status === 'queued') {
      queued++;
    } else {
      skipped++;
    }
    process.stdout.write(
      `\rSubmitting: ${queued + skipped}/${executions.length} (${queued} queued, ${skipped} skipped)`
    );
    // REMOVE THE 100ms DELAY - no longer needed!
  }
  console.log('\n');

  // PHASE 2: Wait for processing to complete
  console.log('=== Phase 2: Waiting for processing ===');
  await waitForProcessingComplete(sessionId, queued, project);

  // PHASE 3: Verify observations were saved
  console.log('=== Phase 3: Verifying saved observations ===');
  const savedCount = await verifyObservationsSaved(sessionId, project);
  console.log(`Verified: ${savedCount} observations saved to database`);

  // PHASE 4: Generate summary (now safe - observations are saved)
  console.log('\n=== Phase 4: Generating summary ===');
  await generateSummary(sessionId, lastUserMessage, lastAssistantMessage);

  // Wait for summary to be processed
  console.log('Waiting for summary processing...');
  await waitForProcessingComplete(sessionId, 1, project);

  // Complete session
  await completeSession(sessionId);

  console.log('\n=== Import Complete ===');
  console.log(`  Observations queued: ${queued}`);
  console.log(`  Observations saved: ${savedCount}`);
  console.log(`  Observations skipped: ${skipped}`);
}
```

## Changes Summary

**File**: `scripts/import-transcript.ts`

**Add** (after existing helper functions):
- `waitForProcessingComplete()` function (~50 lines)
- `verifyObservationsSaved()` function (~30 lines)

**Modify** `importTranscript()`:
- Add 4-phase structure with console headers
- Remove 100ms delay between submissions
- Add wait after submission phase
- Add verification phase
- Add wait after summary phase
- Enhance final output

**Remove**:
- The arbitrary `await new Promise(resolve => setTimeout(resolve, 100))` delay

## Expected Output

When running the import:

```
Parsing transcript: /path/to/transcript.jsonl
Session ID: abc123
Project: my-project
Total entries: 234
Paired tool executions: 97

=== Phase 1: Submitting observations ===
Submitting: 97/97 (94 queued, 3 skipped)

=== Phase 2: Waiting for processing ===
Processing: 23 items remaining...
Processing complete in 12.3s

=== Phase 3: Verifying saved observations ===
Verified: 94 observations saved to database

=== Phase 4: Generating summary ===
Waiting for summary processing...
Processing complete in 2.1s

=== Import Complete ===
  Observations queued: 94
  Observations saved: 94
  Observations skipped: 3
```

## Error Handling

**Stuck Processing**:
```
Processing: 45 items remaining...
Error: Processing appears stuck - queue depth 45 unchanged for 10 seconds
```

**Timeout**:
```
Error: Processing timeout - SDK agent may be stuck
```

## Critical Files

- `scripts/import-transcript.ts` - Main file to modify (~155 lines changed)
- `src/services/worker-service.ts:1308-1312` - Reference for `/api/processing-status` endpoint
- `src/services/worker/SessionManager.ts:273-305` - Reference for processing status logic
