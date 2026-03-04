import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { AppConfig, AzureDevOpsPullRequest } from '../../src/types/index.ts';
import { runPollCycle } from '../../src/services/watcher.ts';
import type { WatcherDeps } from '../../src/services/watcher.ts';
import { StateStore } from '../../src/state/state-store.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    org: 'my-org',
    orgUrl: 'https://dev.azure.com/my-org',
    project: 'my-project',
    pat: 'test-pat-token',
    repoIds: ['repo-1'],
    releaseNotesField: 'Custom.ReleaseNotes',
    pollIntervalMinutes: 5,
    claudeModel: 'claude-sonnet-4-20250514',
    releaseNotePromptPath: './prompt.md',
    stateDir: '.state',
    dryRun: false,
    assignedToFilter: null,
    ...overrides,
  };
}

function mockPR(overrides: Partial<AzureDevOpsPullRequest> = {}): AzureDevOpsPullRequest {
  return {
    pullRequestId: 42,
    title: 'Add new feature',
    description: 'Adds a great new feature to the system',
    status: 'completed',
    creationDate: '2025-01-01T00:00:00Z',
    closedDate: '2099-01-01T00:00:00Z', // far future so date filter doesn't skip it
    sourceRefName: 'refs/heads/feature/new-feature',
    targetRefName: 'refs/heads/main',
    lastMergeSourceCommit: { commitId: 'source-commit-abc' },
    lastMergeTargetCommit: { commitId: 'target-commit-def' },
    repository: { id: 'repo-1', name: 'my-repo' },
    ...overrides,
  };
}

function makeDeps(overrides: Partial<WatcherDeps> = {}): WatcherDeps {
  return {
    listCompletedPRs: mock(() => Promise.resolve([])),
    processPR: mock(() =>
      Promise.resolve({ prId: 0, processed: 0, skipped: 0, errors: 0 }),
    ),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runPollCycle', () => {
  let tmpDir: string;
  let stateStore: StateStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'watcher-test-'));
    stateStore = new StateStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('no new PRs returns all zeros and nothing processed', async () => {
    const config = mockConfig();
    const deps = makeDeps({
      listCompletedPRs: mock(() => Promise.resolve([])),
    });

    const result = await runPollCycle(config, stateStore, deps);

    expect(result).toEqual({ processed: 0, skipped: 0, errors: 0 });
    expect(deps.listCompletedPRs).toHaveBeenCalledTimes(1);
    expect(deps.processPR).toHaveBeenCalledTimes(0);
  });

  test('new PR found calls processPR, marks as processed, and saves state', async () => {
    const config = mockConfig();
    const pr = mockPR({ pullRequestId: 101 });

    const deps = makeDeps({
      listCompletedPRs: mock(() => Promise.resolve([pr])),
      processPR: mock(() =>
        Promise.resolve({ prId: 101, processed: 1, skipped: 0, errors: 0 }),
      ),
    });

    const result = await runPollCycle(config, stateStore, deps);

    expect(result).toEqual({ processed: 1, skipped: 0, errors: 0 });
    expect(deps.processPR).toHaveBeenCalledTimes(1);
    expect(stateStore.isProcessed(101)).toBe(true);

    // Verify state was persisted (reload from disk)
    const reloadedStore = new StateStore(tmpDir);
    expect(reloadedStore.isProcessed(101)).toBe(true);
  });

  test('already processed PR is filtered out and not passed to processPR', async () => {
    const config = mockConfig();
    const pr = mockPR({ pullRequestId: 200 });

    // Pre-mark PR as processed
    stateStore.markProcessed(200);
    stateStore.save();

    const deps = makeDeps({
      listCompletedPRs: mock(() => Promise.resolve([pr])),
    });

    const result = await runPollCycle(config, stateStore, deps);

    expect(result).toEqual({ processed: 0, skipped: 0, errors: 0 });
    expect(deps.processPR).toHaveBeenCalledTimes(0);
  });

  test('processPR throws: PR not marked as processed, error counted', async () => {
    const config = mockConfig();
    const pr = mockPR({ pullRequestId: 300 });

    const deps = makeDeps({
      listCompletedPRs: mock(() => Promise.resolve([pr])),
      processPR: mock(() => Promise.reject(new Error('Fatal processing error'))),
    });

    const result = await runPollCycle(config, stateStore, deps);

    expect(result).toEqual({ processed: 0, skipped: 0, errors: 1 });
    // PR should NOT be marked as processed so it retries next cycle
    expect(stateStore.isProcessed(300)).toBe(false);
  });

  test('PR with errors in result is not marked as processed', async () => {
    const config = mockConfig();
    const pr = mockPR({ pullRequestId: 400 });

    const deps = makeDeps({
      listCompletedPRs: mock(() => Promise.resolve([pr])),
      processPR: mock(() =>
        Promise.resolve({ prId: 400, processed: 0, skipped: 0, errors: 1 }),
      ),
    });

    const result = await runPollCycle(config, stateStore, deps);

    expect(result).toEqual({ processed: 0, skipped: 0, errors: 1 });
    // PR should NOT be marked as processed because errors > 0
    expect(stateStore.isProcessed(400)).toBe(false);
  });

  test('PR closed before lastRunAt is filtered out as historical', async () => {
    const config = mockConfig();
    // PR was closed in the past (before the state store seeded "now")
    const pr = mockPR({ pullRequestId: 600, closedDate: '2020-01-01T00:00:00Z' });

    const deps = makeDeps({
      listCompletedPRs: mock(() => Promise.resolve([pr])),
    });

    const result = await runPollCycle(config, stateStore, deps);

    expect(result).toEqual({ processed: 0, skipped: 0, errors: 0 });
    // Should never call processPR for historical PRs
    expect(deps.processPR).toHaveBeenCalledTimes(0);
  });

  test('multiple repos polls each one', async () => {
    const config = mockConfig({ repoIds: ['repo-a', 'repo-b', 'repo-c'] });

    const prA = mockPR({
      pullRequestId: 501,
      repository: { id: 'repo-a', name: 'repo-a' },
    });
    const prB = mockPR({
      pullRequestId: 502,
      repository: { id: 'repo-b', name: 'repo-b' },
    });

    const listMock = mock((cfg: AppConfig, repoId: string) => {
      if (repoId === 'repo-a') return Promise.resolve([prA]);
      if (repoId === 'repo-b') return Promise.resolve([prB]);
      return Promise.resolve([]); // repo-c has none
    });

    const deps = makeDeps({
      listCompletedPRs: listMock,
      processPR: mock(() =>
        Promise.resolve({ prId: 0, processed: 1, skipped: 0, errors: 0 }),
      ),
    });

    const result = await runPollCycle(config, stateStore, deps);

    expect(result).toEqual({ processed: 2, skipped: 0, errors: 0 });
    // listCompletedPRs should have been called once per repo
    expect(deps.listCompletedPRs).toHaveBeenCalledTimes(3);
    // processPR called for the 2 PRs found (repo-c had none)
    expect(deps.processPR).toHaveBeenCalledTimes(2);
    // Both PRs should be marked as processed
    expect(stateStore.isProcessed(501)).toBe(true);
    expect(stateStore.isProcessed(502)).toBe(true);
  });
});
