#!/usr/bin/env tsx
/**
 * Convert Epstein email dataset to Claude Code transcript JSONL format
 *
 * Converts 2,896 email text files into transcript format, organized by
 * participant pairs and chronologically, with files chunked to ~60k tokens.
 *
 * Usage: npx tsx scripts/convert-epstein-emails.ts [--test]
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import type {
  UserTranscriptEntry,
  AssistantTranscriptEntry,
  TextContent,
} from '../src/types/transcript.js';

// ============================================================================
// Interfaces
// ============================================================================

interface ParsedEmail {
  documentId: string;
  filename: string;
  filepath: string;
  from?: string;
  to?: string[];
  sent?: Date;
  subject?: string;
  body: string;
  parseSuccess: boolean;  // true if headers were found
  tokenCount: number;
}

interface ParticipantGroup {
  hash: string;
  participants: string[];
  emails: ParsedEmail[];
  totalTokens: number;
}

interface TranscriptChunk {
  sessionId: string;
  participantHash: string;
  participants: string[];
  entries: Array<UserTranscriptEntry | AssistantTranscriptEntry>;
  emails: ParsedEmail[];
  tokenCount: number;
  chunkNumber: number;
}

interface ManifestFile {
  filename: string;
  participant_hash: string;
  participants: string[];
  email_count: number;
  token_count: number;
  date_range: {
    start: string | null;
    end: string | null;
  };
}

interface ManifestError {
  file: string;
  error: string;
  recovery: string;
}

interface Manifest {
  generated_at: string;
  total_emails: number;
  total_files: number;
  total_tokens: number;
  files: ManifestFile[];
  errors: ManifestError[];
}

// ============================================================================
// Constants
// ============================================================================

const TEXT_DIR_1 = path.join(process.cwd(), 'datasets/epstein/TEXT/001');
const TEXT_DIR_2 = path.join(process.cwd(), 'datasets/epstein/TEXT/002');
const OUTPUT_DIR = path.join(process.cwd(), 'datasets/epstein/transcripts');
const MANIFEST_PATH = path.join(OUTPUT_DIR, 'index.json');
const TOKEN_LIMIT = 60000; // Safety buffer from 66k limit
const CWD_PATH = '/Users/alexnewman/Scripts/rad-mem';

const errors: ManifestError[] = [];

// ============================================================================
// Utility Functions: Token Counting
// ============================================================================

/**
 * Estimate token count using simple heuristic: ~4 characters per token
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ============================================================================
// Utility Functions: File Discovery
// ============================================================================

/**
 * Recursively discover all .txt files in given directories
 */
function discoverEmailFiles(dirs: string[]): string[] {
  const files: string[] = [];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      console.warn(`Warning: Directory not found: ${dir}`);
      continue;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        files.push(...discoverEmailFiles([fullPath]));
      } else if (entry.isFile() && entry.name.endsWith('.txt')) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

// ============================================================================
// Utility Functions: Date Parsing
// ============================================================================

/**
 * Parse email date from various formats
 * Returns null if parsing fails
 */
function parseEmailDate(dateStr: string): Date | null {
  if (!dateStr || dateStr.trim().length === 0) {
    return null;
  }

  // Try ISO 8601
  const isoDate = new Date(dateStr);
  if (!isNaN(isoDate.getTime())) {
    return isoDate;
  }

  // Try MM/DD/YYYY HH:MM:SS AM/PM
  const match1 = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)/i);
  if (match1) {
    const [, month, day, year, hour, minute, second, ampm] = match1;
    let hours = parseInt(hour);
    if (ampm.toUpperCase() === 'PM' && hours !== 12) hours += 12;
    if (ampm.toUpperCase() === 'AM' && hours === 12) hours = 0;
    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      hours,
      parseInt(minute),
      parseInt(second)
    );
  }

  // Try MM/DD/YYYY HH:MM:SS
  const match2 = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/);
  if (match2) {
    const [, month, day, year, hour, minute, second] = match2;
    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute),
      parseInt(second)
    );
  }

  return null;
}

// ============================================================================
// Utility Functions: Header Extraction
// ============================================================================

/**
 * Extract email headers from text
 * Returns partial ParsedEmail with headers (if found) and body
 */
