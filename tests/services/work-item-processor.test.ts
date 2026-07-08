import { describe, test, expect, mock } from 'bun:test';
import type {
  AppConfig,
  AzureDevOpsPullRequest,
  WorkItemResponse,
} from '../../src/types/index.ts';
import {
  parsePullRequestRefs,
  removeTag,
  appendNote,
  processTaggedWorkItem,
  scanTaggedWorkItems,
  RELEASE_NOTE_SEPARATOR,
} from '../../src/services/work-item-processor.ts';
import type { WorkItemProcessorDeps } from '../../src/services/work-item-processor.ts';

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
    lookbackDays: 7,
    releaseNoteTag: 'create-releasenote',
    ...overrides,
  };
}

function mockPR(overrides: Partial<AzureDevOpsPullRequest> = {}): AzureDevOpsPullRequest {
  return {
    pullRequestId: 42,
    title: 'Add new feature',
    description: 'Adds a great new feature',
    status: 'completed',
    creationDate: '2025-01-01T00:00:00Z',
    closedDate: '2025-01-02T00:00:00Z',
    sourceRefName: 'refs/heads/feature/new-feature',
    targetRefName: 'refs/heads/main',
    lastMergeSourceCommit: { commitId: 'source-abc' },
    lastMergeTargetCommit: { commitId: 'target-def' },
    repository: { id: 'repo-1', name: 'my-repo' },
    ...overrides,
  };
}

function mockWorkItem(overrides: Partial<WorkItemResponse> = {}): WorkItemResponse {
  return {
    id: 100,
    fields: {
      'System.Title': 'Improve export',
      'System.WorkItemType': 'User Story',
      'System.Description': 'Users want faster exports',
      'System.Tags': 'create-releasenote',
      'System.State': 'Active',
    },
    rev: 1,
    url: 'https://example.com/100',
    ...overrides,
  };
}

/** A vstfs ArtifactLink pointing at PR 42 in repo-1 under project proj-guid. */
function prRelation(repoId = 'repo-1', prId = 42) {
  return {
    rel: 'ArtifactLink',
    url: `vstfs:///Git/PullRequestId/proj-guid%2F${repoId}%2F${prId}`,
    attributes: { name: 'Pull Request' },
  };
}

