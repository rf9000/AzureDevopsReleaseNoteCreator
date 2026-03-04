import { readFileSync } from 'fs';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { AppConfig } from '../types/index.ts';

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
  let result: string | undefined;

  for await (const message of query({
    prompt: userPrompt,
    options: {
      model: config.claudeModel,
      maxTurns: 1,
      allowedTools: [],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      systemPrompt,
    },
  })) {
    if (message.type === 'result' && message.subtype === 'success') {
      result = message.result;
    }
  }

  // 5. Return the result text, trimmed
  if (result === undefined) {
    throw new Error('No result received from Claude Agent SDK');
  }

  return result.trim();
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