function extractHeaders(text: string): Partial<ParsedEmail> {
  const lines = text.split('\n');
  const result: Partial<ParsedEmail> = {
    parseSuccess: false,
  };

  let lastHeaderLineIndex = -1;
  const headerPatterns = {
    from: /^From:\s*(.+)/i,
    to: /^To:\s*(.+)/i,
    sent: /^Sent:\s*(.+)/i,
    subject: /^Subject:\s*(.+)/i,
  };

  // Scan first 30 lines for headers
  for (let i = 0; i < Math.min(30, lines.length); i++) {
    const line = lines[i].trim();

    if (headerPatterns.from.test(line)) {
      const match = line.match(headerPatterns.from);
      if (match) {
        result.from = match[1].trim();
        result.parseSuccess = true;
        lastHeaderLineIndex = i;
      }
    } else if (headerPatterns.to.test(line)) {
      const match = line.match(headerPatterns.to);
      if (match) {
        // Split by semicolon or comma
        result.to = match[1].split(/[;,]/).map(s => s.trim()).filter(Boolean);
        result.parseSuccess = true;
        lastHeaderLineIndex = i;
      }
    } else if (headerPatterns.sent.test(line)) {
      const match = line.match(headerPatterns.sent);
      if (match) {
        const sentDate = parseEmailDate(match[1].trim());
        if (sentDate) {
          result.sent = sentDate;
        }
        result.parseSuccess = true;
        lastHeaderLineIndex = i;
      }
    } else if (headerPatterns.subject.test(line)) {
      const match = line.match(headerPatterns.subject);
      if (match) {
        result.subject = match[1].trim();
        result.parseSuccess = true;
        lastHeaderLineIndex = i;
      }
    }
  }

  // Extract body: everything after last header
  if (lastHeaderLineIndex >= 0) {
    result.body = lines.slice(lastHeaderLineIndex + 1).join('\n').trim();
  } else {
    result.body = text;
  }

  return result;
}

// ============================================================================
// Utility Functions: Email Parsing
// ============================================================================

/**
 * Parse a single email file
 */
function parseEmail(filepath: string): ParsedEmail | null {
  try {
    const content = fs.readFileSync(filepath, 'utf-8');
    const filename = path.basename(filepath);

    // Extract document ID from filename
    const docIdMatch = filename.match(/HOUSE_OVERSIGHT_(\d+)/);
    const documentId = docIdMatch ? `HOUSE_OVERSIGHT_${docIdMatch[1]}` : filename.replace('.txt', '');

    // Extract headers
    const extracted = extractHeaders(content);

    // Get file modification date as fallback
    const stats = fs.statSync(filepath);
    const fallbackDate = stats.mtime;

    const email: ParsedEmail = {
      documentId,
      filename,
      filepath,
      from: extracted.from,
      to: extracted.to,
      sent: extracted.sent || fallbackDate,
      subject: extracted.subject,
      body: extracted.body || content,
      parseSuccess: extracted.parseSuccess || false,
      tokenCount: 0, // Will be calculated later
    };

    // Log recoverable errors
    if (!extracted.sent) {
      errors.push({
        file: filename,
        error: 'Failed to parse date from Sent header',
        recovery: 'Used file modification date',
      });
    }

    if (!extracted.parseSuccess) {
      errors.push({
        file: filename,
        error: 'No email headers found',
        recovery: 'Treated as scanned document',
      });
    }

    return email;
  } catch (err) {
    const filename = path.basename(filepath);
    errors.push({
      file: filename,
      error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
      recovery: 'Skipped file',
    });
    return null;
  }
}

// ============================================================================
// Utility Functions: Participant Normalization
// ============================================================================

/**
 * Extract email address from "Name [email@domain]" or similar formats
 */
function extractEmailAddress(participant: string): string {
  // Try to extract email from brackets
  const bracketMatch = participant.match(/\[([^\]]+@[^\]]+)\]/);
  if (bracketMatch) {
    return bracketMatch[1].trim().toLowerCase();
  }

  // Try to find email pattern
  const emailMatch = participant.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (emailMatch) {
    return emailMatch[1].trim().toLowerCase();
  }

  // Return original, normalized
  return participant.trim().toLowerCase();
}

/**
 * Normalize participants (sender + recipients)
 */
function normalizeParticipants(from?: string, to?: string[]): string[] {
  const participants: string[] = [];

  if (from) {
    participants.push(extractEmailAddress(from));
  }

  if (to) {
    for (const recipient of to) {
      participants.push(extractEmailAddress(recipient));
    }
  }

  // Return empty array if no participants
  if (participants.length === 0) {
    return [];
  }

  // Sort alphabetically for consistency
  return [...new Set(participants)].sort();
}

/**
 * Create canonical hash from participants
 */
function createParticipantHash(participants: string[]): string {
  if (participants.length === 0) {
    return 'uncategorized';
  }

  const combined = participants.join('|');
  const hash = createHash('sha256').update(combined).digest('hex');
  return hash.substring(0, 12);
}

// ============================================================================
// Utility Functions: Grouping
// ============================================================================

/**
 * Group emails by participant pairs
 */
