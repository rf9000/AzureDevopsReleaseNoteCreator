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
    fields: Array<{ fieldName: string; value: string; op?: 'add' | 'replace' }>,
  ) => Promise<WorkItemResponse>;

  addWorkItemComment: (
    config: AppConfig,
    workItemId: number,
    commentHtml: string,
  ) => Promise<void>;

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
  addWorkItemComment: sdk.addWorkItemComment,
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

/** Which processing phase failed, used to pick the failure-comment wording. */
export type FailureCategory = 'generate' | 'save';

/** Short, friendly HTML failure-comment text, keyed by category. */
const FAILURE_COMMENT: Record<FailureCategory, string> = {
  generate:
    "⚠️ <b>Release-note tool couldn't generate a release note here.</b><br/>It will retry automatically on the next poll.",
  save:
    "⚠️ <b>Release-note tool generated a note but couldn't save it to this work item</b> — likely a permissions or state issue.<br/>It will retry automatically.",
};

/**
 * Apostrophe-free, category-specific substring present in each comment above.
 * Used to detect an already-posted failure comment so it is not re-posted every
 * poll. Apostrophe-free so the match is robust to however ADO renders the text.
 */
const FAILURE_SIGNATURE: Record<FailureCategory, string> = {
  generate: 'generate a release note',
  save: 'save it to this work item',
};

/**
 * Post a one-time failure comment on a work item. Scans existing comments for
 * this category's signature and skips if it is already present, so a
 * persistently failing item (whose tag is kept for retry) is not commented on
 * every poll. Skips entirely in dry-run. Never throws — failing to comment must
 * not mask the original processing error.
 */
async function postFailureCommentOnce(
  config: AppConfig,
  workItemId: number,
  category: FailureCategory,
  deps: WorkItemProcessorDeps,
): Promise<void> {
  if (config.dryRun) {
    log(`  WI #${workItemId}: [DRY RUN] would post failure comment (${category})`);
    return;
  }

  const signature = FAILURE_SIGNATURE[category].toLowerCase();
  let existing: string[];
  try {
    existing = await deps.getWorkItemComments(config, workItemId);
  } catch (err) {
    log(`  WI #${workItemId}: Warning — could not read comments to post failure notice: ${err}`);
    return;
  }

  if (existing.some((c) => c.toLowerCase().includes(signature))) {
    log(`  WI #${workItemId}: Failure comment already present (${category})`);
    return;
  }

  try {
    await deps.addWorkItemComment(config, workItemId, FAILURE_COMMENT[category]);
    log(`  WI #${workItemId}: Posted failure comment (${category})`);
  } catch (err) {
    log(`  WI #${workItemId}: Warning — could not post failure comment: ${err}`);
  }
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

  let failureCategory: FailureCategory = 'generate';

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

    // System.Tags MUST use op 'replace': 'add' unions the value with the existing
    // tags, so it can never remove the release-note tag.
    const fields: Array<{ fieldName: string; value: string; op?: 'add' | 'replace' }> = [
      { fieldName: config.releaseNotesField, value: finalNote },
      { fieldName: 'System.Tags', value: newTags, op: 'replace' },
      { fieldName: 'Custom.Version', value: versionValue },
    ];

    // Everything past this point is the ADO write phase.
    failureCategory = 'save';

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
    // Tell the human on the work item why nothing happened (once per category);
    // the tag is left in place so the item is retried on the next scan.
    await postFailureCommentOnce(config, workItemId, failureCategory, deps);
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
