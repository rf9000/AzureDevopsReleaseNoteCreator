import { readFileSync } from 'fs';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { AppConfig } from '../types/index.ts';

function log(message: string): void {
  const ts = new Date(Date.now() + 3600000).toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] ${message}`);
}

export interface ReleaseNoteContext {
  prTitle: string;
  prDescription: string;
  changedFiles: string[];
  workItemTitle: string;
  workItemType: string;
  workItemDescription: string;
}

export async function generateReleaseNote(
  config: AppConfig,
  context: ReleaseNoteContext,
): Promise<string> {
  // 1. Read system prompt from config.releaseNotePromptPath
  const systemPrompt = readFileSync(config.releaseNotePromptPath, 'utf-8');

  // 2. Build user prompt with all context
  const userPrompt = buildUserPrompt(context);

  // 3. Call query() from Agent SDK
  // Remove CLAUDECODE env var to allow nested Claude Code sessions (e.g. when
  // this tool is launched from within Claude Code itself).
  delete process.env.CLAUDECODE;

  let result: string | undefined;
  const assistantTexts: string[] = [];

  let turnCount = 0;
  let loopError: unknown;

  try {
    for await (const message of query({
      prompt: userPrompt,
      options: {
        model: config.claudeModel,
        maxTurns: 30,
        allowedTools: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        systemPrompt,
      },
    })) {
      const subtype = 'subtype' in message ? message.subtype : undefined;
      log(`    SDK [turn ${turnCount}] type=${message.type}${subtype ? ` subtype=${subtype}` : ''}`);

      if (message.type === 'assistant') {
        turnCount++;
        // Collect text from all assistant messages so we can find the HTML
        // release note even if the agent adds a conversational summary afterward.
        const msg = (message as { message?: { content?: Array<{ type: string; text?: string }> } }).message;
        if (msg?.content) {
          for (const block of msg.content) {
            if (block.type === 'text' && block.text) {
              assistantTexts.push(block.text);
            }
          }
        }
      }

      if (message.type === 'result') {
        if (message.subtype === 'success') {
          result = message.result;
        } else {
          const errors = 'errors' in message ? (message as { errors: string[] }).errors.join('; ') : 'unknown';
          throw new Error(`Claude Agent SDK error (${message.subtype}): ${errors}`);
        }
        break;
      }
    }
  } catch (err) {
    loopError = err;
    const errMsg = err instanceof Error ? err.message : String(err);
    const errStack = err instanceof Error ? err.stack : undefined;
    log(`    SDK loop error: ${errMsg}`);
    if (errStack) log(`    SDK stack: ${errStack}`);
    if (assistantTexts.length > 0) {
      log(`    SDK collected ${assistantTexts.length} assistant text block(s) before error`);
    }
    // If we already got a successful result before the process crashed,
    // log a warning but continue — the release note was generated.
    if (result !== undefined) {
      log(`    SDK result was already received — continuing despite process exit error`);
    }
  }

  // 5. Return the result text, trimmed
  if (result === undefined) {
    // Re-throw the original error if we have one, otherwise a generic message
    if (loopError) {
      throw loopError;
    }
    throw new Error('No result received from Claude Agent SDK (no result message yielded)');
  }

  // The agent may output the HTML release note in an earlier turn and then
  // follow up with a conversational summary. If the final result doesn't
  // contain HTML, search earlier assistant messages for the actual content.
  return extractHtml(result, assistantTexts);
}

/**
 * Extract the HTML release note from the agent's output. If the final result
 * is just a conversational summary (no `<h3>` tags), fall back to earlier
 * assistant messages that contain actual HTML.
 */
function extractHtml(result: string, assistantTexts: string[]): string {
  // Best case: the final result itself contains the HTML
  const htmlFromResult = pickHtml(result);
  if (htmlFromResult) return htmlFromResult;

  // Search assistant messages in reverse (most recent first) for HTML content
  for (let i = assistantTexts.length - 1; i >= 0; i--) {
    const html = pickHtml(assistantTexts[i]!);
    if (html) return html;
  }

  // No valid HTML found — refuse to return garbage (e.g. auth errors, API
  // error messages) that would be written to work items as release notes.
  const preview = result.slice(0, 300).replace(/\n/g, ' ');
  throw new Error(`Release note validation failed — output contains no <h3> tags. Result preview: ${preview}`);
}

/**
 * If the text contains `<h3>`, extract from the first `<h3>` to the last
 * closing HTML tag. Returns undefined if no `<h3>` is found.
 */
function pickHtml(text: string): string | undefined {
  const start = text.indexOf('<h3>');
  if (start === -1) return undefined;

  // Find the last closing HTML tag (</p>, </ul>, </li>, etc.)
  const lastClose = text.lastIndexOf('</');
  if (lastClose === -1) return text.slice(start).trim();

  const endTag = text.indexOf('>', lastClose);
  return text.slice(start, endTag + 1).trim();
}

export function buildUserPrompt(context: ReleaseNoteContext): string {
  const lines: string[] = [
    `## Pull Request`,
    `**Title:** ${context.prTitle}`,
  ];

  if (context.prDescription) {
    lines.push(`**Description:** ${context.prDescription}`);
  }

  if (context.changedFiles.length > 0) {
    lines.push('', '## Changed Files');
    // List up to 50 files, then "and X more..."
    const shown = context.changedFiles.slice(0, 50);
    for (const f of shown) {
      lines.push(`- ${f}`);
    }
    if (context.changedFiles.length > 50) {
      lines.push(`- ...and ${context.changedFiles.length - 50} more files`);
    }
  }

  lines.push('', '## Work Item');
  lines.push(`**Type:** ${context.workItemType}`);
  lines.push(`**Title:** ${context.workItemTitle}`);
  if (context.workItemDescription) {
    lines.push(`**Description:** ${context.workItemDescription}`);
  }

  const isBug = context.workItemType.toLowerCase().includes('bug');
  lines.push('', '## Required Format');
  if (isBug) {
    lines.push('This is a **Bug Fix**. Use the Bug Fix structure: What, Where/When, Resolution.');
  } else {
    lines.push('This is a **Feature/Enhancement**. Use the Feature structure: Why, What, Impact.');
  }

  return lines.join('\n');
}
