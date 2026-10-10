import { describe, test, expect, mock } from 'bun:test';
import type { AppConfig, DiffResponse } from '../../src/types/index.ts';
import {
  getPRCodeChanges,
  MAX_FILE_DIFF_CHARS,
  type CodeDiffDeps,
} from '../../src/services/code-diff.ts';

const config = {} as AppConfig;

/** Contents per `${commit}:${path}`; a missing key means the fetch fails. `null` means binary. */
function makeDeps(diff: DiffResponse, files: Record<string, string | null>): CodeDiffDeps {
  return {
    getCommitDiff: mock(() => Promise.resolve(diff)),
    getFileContentAtCommit: mock((_c: AppConfig, _r: string, path: string, commit: string) => {
      const key = `${commit}:${path}`;
      if (!(key in files)) return Promise.reject(new Error(`404 ${key}`));
      return Promise.resolve(files[key]!);
    }),
  };
}

describe('getPRCodeChanges', () => {
  test('diffs an edited file from the merge base to the source commit', async () => {
    const deps = makeDeps(
      { commonCommit: 'base0', changes: [{ item: { path: '/src/a.al' }, changeType: 'edit' }] },
      {
        'base0:/src/a.al': 'line1\nold\nline3\n',
        'src1:/src/a.al': 'line1\nnew\nline3\n',
      },
    );

    const result = await getPRCodeChanges(config, 'repo', 'target1', 'src1', 60_000, deps);

    expect(result.files).toEqual(['/src/a.al']);
    expect(result.diff).toContain('-old');
    expect(result.diff).toContain('+new');
    expect(result.diff.startsWith('--- /src/a.al\n+++ /src/a.al\n')).toBe(true);
    // The merge base, not the target tip, is the old side.
    expect(deps.getFileContentAtCommit).not.toHaveBeenCalledWith(config, 'repo', '/src/a.al', 'target1');
  });

  test('falls back to the base commit when ADO returns no merge base', async () => {
    const deps = makeDeps(
      { changes: [{ item: { path: '/a.al' }, changeType: 'edit' }] },
      { 'target1:/a.al': 'x\n', 'src1:/a.al': 'y\n' },
    );

    const result = await getPRCodeChanges(config, 'repo', 'target1', 'src1', 60_000, deps);

    expect(result.diff).toContain('+y');
  });

  test('does not fetch the missing side of added and deleted files', async () => {
    const deps = makeDeps(
      {
        commonCommit: 'base0',
        changes: [
          { item: { path: '/new.al' }, changeType: 'add' },
          { item: { path: '/gone.al' }, changeType: 'delete' },
        ],
      },
      { 'src1:/new.al': 'added line\n', 'base0:/gone.al': 'removed line\n' },
    );

    const result = await getPRCodeChanges(config, 'repo', 't', 'src1', 60_000, deps);

    expect(result.diff).toContain('+added line');
    expect(result.diff).toContain('-removed line');
    expect(deps.getFileContentAtCommit).toHaveBeenCalledTimes(2);
  });

  test('reads the old side of a renamed file from its previous path', async () => {
    const deps = makeDeps(
      {
        commonCommit: 'base0',
        changes: [{ item: { path: '/b.al' }, changeType: 'edit, rename', sourceServerItem: '/a.al' }],
      },
      { 'base0:/a.al': 'one\n', 'src1:/b.al': 'two\n' },
    );

    const result = await getPRCodeChanges(config, 'repo', 't', 'src1', 60_000, deps);

    expect(result.diff).toContain('-one');
    expect(result.diff).toContain('+two');
  });

  test('ignores folders', async () => {
    const deps = makeDeps(
      {
        commonCommit: 'base0',
        changes: [
          { item: { path: '/src', isFolder: true }, changeType: 'edit' },
          { item: { path: '/lib', gitObjectType: 'tree' }, changeType: 'add' },
        ],
      },
      {},
    );

    const result = await getPRCodeChanges(config, 'repo', 't', 'src1', 60_000, deps);

    expect(result.files).toEqual([]);
    expect(result.diff).toBe('');
  });

  test('lists skipped, binary and unfetchable files instead of diffing them', async () => {
    const deps = makeDeps(
      {
        commonCommit: 'base0',
        changes: [
          { item: { path: '/bun.lock' }, changeType: 'edit' },
          { item: { path: '/Translations/App.g.xlf' }, changeType: 'edit' },
          { item: { path: '/logo.png' }, changeType: 'add' },
          { item: { path: '/data.bin' }, changeType: 'add' },
          { item: { path: '/broken.al' }, changeType: 'edit' },
        ],
      },
      { 'src1:/data.bin': null },
    );

    const result = await getPRCodeChanges(config, 'repo', 't', 'src1', 60_000, deps);

    expect(result.files).toHaveLength(5);
    expect(result.diff).toContain('- /bun.lock (lockfile, translation or binary)');
    expect(result.diff).toContain('- /Translations/App.g.xlf (lockfile, translation or binary)');
    expect(result.diff).toContain('- /logo.png (lockfile, translation or binary)');
    expect(result.diff).toContain('- /data.bin (binary)');
    expect(result.diff).toContain('- /broken.al (could not fetch)');
    // Skipped by name: never fetched. data.bin: new side only; broken.al: stops at the failed old side.
    expect(deps.getFileContentAtCommit).toHaveBeenCalledTimes(2);
  });

  test('truncates one huge file to the per-file cap', async () => {
    const big = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n') + '\n';
    const deps = makeDeps(
      { commonCommit: 'base0', changes: [{ item: { path: '/big.al' }, changeType: 'add' }] },
      { 'src1:/big.al': big },
    );

    const result = await getPRCodeChanges(config, 'repo', 't', 'src1', 60_000, deps);

    expect(result.diff).toContain('(diff truncated)');
    expect(result.diff.length).toBeLessThan(MAX_FILE_DIFF_CHARS + 200);
  });

  test('stops fetching once the budget is used and lists the rest', async () => {
    const body = Array.from({ length: 200 }, (_, i) => `row ${i}`).join('\n') + '\n';
    const deps = makeDeps(
      {
        commonCommit: 'base0',
        changes: [
          { item: { path: '/one.al' }, changeType: 'add' },
          { item: { path: '/two.al' }, changeType: 'add' },
        ],
      },
      { 'src1:/one.al': body, 'src1:/two.al': body },
    );

    const result = await getPRCodeChanges(config, 'repo', 't', 'src1', 500, deps);

    expect(result.diff).toContain('/one.al');
    expect(result.diff).toContain('- /two.al (size limit reached)');
    expect(deps.getFileContentAtCommit).toHaveBeenCalledTimes(1);
  });
});
