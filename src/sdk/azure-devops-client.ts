/**
 * Azure DevOps REST API wrapper with retry support.
 */

import type {
  AppConfig,
  AzureDevOpsPullRequest,
  PRWorkItemRef,
  WorkItemResponse,
  DiffResponse,
} from '../types/index.ts';

/** Custom error for Azure DevOps API failures. */
export class AzureDevOpsError extends Error {
  override readonly name = 'AzureDevOpsError';
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * Low-level fetch wrapper that builds the ADO REST URL, adds auth headers,
 * and throws `AzureDevOpsError` on non-ok responses.
 */
export async function adoFetch<T>(
  config: AppConfig,
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${config.orgUrl}/${config.project}/_apis/${path}`;
  const authHeader =
    'Basic ' + Buffer.from(':' + config.pat).toString('base64');

  const headers: Record<string, string> = {
    Authorization: authHeader,
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> | undefined),
  };

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new AzureDevOpsError(
      `Azure DevOps API error ${res.status}: ${body}`,
      res.status,
    );
  }

  return (await res.json()) as T;
}

/** Default retry delays in milliseconds (exponential backoff). */
const DEFAULT_RETRY_DELAYS = [1000, 2000, 4000];

/**
 * Wraps `adoFetch` with exponential-backoff retry.
 *
 * - Retries on status >= 500 or network errors.
 * - Immediately re-throws 4xx errors.
 * - `retryDelays` controls the wait between attempts (default [1000, 2000, 4000]).
 */
export async function adoFetchWithRetry<T>(
  config: AppConfig,
  path: string,
  options?: RequestInit,
  retryDelays: number[] = DEFAULT_RETRY_DELAYS,
): Promise<T> {
  const maxAttempts = retryDelays.length + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await adoFetch<T>(config, path, options);
    } catch (err: unknown) {
      const isLastAttempt = attempt === maxAttempts;

      if (err instanceof AzureDevOpsError) {
        // 4xx errors are not retryable — throw immediately.
        if (err.statusCode < 500) {
          throw err;
        }
        // 5xx — retry unless this was the last attempt.
        if (isLastAttempt) {
          throw err;
        }
      } else {
        // Network / unexpected error — retry unless last attempt.
        if (isLastAttempt) {
          throw err;
        }
      }

      const delay = retryDelays[attempt - 1] ?? 0;
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  // Unreachable, but satisfies the type checker.
  throw new Error('adoFetchWithRetry: unexpected code path');
}

// ---------------------------------------------------------------------------
// Public API functions
// ---------------------------------------------------------------------------

/** List completed pull requests for a repository. */
export async function listCompletedPRs(
  config: AppConfig,
  repoId: string,
  top = 50,
): Promise<AzureDevOpsPullRequest[]> {
  const path = `git/repositories/${repoId}/pullrequests?searchCriteria.status=completed&$top=${top}&api-version=7.0`;
  const data = await adoFetchWithRetry<{ value: AzureDevOpsPullRequest[] }>(
    config,
    path,
  );
  return data.value;
}

/** Get a single pull request by ID. */
export async function getPullRequest(
  config: AppConfig,
  repoId: string,
  prId: number,
): Promise<AzureDevOpsPullRequest> {
  const path = `git/repositories/${repoId}/pullrequests/${prId}?api-version=7.0`;
  return adoFetchWithRetry<AzureDevOpsPullRequest>(config, path);
}

/** Get work item references linked to a pull request. */
export async function getPRWorkItems(
  config: AppConfig,
  repoId: string,
  prId: number,
): Promise<PRWorkItemRef[]> {
  const path = `git/repositories/${repoId}/pullrequests/${prId}/workitems?api-version=7.0`;
  const data = await adoFetchWithRetry<{ value: PRWorkItemRef[] }>(
    config,
    path,
  );
  return data.value;
}

/** Fetch a single work item by ID with all fields expanded. */
export async function getWorkItem(
  config: AppConfig,
  workItemId: number,
): Promise<WorkItemResponse> {
  const path = `wit/workitems/${workItemId}?$expand=all&api-version=7.0`;
  return adoFetchWithRetry<WorkItemResponse>(config, path);
}

/** Get the list of changed file paths between two commits. */
export async function getPRChangedFiles(
  config: AppConfig,
  repoId: string,
  baseCommit: string,
  targetCommit: string,
): Promise<string[]> {
  const path = `git/repositories/${repoId}/diffs/commits?baseVersion=${baseCommit}&targetVersion=${targetCommit}&api-version=7.0`;
  const data = await adoFetchWithRetry<DiffResponse>(config, path);
  return data.changes.map((c) => c.item.path);
}

/** Update (or add) a field on a work item using JSON Patch. */
export async function updateWorkItemField(
  config: AppConfig,
  workItemId: number,
  fieldName: string,
  value: string,
): Promise<WorkItemResponse> {
  const path = `wit/workitems/${workItemId}?api-version=7.0`;
  return adoFetchWithRetry<WorkItemResponse>(config, path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json-patch+json' },
    body: JSON.stringify([{ op: 'add', path: `/fields/${fieldName}`, value }]),
  });
}
