import { describe, test, expect, mock } from 'bun:test';
import type { AppConfig, AzureDevOpsPullRequest } from '../../src/types/index.ts';
import { processPR } from '../../src/services/pr-processor.ts';
import type { PRProcessorDeps } from '../../src/services/pr-processor.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockConfig(): AppConfig {
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
  };
}

function mockPR(overrides: Partial<AzureDevOpsPullRequest> = {}): AzureDevOpsPullRequest {
  return {
    pullRequestId: 42,
    title: 'Add new feature',
    description: 'Adds a great new feature to the system',
    status: 'completed',
    creationDate: '2025-01-01T00:00:00Z',
    closedDate: '2025-01-02T00:00:00Z',
    sourceRefName: 'refs/heads/feature/new-feature',
    targetRefName: 'refs/heads/main',
    lastMergeSourceCommit: { commitId: 'source-commit-abc' },
    lastMergeTargetCommit: { commitId: 'target-commit-def' },
    repository: { id: 'repo-1', name: 'my-repo' },
    ...overrides,
  };
}

function makeDeps(overrides: Partial<PRProcessorDeps> = {}): PRProcessorDeps {
  return {
    getPRWorkItems: mock(() => Promise.resolve([])),
    getWorkItem: mock(() =>
      Promise.resolve({
        id: 100,
        fields: { 'System.Title': 'Work item', 'System.WorkItemType': 'User Story' },
        rev: 1,
        url: 'https://example.com/100',
      }),
    ),
    getPRChangedFiles: mock(() => Promise.resolve(['/src/index.ts', '/README.md'])),
    updateWorkItemField: mock(() =>
      Promise.resolve({
        id: 100,
        fields: { 'Custom.ReleaseNotes': 'Generated release note' },
        rev: 2,
        url: 'https://example.com/100',
      }),
    ),
    generateReleaseNote: mock(() => Promise.resolve('Generated release note')),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('processPR', () => {
  test('PR with no linked work items returns zeroed result', async () => {
    const config = mockConfig();
    const pr = mockPR();
    const deps = makeDeps({
      getPRWorkItems: mock(() => Promise.resolve([])),
    });

    const result = await processPR(config, pr, deps);

    expect(result).toEqual({
      prId: 42,
      processed: 0,
      skipped: 0,
      errors: 0,
    });
    expect(deps.getPRWorkItems).toHaveBeenCalledTimes(1);
    // Should not fetch changed files or work items when there are no linked items
    expect(deps.getWorkItem).toHaveBeenCalledTimes(0);
    expect(deps.getPRChangedFiles).toHaveBeenCalledTimes(0);
  });

  test('PR with work item that has empty release notes generates and writes', async () => {
    const config = mockConfig();
    const pr = mockPR();
    const deps = makeDeps({
      getPRWorkItems: mock(() =>
        Promise.resolve([{ id: '100', url: 'https://example.com/100' }]),
      ),
      getWorkItem: mock(() =>
        Promise.resolve({
          id: 100,
          fields: {
            'System.Title': 'Fix login bug',
            'System.WorkItemType': 'Bug',
            'Custom.ReleaseNotes': '',
          },
          rev: 1,
          url: 'https://example.com/100',
        }),
      ),
      getPRChangedFiles: mock(() =>
        Promise.resolve(['/src/auth/login.ts']),
      ),
      generateReleaseNote: mock(() => Promise.resolve('Fixed login bug')),
      updateWorkItemField: mock(() =>
        Promise.resolve({
          id: 100,
          fields: { 'Custom.ReleaseNotes': 'Fixed login bug' },
          rev: 2,
          url: 'https://example.com/100',
        }),
      ),
    });

    const result = await processPR(config, pr, deps);

    expect(result).toEqual({
      prId: 42,
      processed: 1,
      skipped: 0,
      errors: 0,
    });

    // Verify generateReleaseNote was called with proper context
    expect(deps.generateReleaseNote).toHaveBeenCalledTimes(1);
    const genCall = (deps.generateReleaseNote as ReturnType<typeof mock>).mock.calls[0]!;
    expect(genCall[0]).toBe(config);
    expect(genCall[1]).toEqual({
      prTitle: 'Add new feature',
      prDescription: 'Adds a great new feature to the system',
      changedFiles: ['/src/auth/login.ts'],
      workItemTitle: 'Fix login bug',
      workItemType: 'Bug',
    });

    // Verify updateWorkItemField was called
    expect(deps.updateWorkItemField).toHaveBeenCalledTimes(1);
    const updateCall = (deps.updateWorkItemField as ReturnType<typeof mock>).mock.calls[0]!;
    expect(updateCall[1]).toBe(100); // workItemId
    expect(updateCall[2]).toBe('Custom.ReleaseNotes'); // field name
    expect(updateCall[3]).toBe('Fixed login bug'); // value
  });

  test('PR with work item that already has release notes is skipped', async () => {
    const config = mockConfig();
    const pr = mockPR();
    const deps = makeDeps({
      getPRWorkItems: mock(() =>
        Promise.resolve([{ id: '200', url: 'https://example.com/200' }]),
      ),
      getWorkItem: mock(() =>
        Promise.resolve({
          id: 200,
          fields: {
            'System.Title': 'Existing feature',
            'System.WorkItemType': 'User Story',
            'Custom.ReleaseNotes': 'Already written release notes',
          },
          rev: 3,
          url: 'https://example.com/200',
        }),
      ),
    });

    const result = await processPR(config, pr, deps);

    expect(result).toEqual({
      prId: 42,
      processed: 0,
      skipped: 1,
      errors: 0,
    });

    // Should NOT call generate or update
    expect(deps.generateReleaseNote).toHaveBeenCalledTimes(0);
    expect(deps.updateWorkItemField).toHaveBeenCalledTimes(0);
  });

  test('PR with work item where generation fails counts as error', async () => {
    const config = mockConfig();
    const pr = mockPR();
    const deps = makeDeps({
      getPRWorkItems: mock(() =>
        Promise.resolve([{ id: '300', url: 'https://example.com/300' }]),
      ),
      getWorkItem: mock(() =>
        Promise.resolve({
          id: 300,
          fields: {
            'System.Title': 'Broken feature',
            'System.WorkItemType': 'Bug',
          },
          rev: 1,
          url: 'https://example.com/300',
        }),
      ),
      generateReleaseNote: mock(() =>
        Promise.reject(new Error('Claude API error')),
      ),
    });

    const result = await processPR(config, pr, deps);

    expect(result).toEqual({
      prId: 42,
      processed: 0,
      skipped: 0,
      errors: 1,
    });

    // Should NOT have called updateWorkItemField since generation failed
    expect(deps.updateWorkItemField).toHaveBeenCalledTimes(0);
  });

  test('PR with multiple work items produces correct mixed counts', async () => {
    const config = mockConfig();
    const pr = mockPR();

    let getWorkItemCallCount = 0;
    const workItems = [
      {
        // WI 100: needs release note (empty field)
        id: 100,
        fields: {
          'System.Title': 'New feature',
          'System.WorkItemType': 'User Story',
          'Custom.ReleaseNotes': '',
        },
        rev: 1,
        url: 'https://example.com/100',
      },
      {
        // WI 200: already has release notes (skip)
        id: 200,
        fields: {
          'System.Title': 'Old feature',
          'System.WorkItemType': 'Task',
          'Custom.ReleaseNotes': 'Existing notes',
        },
        rev: 2,
        url: 'https://example.com/200',
      },
      {
        // WI 300: needs release note but generation will fail (error)
        id: 300,
        fields: {
          'System.Title': 'Broken item',
          'System.WorkItemType': 'Bug',
        },
        rev: 1,
        url: 'https://example.com/300',
      },
    ];

    let generateCallCount = 0;

    const deps = makeDeps({
      getPRWorkItems: mock(() =>
        Promise.resolve([
          { id: '100', url: 'https://example.com/100' },
          { id: '200', url: 'https://example.com/200' },
          { id: '300', url: 'https://example.com/300' },
        ]),
      ),
      getWorkItem: mock(() => {
        const item = workItems[getWorkItemCallCount]!;
        getWorkItemCallCount++;
        return Promise.resolve(item);
      }),
      generateReleaseNote: mock(() => {
        generateCallCount++;
        if (generateCallCount === 1) {
          return Promise.resolve('New feature release note');
        }
        // Second call (for WI 300) fails
        return Promise.reject(new Error('Generation failed'));
      }),
    });

    const result = await processPR(config, pr, deps);

    expect(result).toEqual({
      prId: 42,
      processed: 1,
      skipped: 1,
      errors: 1,
    });

    // getWorkItem called for all 3
    expect(deps.getWorkItem).toHaveBeenCalledTimes(3);
    // generateReleaseNote called for WI 100 and WI 300 (WI 200 was skipped)
    expect(deps.generateReleaseNote).toHaveBeenCalledTimes(2);
    // updateWorkItemField called only for WI 100 (WI 300 failed during generation)
    expect(deps.updateWorkItemField).toHaveBeenCalledTimes(1);
  });

  test('changed files fetch failure still processes work items', async () => {
    const config = mockConfig();
    const pr = mockPR();
    const deps = makeDeps({
      getPRWorkItems: mock(() =>
        Promise.resolve([{ id: '100', url: 'https://example.com/100' }]),
      ),
      getWorkItem: mock(() =>
        Promise.resolve({
          id: 100,
          fields: {
            'System.Title': 'Some feature',
            'System.WorkItemType': 'User Story',
          },
          rev: 1,
          url: 'https://example.com/100',
        }),
      ),
      getPRChangedFiles: mock(() =>
        Promise.reject(new Error('Diff API failed')),
      ),
      generateReleaseNote: mock(() =>
        Promise.resolve('Release note without file context'),
      ),
    });

    const result = await processPR(config, pr, deps);

    expect(result).toEqual({
      prId: 42,
      processed: 1,
      skipped: 0,
      errors: 0,
    });

    // generateReleaseNote should have been called with empty changedFiles
    const genCall = (deps.generateReleaseNote as ReturnType<typeof mock>).mock.calls[0]!;
    expect(genCall[1]).toEqual({
      prTitle: 'Add new feature',
      prDescription: 'Adds a great new feature to the system',
      changedFiles: [], // empty because fetch failed
      workItemTitle: 'Some feature',
      workItemType: 'User Story',
    });
  });

  test('work item with undefined release notes field generates note', async () => {
    const config = mockConfig();
    const pr = mockPR();
    const deps = makeDeps({
      getPRWorkItems: mock(() =>
        Promise.resolve([{ id: '400', url: 'https://example.com/400' }]),
      ),
      getWorkItem: mock(() =>
        Promise.resolve({
          id: 400,
          fields: {
            'System.Title': 'Feature without field',
            'System.WorkItemType': 'Feature',
            // Custom.ReleaseNotes is missing entirely
          },
          rev: 1,
          url: 'https://example.com/400',
        }),
      ),
      generateReleaseNote: mock(() => Promise.resolve('Brand new note')),
    });

    const result = await processPR(config, pr, deps);

    expect(result).toEqual({
      prId: 42,
      processed: 1,
      skipped: 0,
      errors: 0,
    });
  });

  test('work item with whitespace-only release notes field generates note', async () => {
    const config = mockConfig();
    const pr = mockPR();
    const deps = makeDeps({
      getPRWorkItems: mock(() =>
        Promise.resolve([{ id: '500', url: 'https://example.com/500' }]),
      ),
      getWorkItem: mock(() =>
        Promise.resolve({
          id: 500,
          fields: {
            'System.Title': 'Feature with blank field',
            'System.WorkItemType': 'Task',
            'Custom.ReleaseNotes': '   ',
          },
          rev: 1,
          url: 'https://example.com/500',
        }),
      ),
      generateReleaseNote: mock(() => Promise.resolve('Note for blank field')),
    });

    const result = await processPR(config, pr, deps);

    expect(result).toEqual({
      prId: 42,
      processed: 1,
      skipped: 0,
      errors: 0,
    });
  });
});
