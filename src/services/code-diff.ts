import { createTwoFilesPatch } from 'diff';
import * as sdk from '../sdk/azure-devops-client.ts';
import type { AppConfig, DiffChange, DiffResponse } from '../types/index.ts';

/**
 * Builds the code context for a pull request: the changed file paths plus a
 * unified diff of their content. The diff is computed here from file contents,
 * because ADO's REST API has no endpoint that returns a patch.
 */

export interface PRCodeChanges {
  /** Paths of all changed files (folders excluded). */
  files: string[];
  /** Unified diff of the changed files, followed by a list of files left out. Empty when nothing changed. */
  diff: string;
}

export interface CodeDiffDeps {
  getCommitDiff: (
    config: AppConfig,
    repoId: string,
    baseCommit: string,
    targetCommit: string,
  ) => Promise<DiffResponse>;

  getFileContentAtCommit: (
    config: AppConfig,
    repoId: string,
    filePath: string,
    commitId: string,
  ) => Promise<string | null>;
}

const defaultDeps: CodeDiffDeps = {
  getCommitDiff: sdk.getCommitDiff,
  getFileContentAtCommit: sdk.getFileContentAtCommit,
};

/** Total diff characters sent to the model per work item (roughly 15k tokens). */
export const MAX_DIFF_CHARS = 60_000;

/** Cap per file, so one large file cannot crowd out the rest. */
export const MAX_FILE_DIFF_CHARS = 8_000;

/**
 * Files whose diffs say nothing about behavior: lockfiles, translation files
 * (captions are already visible in the source), and binaries. Not fetched.
 */
const SKIP_PATTERNS = [
  /(^|\/)(bun\.lock|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/i,
  /\.xlf$/i,
  /\.(png|jpe?g|gif|bmp|ico|svg|pdf|zip|dll|exe|app|nupkg|woff2?|ttf)$/i,
];

export async function getPRCodeChanges(
  config: AppConfig,
  repoId: string,
  baseCommit: string,
  targetCommit: string,
  maxChars: number = MAX_DIFF_CHARS,
  deps: CodeDiffDeps = defaultDeps,
): Promise<PRCodeChanges> {
  const data = await deps.getCommitDiff(config, repoId, baseCommit, targetCommit);
  const blobs = data.changes.filter((c) => !c.item.isFolder && c.item.gitObjectType !== 'tree');
  const oldCommit = data.commonCommit ?? baseCommit;

  const patches: string[] = [];
  const omitted: string[] = [];
  let used = 0;

  for (const change of blobs) {
    const path = change.item.path;
    if (SKIP_PATTERNS.some((p) => p.test(path))) {
      omitted.push(`${path} (lockfile, translation or binary)`);
      continue;
    }
    if (used >= maxChars) {
      omitted.push(`${path} (size limit reached)`);
      continue;
    }

    let patch: string | null;
    try {
      patch = await fileDiff(config, repoId, change, oldCommit, targetCommit, deps);
    } catch {
      omitted.push(`${path} (could not fetch)`);
      continue;
    }
    if (patch === null) {
      omitted.push(`${path} (binary)`);
      continue;
    }

    const capped = truncate(patch, Math.min(MAX_FILE_DIFF_CHARS, maxChars - used));
    patches.push(capped);
    used += capped.length;
  }

  if (omitted.length > 0) {
    patches.push(['Diff not shown for:', ...omitted.map((o) => `- ${o}`)].join('\n'));
  }

  return { files: blobs.map((c) => c.item.path), diff: patches.join('\n') };
}

/** Unified diff of one file, or `null` when either side is binary. */
async function fileDiff(
  config: AppConfig,
  repoId: string,
  change: DiffChange,
  oldCommit: string,
  newCommit: string,
  deps: CodeDiffDeps,
): Promise<string | null> {
  const type = change.changeType.toLowerCase();
  const newPath = change.item.path;
  const oldPath = change.sourceServerItem ?? newPath;

  const oldText = type.includes('add')
    ? ''
    : await deps.getFileContentAtCommit(config, repoId, oldPath, oldCommit);
  const newText = type.includes('delete')
    ? ''
    : await deps.getFileContentAtCommit(config, repoId, newPath, newCommit);
  if (oldText === null || newText === null) return null;

  // Drop the "Index:" and "=====" lines jsdiff puts first; the ---/+++ headers suffice.
  return createTwoFilesPatch(oldPath, newPath, oldText, newText, undefined, undefined, { context: 3 })
    .replace(/^(Index: .*\n)?=+\n/, '');
}

/** Cut a patch at a line boundary within `limit` characters. */
function truncate(patch: string, limit: number): string {
  if (patch.length <= limit) return patch;
  const cut = patch.lastIndexOf('\n', limit);
  return `${patch.slice(0, cut > 0 ? cut : limit)}\n... (diff truncated)\n`;
}
