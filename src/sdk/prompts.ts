/**
 * SDK Prompts Module
 * Generates prompts for the Claude Agent SDK memory worker
 */

import { coding } from './domains/coding.js';
import { emails } from './domains/emails.js';
import { books } from './domains/books.js';
import type { Domain } from './domains/coding.js';

const DOMAINS: Record<string, Domain> = { coding, emails, books };

export interface Observation {
  id: number;
  tool_name: string;
  tool_input: string;
  tool_output: string;
  created_at_epoch: number;
  cwd?: string;
}

export interface SDKSession {
  id: number;
  sdk_session_id: string | null;
  project: string;
  user_prompt: string;
  last_user_message?: string;
  last_assistant_message?: string;
}

/**
 * Build initial prompt to initialize the SDK agent
 */
export function buildInitPrompt(project: string, sessionId: string, userPrompt: string, domainType: string = 'coding'): string {
  const domain = DOMAINS[domainType] || DOMAINS.coding;
  return domain.initPrompt
    .replace('{{userPrompt}}', userPrompt)
    .replace('{{date}}', new Date().toISOString().split('T')[0]);
}

/**
 * Build prompt to send tool observation to SDK agent
 */
export function buildObservationPrompt(obs: Observation): string {
  // Safely parse tool_input and tool_output - they're already JSON strings
  let toolInput: any;
  let toolOutput: any;

  try {
    toolInput = typeof obs.tool_input === 'string' ? JSON.parse(obs.tool_input) : obs.tool_input;
  } catch {
    toolInput = obs.tool_input;  // If parse fails, use raw value
  }

  try {
    toolOutput = typeof obs.tool_output === 'string' ? JSON.parse(obs.tool_output) : obs.tool_output;
  } catch {
    toolOutput = obs.tool_output;  // If parse fails, use raw value
  }

  return `<observed_from_primary_session>
  <what_happened>${obs.tool_name}</what_happened>
  <occurred_at>${new Date(obs.created_at_epoch).toISOString()}</occurred_at>${obs.cwd ? `\n  <working_directory>${obs.cwd}</working_directory>` : ''}
  <parameters>${JSON.stringify(toolInput, null, 2)}</parameters>
  <outcome>${JSON.stringify(toolOutput, null, 2)}</outcome>
</observed_from_primary_session>`;
}

/**
 * Build prompt to generate progress summary
 */
export function buildSummaryPrompt(session: SDKSession, domainType: string = 'coding'): string {
  const domain = DOMAINS[domainType] || DOMAINS.coding;
  const lastAssistantMessage = session.last_assistant_message || '';

  return domain.summaryPrompt
    .replace('{{lastAssistantMessage}}', lastAssistantMessage);
}

/**
 * Build prompt for continuation of existing session
 *
 * CRITICAL: Why claudeSessionId Parameter is Required
 * ====================================================
 * This function receives claudeSessionId from SDKAgent.ts, which comes from:
 * - SessionManager.initializeSession (fetched from database)
 * - SessionStore.createSDKSession (stored by new-hook.ts)
 * - new-hook.ts receives it from Claude Code's hook context
 *
 * The claudeSessionId is the SAME session_id used by:
 * - NEW hook (to create/fetch session)
 * - SAVE hook (to store observations)
 * - This continuation prompt (to maintain session context)
 *
 * This is how everything stays connected - ONE session_id threading through
 * all hooks and prompts in the same conversation.
 *
 * Called when: promptNumber > 1 (see SDKAgent.ts line 150)
 * First prompt: Uses buildInitPrompt instead (promptNumber === 1)
 */
export function buildContinuationPrompt(userPrompt: string, promptNumber: number, claudeSessionId: string, domainType: string = 'coding'): string {
  const domain = DOMAINS[domainType] || DOMAINS.coding;
  return domain.continuationPrompt
    .replace('{{userPrompt}}', userPrompt)
    .replace('{{date}}', new Date().toISOString().split('T')[0]);
} 