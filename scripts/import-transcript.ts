#!/usr/bin/env npx tsx
/**
 * Import Claude Code transcript to rad-mem
 * Replays tool executions through RAD Protocol API
 *
 * Usage: npx tsx scripts/import-transcript.ts <path-to-transcript.jsonl> [delayMs]
 *
 * Options:
 *   delayMs: Milliseconds between observation submissions (default: 100)
 *            Can also be set via IMPORT_DELAY_MS environment variable
 *
 * Environment Variables:
 *   IMPORT_PROCESSING_WAIT_MS: Milliseconds to wait per observation for processing
 *                              before generating summary (default: 2000)
 *                              Total wait = queued observations × this value
 */

import { existsSync, readFileSync } from 'fs';
import { resolve, basename } from 'path';
import type {
  TranscriptEntry,
  UserTranscriptEntry,
  AssistantTranscriptEntry,
  ToolUseContent,
  ToolResultContent,
  ContentItem,
} from '../src/types/transcript.js';

const RAD_API_BASE = 'http://localhost:38888';

interface PairedToolExecution {
  tool_use_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response: string | unknown;
  timestamp: string;
  cwd: string;
}

interface ParsedTranscript {
  entries: TranscriptEntry[];
  sessionId: string;
  project: string;
  lastUserMessage: string;
  lastAssistantMessage: string;
}

/**
 * Parse transcript JSONL file
 */
function parseTranscript(transcriptPath: string): ParsedTranscript {
  const content = readFileSync(transcriptPath, 'utf-8').trim();
  if (!content) {
    throw new Error('Transcript file is empty');
  }

  const lines = content.split('\n');
  const entries: TranscriptEntry[] = [];

  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as TranscriptEntry);
    } catch {
      // Skip malformed lines
    }
  }

  // Extract sessionId from first entry that has it
  const firstWithSession = entries.find(
    (e): e is UserTranscriptEntry | AssistantTranscriptEntry =>
      (e.type === 'user' || e.type === 'assistant') && 'sessionId' in e
  );

  if (!firstWithSession) {
    throw new Error('No sessionId found in transcript');
  }

  // Extract project from cwd
  const firstWithCwd = entries.find(
    (e): e is UserTranscriptEntry | AssistantTranscriptEntry =>
      (e.type === 'user' || e.type === 'assistant') && 'cwd' in e && !!e.cwd
  );
  const project = firstWithCwd ? basename(firstWithCwd.cwd) : 'unknown-project';

  // Extract last user/assistant messages for summary
  const lastUserMessage = extractLastUserMessage(entries);
  const lastAssistantMessage = extractLastAssistantMessage(entries);

  return {
    entries,
    sessionId: firstWithSession.sessionId,
    project,
    lastUserMessage,
    lastAssistantMessage,
  };
}

/**
 * Extract text from content items
 */
function extractTextFromContent(content: string | ContentItem[]): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .filter((item): item is { type: 'text'; text: string } => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
}

/**
 * Get last user message with actual text content
 */
function extractLastUserMessage(entries: TranscriptEntry[]): string {
  const userEntries = entries.filter((e): e is UserTranscriptEntry => e.type === 'user');

  for (let i = userEntries.length - 1; i >= 0; i--) {
    const entry = userEntries[i];
    if (!entry?.message?.content) continue;
    const text = extractTextFromContent(entry.message.content);
    if (text) return text;
  }

  return '';
}

/**
 * Get last assistant message with text content (filters system-reminders)
 */
function extractLastAssistantMessage(entries: TranscriptEntry[]): string {
  const assistantEntries = entries.filter(
    (e): e is AssistantTranscriptEntry => e.type === 'assistant'
  );

  for (let i = assistantEntries.length - 1; i >= 0; i--) {
    const entry = assistantEntries[i];
    if (!entry?.message?.content) continue;

    let text = extractTextFromContent(entry.message.content);
    if (!text) continue;

    // Filter system-reminder tags
    text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '');
    text = text.replace(/\n{3,}/g, '\n\n').trim();

    if (text) return text;
  }

  return '';
}

/**
 * Pair tool_use blocks with their corresponding tool_result blocks
 */
function pairToolExecutions(entries: TranscriptEntry[]): PairedToolExecution[] {
  const paired: PairedToolExecution[] = [];

  // Map of pending tool_use blocks waiting for results
  const pending = new Map<
    string,
    {
      name: string;
      input: Record<string, unknown>;
      timestamp: string;
      cwd: string;
    }
  >();

  for (const entry of entries) {
    // Assistant entries contain tool_use blocks
    if (entry.type === 'assistant' && Array.isArray(entry.message.content)) {
      for (const item of entry.message.content) {
        if (item.type === 'tool_use') {
          const toolUse = item as ToolUseContent;
          pending.set(toolUse.id, {
            name: toolUse.name,
            input: toolUse.input,
            timestamp: entry.timestamp,
            cwd: entry.cwd,
          });
        }
      }
    }

    // User entries contain tool_result blocks
    if (entry.type === 'user' && Array.isArray(entry.message.content)) {
      for (const item of entry.message.content) {
        if (item.type === 'tool_result') {
          const toolResult = item as ToolResultContent;
          const tool = pending.get(toolResult.tool_use_id);

          if (tool) {
            paired.push({
              tool_use_id: toolResult.tool_use_id,
              tool_name: tool.name,
              tool_input: tool.input,
              tool_response: toolResult.content,
              timestamp: tool.timestamp,
              cwd: entry.cwd || tool.cwd,
            });
            pending.delete(toolResult.tool_use_id);
          }
        }
      }
    }
  }

  // Warn about unpaired tool uses
  if (pending.size > 0) {
    console.warn(`Warning: ${pending.size} tool uses without results (interrupted session?)`);
  }

  return paired;
}