function groupByParticipants(emails: ParsedEmail[]): ParticipantGroup[] {
  const groups = new Map<string, ParticipantGroup>();

  for (const email of emails) {
    const participants = normalizeParticipants(email.from, email.to);
    const hash = createParticipantHash(participants);

    if (!groups.has(hash)) {
      groups.set(hash, {
        hash,
        participants,
        emails: [],
        totalTokens: 0,
      });
    }

    const group = groups.get(hash)!;
    group.emails.push(email);
  }

  // Sort emails within each group chronologically
  for (const group of groups.values()) {
    group.emails.sort((a, b) => {
      // Primary: timestamp
      if (a.sent && b.sent) {
        return a.sent.getTime() - b.sent.getTime();
      }

      // Secondary: document ID number
      const aNum = parseInt(a.documentId.match(/\d+/)?.[0] || '0');
      const bNum = parseInt(b.documentId.match(/\d+/)?.[0] || '0');
      if (aNum !== bNum) {
        return aNum - bNum;
      }

      // Tertiary: filename
      return a.filename.localeCompare(b.filename);
    });
  }

  return Array.from(groups.values());
}

// ============================================================================
// Utility Functions: Chunking
// ============================================================================

/**
 * Chunk emails by token limit
 */
function chunkByTokenLimit(group: ParticipantGroup, limit: number): TranscriptChunk[] {
  const chunks: TranscriptChunk[] = [];
  let currentChunk: ParsedEmail[] = [];
  let currentTokens = 0;
  let chunkNumber = 1;

  for (const email of group.emails) {
    // Calculate tokens for this email (user + assistant entries)
    const metadata = `<email_metadata>
<document_id>${email.documentId}</document_id>
${email.from ? `<from>${email.from}</from>` : ''}
${email.to ? `<to>${email.to.join('; ')}</to>` : ''}
${email.sent ? `<sent>${email.sent.toISOString()}</sent>` : ''}
${email.subject ? `<subject>${email.subject}</subject>` : ''}
</email_metadata>

${email.body}`;

    const emailTokens = estimateTokens(metadata) + 50; // User entry + assistant acknowledgment
    email.tokenCount = emailTokens;

    // Check if adding this email would exceed limit
    if (currentTokens + emailTokens > limit && currentChunk.length > 0) {
      // Create chunk from current batch
      const sessionId = `epstein-emails-${group.hash}-chunk-${chunkNumber}`;
      chunks.push({
        sessionId,
        participantHash: group.hash,
        participants: group.participants,
        entries: [], // Will be populated later
        emails: currentChunk,
        tokenCount: currentTokens,
        chunkNumber,
      });

      // Start new chunk
      currentChunk = [];
      currentTokens = 0;
      chunkNumber++;
    }

    currentChunk.push(email);
    currentTokens += emailTokens;
  }

  // Add final chunk if it has emails
  if (currentChunk.length > 0) {
    const sessionId = `epstein-emails-${group.hash}-chunk-${chunkNumber}`;
    chunks.push({
      sessionId,
      participantHash: group.hash,
      participants: group.participants,
      entries: [],
      emails: currentChunk,
      tokenCount: currentTokens,
      chunkNumber,
    });
  }

  return chunks;
}

// ============================================================================
// Utility Functions: Transcript Generation
// ============================================================================

/**
 * Generate transcript entry pair (user + assistant) for an email
 */
