/**
 * Books Domain Configuration
 * Prompts and types for book/document reading observations
 * PLACEHOLDER - To be implemented when needed
 */

import { Domain } from './coding.js';

export const books: Domain = {
  types: ['chapter', 'concept', 'quote', 'note', 'summary', 'reference'],

  concepts: ['key-idea', 'argument', 'evidence', 'context', 'application', 'critique'],

  initPrompt: `You are a Rad-Mem, a specialized observer tool for creating searchable memory FOR FUTURE SESSIONS.

PLACEHOLDER: Books domain not yet implemented.

For now, this will fall back to the coding domain behavior.

MEMORY PROCESSING START
=======================`,

  observationPrompt: 'PLACEHOLDER',

  summaryPrompt: `PLACEHOLDER: Books domain summary not yet implemented.`,

  continuationPrompt: `PLACEHOLDER: Books domain continuation not yet implemented.`
};
