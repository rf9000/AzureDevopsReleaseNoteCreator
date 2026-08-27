import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { AppConfig } from '../types/index.ts';

/**
 * A line consisting solely of `@<path>` — the same file-reference syntax Claude
 * Code expands in skill/slash-command files. The prompt file is shared between
 * the `/do-generate-release-note` skill and this app, so the app has to expand
 * those references itself when it uses the file as a system prompt.
 */
const INCLUDE_LINE = /^@(\S+)\s*$/;

/**
 * Read the system prompt file and inline every `@path` include line with the
 * referenced file's content. Paths are resolved relative to `rootDir` (the
 * project root, matching Claude Code's `@` semantics), not the prompt file.
 * Throws if a referenced file does not exist — silently sending "@path" to the
 * model would produce a note written without the style guide.
 */
export function loadSystemPrompt(promptPath: string, rootDir: string = process.cwd()): string {
  const raw = readFileSync(promptPath, 'utf-8');
  return raw
    .split('\n')
    .map((line) => {
      const match = line.match(INCLUDE_LINE);
      if (!match) return line;
      const includePath = resolve(rootDir, match[1]!);
      if (!existsSync(includePath)) {
        throw new Error(`Release note prompt "${promptPath}" includes "${match[1]}" but it was not found at ${includePath}`);
      }
      return readFileSync(includePath, 'utf-8').replace(/\r?\n$/, '');
    })
    .join('\n');
}

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
  /** Comments on the work item (tag-driven flow). Optional; omitted from the prompt when absent. */
  workItemComments?: string[];
  /** Human comments from related pull requests (tag-driven flow). Optional. */
  prComments?: string[];
  /** Titles/descriptions of additional related pull requests beyond the primary one. Optional. */
  additionalPrDescriptions?: string[];
}

export async function generateReleaseNote(
  config: AppConfig,
  context: ReleaseNoteContext,
): Promise<string> {
  // 1. Read system prompt from config.releaseNotePromptPath, expanding @includes
  const systemPrompt = loadSystemPrompt(config.releaseNotePromptPath);

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
        const cost = 'total_cost_usd' in message ? (message as { total_cost_usd: number }).total_cost_usd : undefined;
        const usage = 'usage' in message ? (message as { usage: { input_tokens?: number; output_tokens?: number } }).usage : undefined;
        const turns = 'num_turns' in message ? (message as { num_turns: number }).num_turns : undefined;
        const modelUsage = 'modelUsage' in message ? (message as { modelUsage: Record<string, unknown> }).modelUsage : undefined;
        const models = modelUsage ? Object.keys(modelUsage).join(', ') : config.claudeModel;
        if (cost !== undefined || usage || turns !== undefined) {
          log(`    Model: ${models} | Cost: $${(cost ?? 0).toFixed(4)} | ${usage?.input_tokens ?? 0} in / ${usage?.output_tokens ?? 0} out | ${turns ?? 0} turns`);
        }

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
 * is just a conversational summary (no HTML), fall back to earlier assistant
 * messages that contain actual HTML.
 */
export function extractHtml(result: string, assistantTexts: string[]): string {
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
  throw new Error(`Release note validation failed — output contains no HTML tags. Result preview: ${preview}`);
}

/**
 * Block-level tag that marks the start of the HTML release note. The note is
 * header-free flowing prose (typically `<p>`/`<ul>`), but headings are still
 * accepted so older notes keep extracting cleanly.
 */
const HTML_START_TAG = /<(?:h[1-6]|p|ul|ol)\b[^>]*>/i;

/**
 * If the text contains a block-level HTML tag, extract from the first such tag
 * to the last closing HTML tag. Returns undefined if no HTML is found.
 */
function pickHtml(text: string): string | undefined {
  const match = text.match(HTML_START_TAG);
  if (!match || match.index === undefined) return undefined;
  const start = match.index;

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

  if (context.additionalPrDescriptions && context.additionalPrDescriptions.length > 0) {
    lines.push('', '## Additional Pull Requests');
    for (const d of context.additionalPrDescriptions) {
      lines.push(`- ${d}`);
    }
  }

  if (context.prComments && context.prComments.length > 0) {
    lines.push('', '## Pull Request Comments');
    for (const c of context.prComments) {
      lines.push(`- ${c}`);
    }
  }

  lines.push('', '## Work Item');
  lines.push(`**Type:** ${context.workItemType}`);
  lines.push(`**Title:** ${context.workItemTitle}`);
  if (context.workItemDescription) {
    lines.push(`**Description:** ${context.workItemDescription}`);
  }

  if (context.workItemComments && context.workItemComments.length > 0) {
    lines.push('', '## Work Item Comments');
    for (const c of context.workItemComments) {
      lines.push(`- ${c}`);
    }
  }

  const isBug = context.workItemType.toLowerCase().includes('bug');
  lines.push('', '## Required Format');
  if (isBug) {
    lines.push(
      'This is a **Bug Fix**. Write header-free flowing-prose HTML, at most three sentences and 50 words of ' +
        'prose: the problem and where/when it occurred in the past tense (include the error message only if ' +
        'its exact text is in the context), then the fix in the present tense ("This has been fixed…").',
    );
  } else {
    lines.push(
      'This is a **Feature/Enhancement**. Write header-free flowing-prose HTML, one or two sentences (at ' +
        'most three, at most 50 words) stating the new user-visible behavior. Do not add a "Previously, …" ' +
        'contrast unless the old behavior cannot be inferred from the new one.',
    );
  }

  return lines.join('\n');
}