function generateTranscriptEntry(
  email: ParsedEmail,
  sessionId: string,
  parentUuid: string | null
): [UserTranscriptEntry, AssistantTranscriptEntry] {
  const userUuid = randomUUID();
  const assistantUuid = randomUUID();

  // Build metadata block
  const metadata = `<email_metadata>
<document_id>${email.documentId}</document_id>
${email.from ? `<from>${email.from}</from>` : ''}
${email.to ? `<to>${email.to.join('; ')}</to>` : ''}
${email.sent ? `<sent>${email.sent.toISOString()}</sent>` : ''}
${email.subject ? `<subject>${email.subject}</subject>` : ''}
</email_metadata>

${email.body}`;

  const timestamp = email.sent || new Date();

  // User entry
  const userEntry: UserTranscriptEntry = {
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'text',
          text: metadata,
        } as TextContent,
      ],
    },
    sessionId,
    cwd: CWD_PATH,
    timestamp: timestamp.toISOString(),
    uuid: userUuid,
    version: '1.0.0',
    userType: 'human',
    isSidechain: false,
  };

  // Assistant entry
  const assistantEntry: AssistantTranscriptEntry = {
    type: 'assistant',
    message: {
      id: `msg-${assistantUuid}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-3-5-sonnet-20241022',
      content: [
        {
          type: 'text',
          text: 'Email received and indexed.',
        } as TextContent,
      ],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: estimateTokens(metadata),
        output_tokens: 6,
      },
    },
    sessionId,
    cwd: CWD_PATH,
    timestamp: new Date(timestamp.getTime() + 1).toISOString(), // 1ms later
    uuid: assistantUuid,
    version: '1.0.0',
    userType: 'ai',
    isSidechain: false,
    parentUuid: userUuid,
  };

  return [userEntry, assistantEntry];
}

// ============================================================================
// Utility Functions: File Writing
// ============================================================================

/**
 * Write transcript chunk to JSONL file
 */
function writeTranscriptFile(chunk: TranscriptChunk, outputDir: string): void {
  const filename = `${chunk.sessionId}.jsonl`;
  const filepath = path.join(outputDir, filename);

  // Generate all transcript entries
  for (const email of chunk.emails) {
    const [userEntry, assistantEntry] = generateTranscriptEntry(
      email,
      chunk.sessionId,
      null // parentUuid not needed for our use case
    );
    chunk.entries.push(userEntry, assistantEntry);
  }

  // Write as newline-delimited JSON
  const lines = chunk.entries.map(entry => JSON.stringify(entry));
  const content = lines.join('\n') + '\n';

  fs.writeFileSync(filepath, content, 'utf-8');
  console.log(`  ✓ ${filename} (${chunk.emails.length} emails, ${chunk.tokenCount} tokens)`);
}

/**
 * Write manifest file
 */
function writeManifest(chunks: TranscriptChunk[], totalEmails: number): void {
  const files: ManifestFile[] = [];
  let totalTokens = 0;

  for (const chunk of chunks) {
    const filename = `${chunk.sessionId}.jsonl`;

    // Get date range
    const dates = chunk.emails.map(e => e.sent).filter(Boolean) as Date[];
    const dateRange = {
      start: dates.length > 0 ? new Date(Math.min(...dates.map(d => d.getTime()))).toISOString() : null,
      end: dates.length > 0 ? new Date(Math.max(...dates.map(d => d.getTime()))).toISOString() : null,
    };

    files.push({
      filename,
      participant_hash: chunk.participantHash,
      participants: chunk.participants,
      email_count: chunk.emails.length,
      token_count: chunk.tokenCount,
      date_range: dateRange,
    });

    totalTokens += chunk.tokenCount;
  }

  const manifest: Manifest = {
    generated_at: new Date().toISOString(),
    total_emails: totalEmails,
    total_files: files.length,
    total_tokens: totalTokens,
    files,
    errors,
  };

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`\n✓ Manifest written to ${MANIFEST_PATH}`);
}

// ============================================================================
// Main Conversion Logic
// ============================================================================

async function main() {
  const testMode = process.argv.includes('--test');

  console.log('Epstein Emails → JSONL Transcript Conversion\n');
  console.log(`Mode: ${testMode ? 'TEST (first 20 files)' : 'FULL'}\n`);

  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`Created output directory: ${OUTPUT_DIR}\n`);
  }

  // Phase 1: Discover files
  console.log('Phase 1: Discovering email files...');
  let files = discoverEmailFiles([TEXT_DIR_1, TEXT_DIR_2]);
  console.log(`Found ${files.length} .txt files\n`);

  // Test mode: limit to first 20 files
  if (testMode) {
    files = files.slice(0, 20);
    console.log(`TEST MODE: Processing only ${files.length} files\n`);
  }

  // Phase 2: Parse emails
  console.log('Phase 2: Parsing emails...');
  const emails: ParsedEmail[] = [];
  for (const filepath of files) {
    const email = parseEmail(filepath);
    if (email) {
      emails.push(email);
    }
  }
  console.log(`Parsed ${emails.length} emails (${files.length - emails.length} failed)\n`);

  // Phase 3: Group by participants
  console.log('Phase 3: Grouping by participants...');
  const groups = groupByParticipants(emails);
  console.log(`Created ${groups.length} participant groups\n`);

  // Phase 4: Chunk by token limit
  console.log('Phase 4: Chunking by token limit...');
  const allChunks: TranscriptChunk[] = [];
  for (const group of groups) {
    const chunks = chunkByTokenLimit(group, TOKEN_LIMIT);
    allChunks.push(...chunks);
  }
  console.log(`Created ${allChunks.length} chunks\n`);

  // Phase 5: Write transcript files
  console.log('Phase 5: Writing transcript files...');
  for (const chunk of allChunks) {
    writeTranscriptFile(chunk, OUTPUT_DIR);
  }

  // Phase 6: Write manifest
  console.log('\nPhase 6: Writing manifest...');
  writeManifest(allChunks, emails.length);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('CONVERSION COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total emails processed: ${emails.length}`);
  console.log(`Total JSONL files: ${allChunks.length}`);
  console.log(`Total tokens: ${allChunks.reduce((sum, c) => sum + c.tokenCount, 0).toLocaleString()}`);
  console.log(`Errors: ${errors.length}`);
  console.log(`Output directory: ${OUTPUT_DIR}`);
  console.log('='.repeat(60));
}

// Run
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