/**
 * Check if session already exists in rad-mem
 */
async function sessionExists(sessionId: string, project: string): Promise<boolean> {
  const response = await fetch(`${RAD_API_BASE}/api/sessions/ensure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent_session_id: sessionId,
      platform: 'claude-code',
      project,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to check session: ${response.statusText}`);
  }

  const result = (await response.json()) as { created: boolean; prompt_number: number };

  // If not newly created and has prompts, it exists
  return !result.created && result.prompt_number > 1;
}

/**
 * Submit a single observation to the RAD API
 */
async function submitObservation(
  sessionId: string,
  execution: PairedToolExecution
): Promise<{ status: string; reason?: string }> {
  const response = await fetch(`${RAD_API_BASE}/api/observations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent_session_id: sessionId,
      platform: 'claude-code',
      tool_name: execution.tool_name,
      tool_input: execution.tool_input,
      tool_response:
        typeof execution.tool_response === 'string'
          ? execution.tool_response
          : JSON.stringify(execution.tool_response),
      cwd: execution.cwd,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to submit observation: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Generate session summary
 */
async function generateSummary(
  sessionId: string,
  lastUserMessage: string,
  lastAssistantMessage: string
): Promise<void> {
  const response = await fetch(`${RAD_API_BASE}/api/sessions/summarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent_session_id: sessionId,
      platform: 'claude-code',
      last_user_message: lastUserMessage,
      last_assistant_message: lastAssistantMessage,
    }),
  });

  if (!response.ok) {
    console.warn(`Warning: Failed to generate summary: ${response.statusText}`);
  }
}

/**
 * Mark session as complete
 */
async function completeSession(sessionId: string): Promise<void> {
  const response = await fetch(`${RAD_API_BASE}/api/sessions/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent_session_id: sessionId,
      platform: 'claude-code',
      reason: 'import_complete',
    }),
  });

  if (!response.ok) {
    console.warn(`Warning: Failed to complete session: ${response.statusText}`);
  }
}

/**
 * Main import flow
 */
async function importTranscript(transcriptPath: string, delayMs: number = 100): Promise<void> {
  console.log(`Parsing transcript: ${transcriptPath}`);
  console.log(`Delay between submissions: ${delayMs}ms`);

  const { entries, sessionId, project, lastUserMessage, lastAssistantMessage } =
    parseTranscript(transcriptPath);

  console.log(`Session ID: ${sessionId}`);
  console.log(`Project: ${project}`);
  console.log(`Total entries: ${entries.length}`);

  // Check idempotency
  const exists = await sessionExists(sessionId, project);
  if (exists) {
    console.log('\nSession already imported. Skipping.');
    return;
  }

  // Pair tool executions
  const executions = pairToolExecutions(entries);
  console.log(`Paired tool executions: ${executions.length}`);

  if (executions.length === 0) {
    console.log('\nNo tool executions to import.');
    await completeSession(sessionId);
    return;
  }

  // Submit observations with delay to simulate live session
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
      `\rProcessed: ${queued + skipped}/${executions.length} (${queued} queued, ${skipped} skipped)`
    );

    // Delay between submissions to let SDK agent process
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  console.log('\n');
  console.log('Import complete!');
  console.log(`  Observations queued: ${queued}`);
  console.log(`  Observations skipped: ${skipped}`);
  console.log('\nNote: Observations are processing in the background.');
  console.log('      Session will remain active. Check rad-mem logs or viewer UI.');
}

// --- CLI Entry Point ---

const transcriptPath = process.argv[2];
const delayArg = process.argv[3];

if (!transcriptPath) {
  console.error('Usage: npx tsx scripts/import-transcript.ts <path-to-transcript.jsonl> [delayMs]');
  console.error('');
  console.error('Options:');
  console.error('  delayMs: Milliseconds between submissions (default: 100, env: IMPORT_DELAY_MS)');
  console.error('');
  console.error('Examples:');
  console.error('  npx tsx scripts/import-transcript.ts transcript.jsonl');
  console.error('  npx tsx scripts/import-transcript.ts transcript.jsonl 500');
  console.error('  npx tsx scripts/import-transcript.ts transcript.jsonl 0  # no delay');
  console.error('  IMPORT_DELAY_MS=200 npx tsx scripts/import-transcript.ts transcript.jsonl');
  process.exit(1);
}

const resolvedPath = resolve(transcriptPath);

if (!existsSync(resolvedPath)) {
  console.error(`File not found: ${resolvedPath}`);
  process.exit(1);
}

// Parse delay: CLI arg > env var > default (100)
const delayMs = delayArg
  ? parseInt(delayArg, 10)
  : process.env.IMPORT_DELAY_MS
    ? parseInt(process.env.IMPORT_DELAY_MS, 10)
    : 100;

if (isNaN(delayMs) || delayMs < 0) {
  console.error(`Invalid delay value: ${delayArg || process.env.IMPORT_DELAY_MS}`);
  process.exit(1);
}

importTranscript(resolvedPath, delayMs).catch((error) => {
  console.error('Import failed:', error.message);
  process.exit(1);
});
