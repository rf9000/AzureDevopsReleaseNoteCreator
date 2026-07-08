/**
 * Tag-driven release-note flow: the reverse of `pr-processor`.
 *
 * A person tags a work item with the configured release-note tag (default
 * `create-releasenote`) to explicitly request a note. This module finds those
 * work items, gathers context from the work item itself and any related pull
 * requests (descriptions, comments, changed files), generates a note, APPENDS
 * it to any existing note, and removes the tag so the item is not reprocessed.
 *
 * Uses dependency injection so tests can supply mock implementations.
 */

import type {
  AppConfig,
  AzureDevOpsPullRequest,
  WorkItemRelation,
  WorkItemResponse,
} from '../types/index.ts';
import type { ReleaseNoteContext } from './release-note-generator.ts';

import * as sdk from '../sdk/azure-devops-client.ts';
import * as gen from './release-note-generator.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Divider inserted between an existing release note and an appended one. */
export const RELEASE_NOTE_SEPARATOR = '\n<hr />\n';

/** Prefix of a work-item ArtifactLink that points at a pull request. */
const PR_ARTIFACT_PREFIX = 'vstfs:///Git/PullRequestId/';

// ---------------------------------------------------------------------------
// Dependency injection interface
// ---------------------------------------------------------------------------

export interface WorkItemProcessorDeps {
  getWorkItem: (
    config: AppConfig,
    workItemId: number,
  ) => Promise<WorkItemResponse>;

  getWorkItemComments: (
    config: AppConfig,
    workItemId: number,
  ) => Promise<string[]>;

  getPullRequest: (
    config: AppConfig,
    repoId: string,
    prId: number,
  ) => Promise<AzureDevOpsPullRequest>;

  getPRChangedFiles: (
    config: AppConfig,
    repoId: string,
    baseCommit: string,
    targetCommit: string,
  ) => Promise<string[]>;

  getPRThreadComments: (
    config: AppConfig,
    repoId: string,
    prId: number,
  ) => Promise<string[]>;

  updateWorkItemFields: (
    config: AppConfig,
    workItemId: number,
    fields: Array<{ fieldName: string; value: string }>,
  ) => Promise<WorkItemResponse>;

  generateReleaseNote: (
    config: AppConfig,
    context: ReleaseNoteContext,
  ) => Promise<string>;

  queryWorkItemsByTag: (
    config: AppConfig,
    tag: string,
  ) => Promise<number[]>;
}

/** Default production dependencies wired to the real modules. */
const defaultDeps: WorkItemProcessorDeps = {
  getWorkItem: sdk.getWorkItem,
  getWorkItemComments: sdk.getWorkItemComments,
  getPullRequest: sdk.getPullRequest,
  getPRChangedFiles: sdk.getPRChangedFiles,
  getPRThreadComments: sdk.getPRThreadComments,
  updateWorkItemFields: sdk.updateWorkItemFields,
  generateReleaseNote: gen.generateReleaseNote,
  queryWorkItemsByTag: sdk.queryWorkItemsByTag,
};

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface WorkItemProcessResult {
  workItemId: number;
  processed: number;
  skipped: number;
  errors: number;
}

// ---------------------------------------------------------------------------
// Logging helper
// ---------------------------------------------------------------------------

function log(message: string): void {
  const ts = new Date(Date.now() + 3600000).toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] ${message}`);
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested directly)
// ---------------------------------------------------------------------------

/** A pull request referenced from a work item's relations. */
export interface PullRequestRef {
  repoId: string;
  prId: number;
}

/**
 * Extract pull-request references from a work item's `relations`. A linked PR
 * appears as an `ArtifactLink` whose URL is
 * `vstfs:///Git/PullRequestId/{projectId}%2F{repoId}%2F{prId}`.
 */
