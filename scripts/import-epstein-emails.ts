#!/usr/bin/env tsx
/**
 * Import Epstein email JSONL transcripts into rad-mem
 *
 * Unlike regular transcript imports which look for tool executions,
 * this script imports email content directly as observations.
 *
 * Usage: npx tsx scripts/import-epstein-emails.ts <jsonl-file>
 */

import * as fs from 'fs';
import * as path from 'path';
import type { UserTranscriptEntry } from '../src/types/transcript.js';

const API_BASE = 'http://localhost:38888';

interface ImportStats {
  totalEmails: number;
  queued: number;
  skipped: number;
  errors: number;
}

async function ensureSession(sessionId: string, project: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/sessions/ensure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent_session_id: sessionId,
      platform: 'epstein-dataset',
      project,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to ensure session: ${response.statusText}`);
  }
}

async function submitObservation(
  sessionId: string,
  emailContent: string,
  documentId: string
): Promise<{ status: string; reason?: string }> {
  const response = await fetch(`${API_BASE}/api/observations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent_session_id: sessionId,
      platform: 'epstein-dataset',
      tool_name: 'EmailImport',
      tool_input: { document_id: documentId },
      tool_response: emailContent,
      cwd: '/Users/alexnewman/Scripts/rad-mem',
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to submit observation: ${response.statusText}`);
  }

  return response.json();
}

async function completeSession(sessionId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/sessions/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent_session_id: sessionId,
      platform: 'epstein-dataset',
      reason: 'email_import_complete',
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to complete session: ${response.statusText}`);
  }
}

async function importEmailTranscript(filepath: string): Promise<void> {
  console.log(`Importing: ${filepath}\n`);

  // Read JSONL file
  const content = fs.readFileSync(filepath, 'utf-8');
  const lines = content.trim().split('\n');
  const entries = lines.map(line => JSON.parse(line));

  // Extract session ID from first entry
  const sessionId = entries[0]?.sessionId;
  if (!sessionId) {
    throw new Error('Could not find session ID in transcript');
  }

  // Extract project from session ID (format: epstein-emails-{hash}-chunk-{n})
  const project = 'epstein-emails';

  console.log(`Session ID: ${sessionId}`);
  console.log(`Project: ${project}`);
  console.log(`Total entries: ${entries.length}\n`);

  // Ensure session exists
  await ensureSession(sessionId, project);

  // Process user entries (emails)
  const stats: ImportStats = {
    totalEmails: 0,
    queued: 0,
    skipped: 0,
    errors: 0,
  };

  for (const entry of entries) {
    if (entry.type !== 'user') continue;

    const userEntry = entry as UserTranscriptEntry;
    stats.totalEmails++;

    // Extract email content
    const emailContent = Array.isArray(userEntry.message.content)
      ? userEntry.message.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('\n')
      : userEntry.message.content;

    // Extract document ID from metadata
    const docIdMatch = emailContent.match(/<document_id>([^<]+)<\/document_id>/);
    const documentId = docIdMatch ? docIdMatch[1] : `unknown-${stats.totalEmails}`;

    try {
      const result = await submitObservation(sessionId, emailContent, documentId);

      if (result.status === 'queued') {
        stats.queued++;
        console.log(`  ✓ ${documentId} - queued`);
      } else if (result.status === 'skipped') {
        stats.skipped++;
        console.log(`  ⊘ ${documentId} - skipped (${result.reason || 'unknown'})`);
      }

      // Small delay to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 50));
    } catch (err) {
      stats.errors++;
      console.error(`  ✗ ${documentId} - error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Complete session
  await completeSession(sessionId);

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('IMPORT COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total emails: ${stats.totalEmails}`);
  console.log(`Queued: ${stats.queued}`);
  console.log(`Skipped: ${stats.skipped}`);
  console.log(`Errors: ${stats.errors}`);
  console.log('='.repeat(60));
}

// Main
async function main() {
  const filepath = process.argv[2];

  if (!filepath) {
    console.error('Usage: npx tsx scripts/import-epstein-emails.ts <jsonl-file>');
    process.exit(1);
  }

  if (!fs.existsSync(filepath)) {
    console.error(`File not found: ${filepath}`);
    process.exit(1);
  }

  try {
    await importEmailTranscript(filepath);
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
}

main();
