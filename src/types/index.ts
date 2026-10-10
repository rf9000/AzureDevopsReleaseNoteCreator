/**
 * Shared TypeScript types for AzureDevopsReleaseNoteCreator.
 */

/** Application configuration loaded from environment / config file. */
export interface AppConfig {
  org: string;
  orgUrl: string;
  project: string;
  pat: string;
  repoIds: string[];
  releaseNotesField: string;
  pollIntervalMinutes: number;
  claudeModel: string;
  releaseNotePromptPath: string;
  stateDir: string;
  dryRun: boolean;
  /** If set, only process work items assigned to this display name. */
  assignedToFilter: string | null;
  /** Number of days to look back for completed PRs (default 7). */
  lookbackDays: number;
  /** Work item tag that requests release-note generation (default 'create-releasenote'). */
  releaseNoteTag: string;
}

/** Shape returned by the Azure DevOps Pull Request API. */
export interface AzureDevOpsPullRequest {
  pullRequestId: number;
  title: string;
  description: string;
  status: string;
  creationDate: string;
  closedDate: string;
  sourceRefName: string;
  targetRefName: string;
  lastMergeSourceCommit: { commitId: string };
  lastMergeTargetCommit: { commitId: string };
  repository: { id: string; name: string };
}

/** Reference to a work item linked to a pull request. */
export interface PRWorkItemRef {
  id: string;
  url: string;
}

/** A relation (link) on a work item, e.g. an ArtifactLink to a pull request. */
export interface WorkItemRelation {
  rel: string;
  url: string;
  attributes?: { name?: string; [key: string]: unknown };
}

/** Response shape when fetching a single work item. */
export interface WorkItemResponse {
  id: number;
  fields: Record<string, unknown>;
  rev: number;
  url: string;
  /** Present when the work item is fetched with `$expand=all` / `$expand=relations`. */
  relations?: WorkItemRelation[];
}

/** A single change entry inside a diff response. */
export interface DiffChange {
  item: { path: string; gitObjectType?: string; isFolder?: boolean };
  /** e.g. 'add', 'edit', 'delete', 'rename', 'edit, rename'. */
  changeType: string;
  /** Previous path of a renamed file. */
  sourceServerItem?: string;
}

/** Response shape for a commit diff query. */
export interface DiffResponse {
  changes: DiffChange[];
  /** Merge base of the two commits; ADO computes the diff from here, as a PR does. */
  commonCommit?: string;
}

/** Response shape when fetching a single file from a repository with its content. */
export interface GitItemResponse {
  path: string;
  content?: string;
  contentMetadata?: { isBinary?: boolean };
}

/** Persisted state tracking which PRs have already been processed. */
export interface ProcessedState {
  processedPRIds: number[];
  failedPRIds: number[];
  lastRunAt: string;
  /** When each work item last got a release note written (ISO), by work item id. Read by the monitor dashboard. */
  writtenAt?: Record<string, string>;
  /** Solution of each work item with a written release note, by work item id. Read by the monitor dashboard. */
  writtenProduct?: Record<string, string>;
}

/** A work item that got a real release note (not the internal-only marker). */
export interface WrittenNote {
  workItemId: number;
  /** Solution from the work item's area path, e.g. "Continia Banking". */
  solution: string | null;
}

/** Result summary after processing a single pull request. */
export interface PRProcessResult {
  prId: number;
  processed: number;
  skipped: number;
  errors: number;
  written?: WrittenNote[];
}