export function parsePullRequestRefs(
  relations: WorkItemRelation[] | undefined,
): PullRequestRef[] {
  if (!relations) return [];
  const refs: PullRequestRef[] = [];
  for (const rel of relations) {
    if (rel.rel !== 'ArtifactLink') continue;
    if (!rel.url.startsWith(PR_ARTIFACT_PREFIX)) continue;
    const encoded = rel.url.slice(PR_ARTIFACT_PREFIX.length);
    const parts = decodeURIComponent(encoded).split('/');
    // parts = [projectId, repoId, prId]
    if (parts.length < 3) continue;
    const repoId = parts[1]!;
    const prId = Number(parts[2]);
    if (!repoId || Number.isNaN(prId)) continue;
    refs.push({ repoId, prId });
  }
  return refs;
}

/**
 * Remove a tag from a semicolon-separated `System.Tags` string (case-insensitive
 * on the tag name), preserving the remaining tags joined with `'; '`.
 */
export function removeTag(tagsField: string | undefined, tag: string): string {
  if (!tagsField) return '';
  const target = tag.trim().toLowerCase();
  return tagsField
    .split(';')
    .map((t) => t.trim())
    .filter((t) => t !== '' && t.toLowerCase() !== target)
    .join('; ');
}

/** Append a newly generated note to an existing one, or return it alone if none exists. */
export function appendNote(existing: string, note: string): string {
  if (existing.trim() === '') return note;
  return existing + RELEASE_NOTE_SEPARATOR + note;
}

// ---------------------------------------------------------------------------
// Context gathering
// ---------------------------------------------------------------------------

/**
 * Fetch and aggregate context from every related pull request. The first PR
 * becomes the primary (title/description/changed files); further PRs are folded
 * into `additionalPrDescriptions`. All comments and changed files are merged.
 * Per-PR fetch failures are non-fatal.
 */
async function gatherPRContext(
  config: AppConfig,
  refs: PullRequestRef[],
  deps: WorkItemProcessorDeps,
): Promise<{
  prTitle: string;
  prDescription: string;
  changedFiles: string[];
  prComments: string[];
  additionalPrDescriptions: string[];
}> {
  let prTitle = '';
  let prDescription = '';
  const changedFiles: string[] = [];
  const prComments: string[] = [];
  const additionalPrDescriptions: string[] = [];

  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i]!;
    try {
      const pr = await deps.getPullRequest(config, ref.repoId, ref.prId);

      if (i === 0) {
        prTitle = pr.title;
        prDescription = pr.description ?? '';
      } else {
        const desc = pr.description ? `: ${pr.description}` : '';
        additionalPrDescriptions.push(`${pr.title}${desc}`);
      }

      try {
        const files = await deps.getPRChangedFiles(
          config,
          ref.repoId,
          pr.lastMergeTargetCommit.commitId,
          pr.lastMergeSourceCommit.commitId,
        );
        changedFiles.push(...files);
      } catch (err) {
        log(`    PR #${ref.prId}: Warning — could not fetch changed files: ${err}`);
      }

      try {
        const comments = await deps.getPRThreadComments(config, ref.repoId, ref.prId);
        prComments.push(...comments);
      } catch (err) {
        log(`    PR #${ref.prId}: Warning — could not fetch comments: ${err}`);
      }
    } catch (err) {
      log(`    PR #${ref.prId}: Warning — could not fetch pull request: ${err}`);
    }
  }

  return { prTitle, prDescription, changedFiles, prComments, additionalPrDescriptions };
}

// ---------------------------------------------------------------------------
// Main processor
// ---------------------------------------------------------------------------

