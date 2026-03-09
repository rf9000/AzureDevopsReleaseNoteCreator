/**
 * Core business logic: process a single PR, find linked work items,
 * generate release notes via Claude, and patch work items.
 *
 * Uses dependency injection so tests can supply mock implementations
 * without touching module resolution.
 */

import type {
  AppConfig,
  AzureDevOpsPullRequest,
  PRProcessResult,
  PRWorkItemRef,
  WorkItemResponse,
} from '../types/index.ts';
import type { ReleaseNoteContext } from './release-note-generator.ts';

import * as sdk from '../sdk/azure-devops-client.ts';
import * as gen from './release-note-generator.ts';

// ---------------------------------------------------------------------------
// Dependency injection interface
// ---------------------------------------------------------------------------

export interface PRProcessorDeps {
  getPRWorkItems: (
    config: AppConfig,
    repoId: string,
    prId: number,
  ) => Promise<PRWorkItemRef[]>;

  getWorkItem: (
    config: AppConfig,
    workItemId: number,
  ) => Promise<WorkItemResponse>;

  getPRChangedFiles: (
    config: AppConfig,
    repoId: string,
    baseCommit: string,
    targetCommit: string,
  ) => Promise<string[]>;

  updateWorkItemField: (
    config: AppConfig,
    workItemId: number,
    fieldName: string,
    value: string,
  ) => Promise<WorkItemResponse>;

  generateReleaseNote: (
    config: AppConfig,
    context: ReleaseNoteContext,
  ) => Promise<string>;
}

/** Default production dependencies wired to the real modules. */
const defaultDeps: PRProcessorDeps = {
  getPRWorkItems: sdk.getPRWorkItems,
  getWorkItem: sdk.getWorkItem,
  getPRChangedFiles: sdk.getPRChangedFiles,
  updateWorkItemField: sdk.updateWorkItemField,
  generateReleaseNote: gen.generateReleaseNote,
};

// ---------------------------------------------------------------------------
// Logging helper
// ---------------------------------------------------------------------------

function log(message: string): void {
  const ts = new Date(Date.now() + 3600000).toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] ${message}`);
}

// ---------------------------------------------------------------------------
// Main processor
// ---------------------------------------------------------------------------

export async function processPR(
  config: AppConfig,
  pr: AzureDevOpsPullRequest,
  deps: PRProcessorDeps = defaultDeps,
): Promise<PRProcessResult> {
  const result: PRProcessResult = {
    prId: pr.pullRequestId,
    processed: 0,
    skipped: 0,
    errors: 0,
  };

  log(`Processing PR #${pr.pullRequestId}: ${pr.title}`);

  // 1. Get linked work items
  const workItemRefs = await deps.getPRWorkItems(
    config,
    pr.repository.id,
    pr.pullRequestId,
  );

  if (workItemRefs.length === 0) {
    log(`  PR #${pr.pullRequestId}: No linked work items, skipping`);
    return result;
  }

  // 2. Get changed files (for context — failure is non-fatal)
  let changedFiles: string[] = [];
  try {
    changedFiles = await deps.getPRChangedFiles(
      config,
      pr.repository.id,
      pr.lastMergeTargetCommit.commitId,
      pr.lastMergeSourceCommit.commitId,
    );
  } catch (err) {
    log(
      `  PR #${pr.pullRequestId}: Warning — could not fetch changed files: ${err}`,
    );
    // Continue without changed files — they're just extra context
  }

  // 3. For each work item
  for (const ref of workItemRefs) {
    const workItemId = Number(ref.id);
    try {
      // 3a. Get the full work item
      const workItem = await deps.getWorkItem(config, workItemId);

      // 3b. Check assigned-to filter (safeguard)
      if (config.assignedToFilter) {
        const assignedTo = workItem.fields['System.AssignedTo'] as
          | { displayName?: string }
          | undefined;
        const displayName = assignedTo?.displayName ?? '';
        const allowedNames = config.assignedToFilter.split(',').map((n) => n.trim());
        if (displayName !== '' && !allowedNames.includes(displayName)) {
          log(
            `  WI #${workItemId}: Assigned to "${displayName}", not in "${config.assignedToFilter}", skipping`,
          );
          result.skipped++;
          continue;
        }
      }

      // 3c. Check if release notes field is already populated
      const existingNotes = workItem.fields[config.releaseNotesField];
      if (existingNotes && String(existingNotes).trim() !== '') {
        log(`  WI #${workItemId}: Release notes already exist, skipping`);
        result.skipped++;
        continue;
      }

      // 3d. Build context and generate release note
      const workItemTitle = String(workItem.fields['System.Title'] ?? '');
      const workItemType = String(
        workItem.fields['System.WorkItemType'] ?? '',
      );
      const workItemDescription = String(
        workItem.fields['System.Description'] ?? '',
      );

      const context: ReleaseNoteContext = {
        prTitle: pr.title,
        prDescription: pr.description ?? '',
        changedFiles,
        workItemTitle,
        workItemType,
        workItemDescription,
      };

      log(`  WI #${workItemId}: Generating release note...`);
      const releaseNote = await deps.generateReleaseNote(config, context);

      if (config.dryRun) {
        log(`  WI #${workItemId}: [DRY RUN] Generated:\n    "${releaseNote}"`);
        result.processed++;
        continue;
      }

      // 3e. Update the work item
      await deps.updateWorkItemField(
        config,
        workItemId,
        config.releaseNotesField,
        releaseNote,
      );
      log(`  WI #${workItemId}: Release note written`);
      result.processed++;
    } catch (err) {
      log(`  WI #${workItemId}: Error — ${err}`);
      result.errors++;
      // Continue with other work items
    }
  }

  return result;
}