function makeDeps(overrides: Partial<WorkItemProcessorDeps> = {}): WorkItemProcessorDeps {
  return {
    getWorkItem: mock(() => Promise.resolve(mockWorkItem())),
    getWorkItemComments: mock(() => Promise.resolve([])),
    getPullRequest: mock(() => Promise.resolve(mockPR())),
    getPRChangedFiles: mock(() => Promise.resolve(['/src/export.ts'])),
    getPRThreadComments: mock(() => Promise.resolve([])),
    updateWorkItemFields: mock(() =>
      Promise.resolve(mockWorkItem({ rev: 2 })),
    ),
    generateReleaseNote: mock(() => Promise.resolve('<p>Export is now faster.</p>')),
    queryWorkItemsByTag: mock(() => Promise.resolve([])),
    addWorkItemComment: mock(() => Promise.resolve()),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parsePullRequestRefs
// ---------------------------------------------------------------------------

describe('parsePullRequestRefs', () => {
  test('parses a vstfs PR artifact link into repoId and prId', () => {
    const refs = parsePullRequestRefs([prRelation('repo-xyz', 4321)]);
    expect(refs).toEqual([{ repoId: 'repo-xyz', prId: 4321 }]);
  });

  test('ignores non-ArtifactLink relations', () => {
    const refs = parsePullRequestRefs([
      { rel: 'System.LinkTypes.Hierarchy-Forward', url: 'https://example.com/200' },
      prRelation('repo-1', 42),
    ]);
    expect(refs).toEqual([{ repoId: 'repo-1', prId: 42 }]);
  });

  test('ignores artifact links that are not pull requests', () => {
    const refs = parsePullRequestRefs([
      { rel: 'ArtifactLink', url: 'vstfs:///Git/Commit/proj%2Frepo%2Fabc', attributes: { name: 'Fixed in Commit' } },
    ]);
    expect(refs).toEqual([]);
  });

  test('returns empty array for undefined or empty relations', () => {
    expect(parsePullRequestRefs(undefined)).toEqual([]);
    expect(parsePullRequestRefs([])).toEqual([]);
  });

  test('parses multiple PR links', () => {
    const refs = parsePullRequestRefs([prRelation('repo-1', 1), prRelation('repo-2', 2)]);
    expect(refs).toEqual([
      { repoId: 'repo-1', prId: 1 },
      { repoId: 'repo-2', prId: 2 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// removeTag
// ---------------------------------------------------------------------------

describe('removeTag', () => {
  test('removes the target tag and preserves others', () => {
    expect(removeTag('alpha; create-releasenote; beta', 'create-releasenote')).toBe('alpha; beta');
  });

  test('is case-insensitive on the tag name', () => {
    expect(removeTag('Create-ReleaseNote; keep', 'create-releasenote')).toBe('keep');
  });

  test('returns empty string when the tag is the only one', () => {
    expect(removeTag('create-releasenote', 'create-releasenote')).toBe('');
  });

  test('leaves the string unchanged when the tag is absent', () => {
    expect(removeTag('alpha; beta', 'create-releasenote')).toBe('alpha; beta');
  });

  test('handles empty or undefined input', () => {
    expect(removeTag('', 'create-releasenote')).toBe('');
    expect(removeTag(undefined, 'create-releasenote')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// appendNote
// ---------------------------------------------------------------------------

describe('appendNote', () => {
  test('returns the note alone when there is no existing note', () => {
    expect(appendNote('', '<p>New</p>')).toBe('<p>New</p>');
    expect(appendNote('   ', '<p>New</p>')).toBe('<p>New</p>');
  });

  test('appends after existing note with the separator', () => {
    expect(appendNote('<p>Old</p>', '<p>New</p>')).toBe(
      `<p>Old</p>${RELEASE_NOTE_SEPARATOR}<p>New</p>`,
    );
  });
});

// ---------------------------------------------------------------------------
// processTaggedWorkItem
// ---------------------------------------------------------------------------

describe('processTaggedWorkItem', () => {
  test('gathers PR context + comments, generates, and writes with tag removed', async () => {
    const config = mockConfig();
    const workItem = mockWorkItem({
      fields: {
        'System.Title': 'Improve export',
        'System.WorkItemType': 'User Story',
        'System.Description': 'Users want faster exports',
        'System.Tags': 'create-releasenote; area-export',
        'System.State': 'Active',
        'Custom.ReleaseNotes': '',
      },
      relations: [prRelation('repo-1', 42)],
    });
    const deps = makeDeps({
      getWorkItemComments: mock(() => Promise.resolve(['A useful comment'])),
      getPRThreadComments: mock(() => Promise.resolve(['Reviewer note'])),
      generateReleaseNote: mock(() => Promise.resolve('<p>Export is now faster.</p>')),
    });

    const result = await processTaggedWorkItem(config, workItem, deps);

    expect(result).toEqual({ workItemId: 100, processed: 1, skipped: 0, errors: 0 });

    // Context passed to generator included PR + comments
    const genCtx = (deps.generateReleaseNote as ReturnType<typeof mock>).mock.calls[0]![1];
    expect(genCtx.prTitle).toBe('Add new feature');
    expect(genCtx.workItemComments).toEqual(['A useful comment']);
    expect(genCtx.prComments).toEqual(['Reviewer note']);

    // Wrote note and stripped the tag
    expect(deps.updateWorkItemFields).toHaveBeenCalledTimes(1);
    const fields = (deps.updateWorkItemFields as ReturnType<typeof mock>).mock.calls[0]![2] as Array<{ fieldName: string; value: string; op?: string }>;
    const notes = fields.find((f) => f.fieldName === 'Custom.ReleaseNotes');
    const tags = fields.find((f) => f.fieldName === 'System.Tags');
    expect(notes?.value).toBe('<p>Export is now faster.</p>');
    expect(tags?.value).toBe('area-export');
    // Tags MUST use op 'replace' — 'add' merges and can never remove the tag.
    expect(tags?.op).toBe('replace');
  });

  test('appends to an existing release note', async () => {
    const config = mockConfig();
    const workItem = mockWorkItem({
      fields: {
        'System.Title': 'Improve export',
        'System.WorkItemType': 'User Story',
        'System.Tags': 'create-releasenote',
        'System.State': 'Active',
        'Custom.ReleaseNotes': '<p>Existing note.</p>',
      },
      relations: [prRelation('repo-1', 42)],
    });
    const deps = makeDeps({
      generateReleaseNote: mock(() => Promise.resolve('<p>New note.</p>')),
    });

    await processTaggedWorkItem(config, workItem, deps);

    const fields = (deps.updateWorkItemFields as ReturnType<typeof mock>).mock.calls[0]![2] as Array<{ fieldName: string; value: string }>;
    const notes = fields.find((f) => f.fieldName === 'Custom.ReleaseNotes');
    expect(notes?.value).toBe(`<p>Existing note.</p>${RELEASE_NOTE_SEPARATOR}<p>New note.</p>`);
  });

  test('generates from the work item alone when there is no related PR', async () => {
    const config = mockConfig();
    const workItem = mockWorkItem({ relations: [] });
    const deps = makeDeps({
      generateReleaseNote: mock(() => Promise.resolve('<p>Documented.</p>')),
    });

    const result = await processTaggedWorkItem(config, workItem, deps);

    expect(result.processed).toBe(1);
    // Should not have tried to fetch any PR
    expect(deps.getPullRequest).toHaveBeenCalledTimes(0);
    const genCtx = (deps.generateReleaseNote as ReturnType<typeof mock>).mock.calls[0]![1];
    expect(genCtx.prTitle).toBe('');
    expect(genCtx.workItemTitle).toBe('Improve export');
  });

  test('dry-run generates but does not write and leaves the tag', async () => {
    const config = mockConfig({ dryRun: true });
    const workItem = mockWorkItem({ relations: [prRelation('repo-1', 42)] });
    const deps = makeDeps();

    const result = await processTaggedWorkItem(config, workItem, deps);

    expect(result.processed).toBe(1);
    expect(deps.generateReleaseNote).toHaveBeenCalledTimes(1);
    expect(deps.updateWorkItemFields).toHaveBeenCalledTimes(0);
  });

  test('generation failure counts as error and does not write (tag stays)', async () => {
    const config = mockConfig();
    const workItem = mockWorkItem({ relations: [prRelation('repo-1', 42)] });
    const deps = makeDeps({
      generateReleaseNote: mock(() => Promise.reject(new Error('SDK failed'))),
    });

    const result = await processTaggedWorkItem(config, workItem, deps);

    expect(result).toEqual({ workItemId: 100, processed: 0, skipped: 0, errors: 1 });
    expect(deps.updateWorkItemFields).toHaveBeenCalledTimes(0);
  });

  test('reopens a Closed work item to write, then re-closes it', async () => {
    const config = mockConfig();
    const workItem = mockWorkItem({
      fields: {
        'System.Title': 'Closed item',
        'System.WorkItemType': 'Bug',
        'System.Tags': 'create-releasenote',
        'System.State': 'Closed',
        'Custom.ReleaseNotes': '',
      },
      relations: [prRelation('repo-1', 42)],
    });
    const deps = makeDeps();

    const result = await processTaggedWorkItem(config, workItem, deps);

    expect(result.processed).toBe(1);
    // Two PATCHes: reopen to Resolved, then write + re-close
    expect(deps.updateWorkItemFields).toHaveBeenCalledTimes(2);
    const secondPatch = (deps.updateWorkItemFields as ReturnType<typeof mock>).mock.calls[1]![2] as Array<{ fieldName: string; value: string }>;
    expect(secondPatch.some((f) => f.fieldName === 'System.State' && f.value === 'Closed')).toBe(true);
  });

  test('a failing PR fetch is non-fatal — still generates from remaining context', async () => {
    const config = mockConfig();
    const workItem = mockWorkItem({ relations: [prRelation('repo-1', 42)] });
    const deps = makeDeps({
      getPullRequest: mock(() => Promise.reject(new Error('PR gone'))),
      generateReleaseNote: mock(() => Promise.resolve('<p>From work item.</p>')),
    });

    const result = await processTaggedWorkItem(config, workItem, deps);

    expect(result.processed).toBe(1);
    expect(deps.generateReleaseNote).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// scanTaggedWorkItems
// ---------------------------------------------------------------------------

describe('scanTaggedWorkItems', () => {
  test('queries tagged items, hydrates and processes each, aggregates counts', async () => {
    const config = mockConfig();
    const deps = makeDeps({
      queryWorkItemsByTag: mock(() => Promise.resolve([100, 200])),
      getWorkItem: mock((_c: AppConfig, id: number) =>
        Promise.resolve(mockWorkItem({ id, relations: [] })),
      ),
      generateReleaseNote: mock(() => Promise.resolve('<p>Note.</p>')),
    });

    const result = await scanTaggedWorkItems(config, deps);

    expect(result).toEqual({ processed: 2, skipped: 0, errors: 0 });
    expect(deps.queryWorkItemsByTag).toHaveBeenCalledTimes(1);
    expect((deps.queryWorkItemsByTag as ReturnType<typeof mock>).mock.calls[0]![1]).toBe('create-releasenote');
    expect(deps.getWorkItem).toHaveBeenCalledTimes(2);
  });

  test('no tagged items returns zeros without processing', async () => {
    const config = mockConfig();
    const deps = makeDeps({
      queryWorkItemsByTag: mock(() => Promise.resolve([])),
    });

    const result = await scanTaggedWorkItems(config, deps);

    expect(result).toEqual({ processed: 0, skipped: 0, errors: 0 });
    expect(deps.getWorkItem).toHaveBeenCalledTimes(0);
  });

  test('a failure hydrating one item is counted as an error, others continue', async () => {
    const config = mockConfig();
    let call = 0;
    const deps = makeDeps({
      queryWorkItemsByTag: mock(() => Promise.resolve([100, 200])),
      getWorkItem: mock((_c: AppConfig, id: number) => {
        call++;
        if (call === 1) return Promise.reject(new Error('cannot load'));
        return Promise.resolve(mockWorkItem({ id, relations: [] }));
      }),
    });

    const result = await scanTaggedWorkItems(config, deps);

    expect(result.errors).toBe(1);
    expect(result.processed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// failure comments
// ---------------------------------------------------------------------------

describe('failure comments', () => {
  test('generation failure posts a categorized "generate" comment; tag not removed', async () => {
    const config = mockConfig();
    const workItem = mockWorkItem({ relations: [prRelation('repo-1', 42)] });
    const addComment = mock(() => Promise.resolve());
    const deps = makeDeps({
      generateReleaseNote: mock(() => Promise.reject(new Error('SDK failed'))),
      getWorkItemComments: mock(() => Promise.resolve([] as string[])),
      addWorkItemComment: addComment,
    });

    const result = await processTaggedWorkItem(config, workItem, deps);

    expect(result.errors).toBe(1);
    expect(deps.updateWorkItemFields).toHaveBeenCalledTimes(0);
    expect(addComment).toHaveBeenCalledTimes(1);
    const html = (addComment as ReturnType<typeof mock>).mock.calls[0]![2] as string;
    expect(html).toContain('generate a release note');
  });

  test('a save failure posts a categorized "save" comment', async () => {
    const config = mockConfig();
    const workItem = mockWorkItem({ relations: [prRelation('repo-1', 42)] });
    const addComment = mock(() => Promise.resolve());
    const deps = makeDeps({
      updateWorkItemFields: mock(() => Promise.reject(new Error('403 Forbidden'))),
      getWorkItemComments: mock(() => Promise.resolve([] as string[])),
      addWorkItemComment: addComment,
    });

    const result = await processTaggedWorkItem(config, workItem, deps);

    expect(result.errors).toBe(1);
    expect(addComment).toHaveBeenCalledTimes(1);
    const html = (addComment as ReturnType<typeof mock>).mock.calls[0]![2] as string;
    expect(html).toContain('save it to this work item');
  });

  test('does not repost when the same-category comment already exists', async () => {
    const config = mockConfig();
    const workItem = mockWorkItem({ relations: [prRelation('repo-1', 42)] });
    const addComment = mock(() => Promise.resolve());
    const deps = makeDeps({
      generateReleaseNote: mock(() => Promise.reject(new Error('SDK failed'))),
      getWorkItemComments: mock(() =>
        Promise.resolve([
          "⚠️ Release-note tool couldn't generate a release note here. It will retry automatically on the next poll.",
        ]),
      ),
      addWorkItemComment: addComment,
    });

    await processTaggedWorkItem(config, workItem, deps);

    expect(addComment).toHaveBeenCalledTimes(0);
  });

  test('still posts when only a different-category comment exists', async () => {
    const config = mockConfig();
    const workItem = mockWorkItem({ relations: [prRelation('repo-1', 42)] });
    const addComment = mock(() => Promise.resolve());
    const deps = makeDeps({
      generateReleaseNote: mock(() => Promise.reject(new Error('SDK failed'))),
      getWorkItemComments: mock(() =>
        Promise.resolve([
          "⚠️ Release-note tool generated a note but couldn't save it to this work item — likely a permissions or state issue.",
        ]),
      ),
      addWorkItemComment: addComment,
    });

    await processTaggedWorkItem(config, workItem, deps);

    expect(addComment).toHaveBeenCalledTimes(1);
    const html = (addComment as ReturnType<typeof mock>).mock.calls[0]![2] as string;
    expect(html).toContain('generate a release note');
  });

  test('dry-run does not post a failure comment', async () => {
    const config = mockConfig({ dryRun: true });
    const workItem = mockWorkItem({ relations: [prRelation('repo-1', 42)] });
    const addComment = mock(() => Promise.resolve());
    const deps = makeDeps({
      generateReleaseNote: mock(() => Promise.reject(new Error('SDK failed'))),
      addWorkItemComment: addComment,
    });

    const result = await processTaggedWorkItem(config, workItem, deps);

    expect(result.errors).toBe(1);
    expect(addComment).toHaveBeenCalledTimes(0);
  });

  test('a failure reading comments does not post and does not throw', async () => {
    const config = mockConfig();
    const workItem = mockWorkItem({ relations: [prRelation('repo-1', 42)] });
    const addComment = mock(() => Promise.resolve());
    const deps = makeDeps({
      generateReleaseNote: mock(() => Promise.reject(new Error('SDK failed'))),
      getWorkItemComments: mock(() => Promise.reject(new Error('comments unreadable'))),
      addWorkItemComment: addComment,
    });

    const result = await processTaggedWorkItem(config, workItem, deps);

    expect(result.errors).toBe(1);
    expect(addComment).toHaveBeenCalledTimes(0);
  });
});