export async function processTaggedWorkItem(
  config: AppConfig,
  workItem: WorkItemResponse,
  deps: WorkItemProcessorDeps = defaultDeps,
): Promise<WorkItemProcessResult> {
  const workItemId = workItem.id;
  const result: WorkItemProcessResult = {
    workItemId,
    processed: 0,
    skipped: 0,
    errors: 0,
  };

  const workItemTitle = String(workItem.fields['System.Title'] ?? '');
  log(`Processing tagged WI #${workItemId}: ${workItemTitle}`);

  try {
    // 1. Gather related-PR context (may be none)
    const refs = parsePullRequestRefs(workItem.relations);
    log(`  WI #${workItemId}: ${refs.length} related pull request(s)`);
    const prContext = await gatherPRContext(config, refs, deps);

    // 2. Gather work item comments (non-fatal on failure)
    let workItemComments: string[] = [];
    try {
      workItemComments = await deps.getWorkItemComments(config, workItemId);
    } catch (err) {
      log(`  WI #${workItemId}: Warning — could not fetch comments: ${err}`);
    }

    // 3. Build context and generate
    const context: ReleaseNoteContext = {
      prTitle: prContext.prTitle,
      prDescription: prContext.prDescription,
      changedFiles: prContext.changedFiles,
      workItemTitle,
      workItemType: String(workItem.fields['System.WorkItemType'] ?? ''),
      workItemDescription: String(workItem.fields['System.Description'] ?? ''),
      workItemComments,
      prComments: prContext.prComments,
      additionalPrDescriptions: prContext.additionalPrDescriptions,
    };

    log(`  WI #${workItemId}: Generating release note...`);
    const note = await deps.generateReleaseNote(config, context);

    if (config.dryRun) {
      log(`  WI #${workItemId}: [DRY RUN] Generated (tag NOT removed):\n    "${note}"`);
      result.processed++;
      return result;
    }

    // 4. Compute appended note + tag removal, preserving Custom.Version.
    const existingNote = String(workItem.fields[config.releaseNotesField] ?? '');
    const finalNote = appendNote(existingNote, note);
    const newTags = removeTag(
      String(workItem.fields['System.Tags'] ?? ''),
      config.releaseNoteTag,
    );
    const version = workItem.fields['Custom.Version'] as string | undefined;
    const versionValue = version ?? 'No selection made';
    const state = String(workItem.fields['System.State'] ?? '');
    log(`  WI #${workItemId}: State="${state}", Version="${version}"`);

    const fields: Array<{ fieldName: string; value: string }> = [
      { fieldName: config.releaseNotesField, value: finalNote },
      { fieldName: 'System.Tags', value: newTags },
      { fieldName: 'Custom.Version', value: versionValue },
    ];

    if (state === 'Closed') {
      // Closed work items can't be edited directly — reopen to Resolved first.
      log(`  WI #${workItemId}: Reopening to Resolved to allow editing...`);
      await deps.updateWorkItemFields(config, workItemId, [
        { fieldName: 'System.State', value: 'Resolved' },
        { fieldName: 'Custom.Version', value: versionValue },
      ]);
      await deps.updateWorkItemFields(config, workItemId, [
        ...fields,
        { fieldName: 'System.State', value: 'Closed' },
      ]);
      log(`  WI #${workItemId}: Release note appended, tag removed, work item re-closed`);
    } else {
      await deps.updateWorkItemFields(config, workItemId, fields);
      log(`  WI #${workItemId}: Release note appended, tag removed`);
    }

    result.processed++;
  } catch (err) {
    log(`  WI #${workItemId}: Error — ${err}`);
    result.errors++;
    // Tag is left in place so the item is retried on the next scan.
  }

  return result;
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

export async function scanTaggedWorkItems(
  config: AppConfig,
  deps: WorkItemProcessorDeps = defaultDeps,
): Promise<{ processed: number; skipped: number; errors: number }> {
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  const ids = await deps.queryWorkItemsByTag(config, config.releaseNoteTag);
  log(`Tag scan: ${ids.length} work item(s) tagged "${config.releaseNoteTag}"`);

  for (const id of ids) {
    try {
      const workItem = await deps.getWorkItem(config, id);
      const result = await processTaggedWorkItem(config, workItem, deps);
      processed += result.processed;
      skipped += result.skipped;
      errors += result.errors;
    } catch (err) {
      log(`  WI #${id}: Fatal error — ${err}`);
      errors++;
    }
  }

  return { processed, skipped, errors };
}
