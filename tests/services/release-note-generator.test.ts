import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildUserPrompt, extractHtml, loadSystemPrompt } from '../../src/services/release-note-generator.ts';
import type { ReleaseNoteContext } from '../../src/services/release-note-generator.ts';

describe('loadSystemPrompt', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rn-prompt-'));
    mkdirSync(join(root, '.claude', 'skills', 'rn'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('returns the file content unchanged when there are no includes', () => {
    writeFileSync(join(root, 'prompt.md'), '# Prompt\n\nJust text.\n');
    expect(loadSystemPrompt(join(root, 'prompt.md'), root)).toBe('# Prompt\n\nJust text.\n');
  });

  test('expands @path includes relative to the project root', () => {
    const skillDir = join(root, '.claude', 'skills', 'rn');
    writeFileSync(join(skillDir, 'style.md'), '# Style guide\nBold UI.\n');
    writeFileSync(join(skillDir, 'rules.md'), '# Rules\nFocus.\n');
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '# Cmd\n\n## Style\n\n@.claude/skills/rn/style.md\n\n## Rules\n\n@.claude/skills/rn/rules.md\n',
    );

    const prompt = loadSystemPrompt(join(skillDir, 'SKILL.md'), root);

    expect(prompt).toContain('# Style guide\nBold UI.');
    expect(prompt).toContain('# Rules\nFocus.');
    expect(prompt).not.toContain('@.claude/');
    // Order of the surrounding headings is preserved.
    expect(prompt.indexOf('## Style')).toBeLessThan(prompt.indexOf('# Style guide'));
    expect(prompt.indexOf('# Style guide')).toBeLessThan(prompt.indexOf('## Rules'));
    expect(prompt.indexOf('## Rules')).toBeLessThan(prompt.indexOf('# Rules'));
  });

  test('leaves @-mentions that are not on their own line alone', () => {
    writeFileSync(join(root, 'prompt.md'), 'Contact @someone or see the @.claude/x.md note inline.\n');
    expect(loadSystemPrompt(join(root, 'prompt.md'), root)).toBe(
      'Contact @someone or see the @.claude/x.md note inline.\n',
    );
  });

  test('throws a clear error when an included file is missing', () => {
    writeFileSync(join(root, 'prompt.md'), '@.claude/missing.md\n');
    expect(() => loadSystemPrompt(join(root, 'prompt.md'), root)).toThrow(/missing\.md/);
  });

  test('the shipped default prompt expands with no unresolved includes', () => {
    // Guards the real files: the default RELEASE_NOTE_PROMPT_PATH must resolve
    // its @includes against the repo root so the app gets the full prompt.
    const prompt = loadSystemPrompt('.claude/skills/do-generate-release-note/SKILL.md', process.cwd());
    expect(prompt).not.toMatch(/^@/m);
    // Style guide content
    expect(prompt).toContain('Never use "we."');
    // Generation-rules content
    expect(prompt).toContain('the note is not a changelog');
  });
});

describe('buildUserPrompt', () => {
  const baseContext: ReleaseNoteContext = {
    prTitle: 'Fix login timeout',
    prDescription: 'Increased timeout from 5s to 30s',
    changedFiles: ['src/auth/login.ts', 'src/auth/config.ts'],
    workItemTitle: 'Login times out too quickly',
    workItemType: 'Bug',
    workItemDescription: 'Users report the login page times out after 5 seconds',
  };

  test('includes PR title', () => {
    const prompt = buildUserPrompt(baseContext);
    expect(prompt).toContain('**Title:** Fix login timeout');
  });

  test('includes PR description when present', () => {
    const prompt = buildUserPrompt(baseContext);
    expect(prompt).toContain('**Description:** Increased timeout from 5s to 30s');
  });

  test('omits PR description when empty', () => {
    const prompt = buildUserPrompt({ ...baseContext, prDescription: '' });
    // PR section should not have a description line
    const prSection = prompt.slice(prompt.indexOf('## Pull Request'), prompt.indexOf('## Changed Files'));
    expect(prSection).not.toContain('**Description:**');
  });

  test('lists changed files', () => {
    const prompt = buildUserPrompt(baseContext);
    expect(prompt).toContain('## Changed Files');
    expect(prompt).toContain('- src/auth/login.ts');
    expect(prompt).toContain('- src/auth/config.ts');
  });

  test('omits changed files section when empty', () => {
    const prompt = buildUserPrompt({ ...baseContext, changedFiles: [] });
    expect(prompt).not.toContain('## Changed Files');
  });

  test('truncates at 50 files with overflow message', () => {
    const manyFiles = Array.from({ length: 60 }, (_, i) => `src/file${i}.ts`);
    const prompt = buildUserPrompt({ ...baseContext, changedFiles: manyFiles });
    expect(prompt).toContain('- src/file49.ts');
    expect(prompt).not.toContain('- src/file50.ts');
    expect(prompt).toContain('...and 10 more files');
  });

  test('includes work item type and title', () => {
    const prompt = buildUserPrompt(baseContext);
    expect(prompt).toContain('**Type:** Bug');
    expect(prompt).toContain('**Title:** Login times out too quickly');
  });

  test('includes work item description when present', () => {
    const prompt = buildUserPrompt(baseContext);
    expect(prompt).toContain('**Description:** Users report the login page times out after 5 seconds');
  });

  test('omits work item description when empty', () => {
    const prompt = buildUserPrompt({ ...baseContext, workItemDescription: '' });
    // PR description is present, but work item description should not appear after Work Item section
    const wiSection = prompt.indexOf('## Work Item');
    const afterWi = prompt.slice(wiSection);
    expect(afterWi).not.toContain('**Description:**');
  });

  test('includes all sections in order', () => {
    const prompt = buildUserPrompt(baseContext);
    const prSection = prompt.indexOf('## Pull Request');
    const filesSection = prompt.indexOf('## Changed Files');
    const wiSection = prompt.indexOf('## Work Item');
    expect(prSection).toBeLessThan(filesSection);
    expect(filesSection).toBeLessThan(wiSection);
  });

  test('includes work item comments section when present', () => {
    const prompt = buildUserPrompt({
      ...baseContext,
      workItemComments: ['First comment', 'Second comment'],
    });
    expect(prompt).toContain('## Work Item Comments');
    expect(prompt).toContain('- First comment');
    expect(prompt).toContain('- Second comment');
  });

  test('includes PR comments section when present', () => {
    const prompt = buildUserPrompt({
      ...baseContext,
      prComments: ['Reviewer note about edge case'],
    });
    expect(prompt).toContain('## Pull Request Comments');
    expect(prompt).toContain('- Reviewer note about edge case');
  });

  test('includes additional PR descriptions section when present', () => {
    const prompt = buildUserPrompt({
      ...baseContext,
      additionalPrDescriptions: ['Second PR: refactors the parser'],
    });
    expect(prompt).toContain('## Additional Pull Requests');
    expect(prompt).toContain('- Second PR: refactors the parser');
  });

  test('output is unchanged when new optional fields are absent', () => {
    // Guards the PR-driven flow: a context without the new fields must produce
    // exactly the same prompt it did before those fields existed.
    const prompt = buildUserPrompt(baseContext);
    expect(prompt).not.toContain('## Work Item Comments');
    expect(prompt).not.toContain('## Pull Request Comments');
    expect(prompt).not.toContain('## Additional Pull Requests');
  });

  test('omits comment sections when arrays are empty', () => {
    const prompt = buildUserPrompt({
      ...baseContext,
      workItemComments: [],
      prComments: [],
      additionalPrDescriptions: [],
    });
    expect(prompt).not.toContain('## Work Item Comments');
    expect(prompt).not.toContain('## Pull Request Comments');
    expect(prompt).not.toContain('## Additional Pull Requests');
  });

  test('renders with no PR (work-item-only context)', () => {
    const prompt = buildUserPrompt({
      prTitle: '',
      prDescription: '',
      changedFiles: [],
      workItemTitle: 'Manual note request',
      workItemType: 'User Story',
      workItemDescription: 'Please document this',
      workItemComments: ['A clarifying comment'],
    });
    expect(prompt).toContain('## Work Item');
    expect(prompt).toContain('**Title:** Manual note request');
    expect(prompt).toContain('## Work Item Comments');
  });

  test('format hint does not request <h3>-style section headers', () => {
    const bug = buildUserPrompt(baseContext);
    const feature = buildUserPrompt({ ...baseContext, workItemType: 'User Story' });
    // The prompt forbids headings; the per-request hint must not reintroduce
    // the old Why/What/Impact / What/Where-When/Resolution header structure.
    expect(bug).not.toContain('Why, What, Impact');
    expect(feature).not.toContain('Why, What, Impact');
    expect(bug).toContain('flowing-prose');
    expect(feature).toContain('flowing-prose');
  });
});

describe('extractHtml', () => {
  // Regression: the prompt now produces header-free prose. A note with no
  // <h3> must still be accepted (previously this threw "no <h3> tags").
  test('accepts header-free prose with only <p>', () => {
    const note = '<p>The export now escapes special characters, so it completes successfully.</p>';
    expect(extractHtml(note, [])).toBe(note);
  });

  test('accepts a note that starts with <ul>', () => {
    const note = '<ul><li><em>The Recipient Bank Account must have a value.</em></li></ul>';
    expect(extractHtml(note, [])).toBe(note);
  });

  test('still accepts legacy notes that start with <h3>', () => {
    const note = '<h3>What</h3><p>Something changed.</p>';
    expect(extractHtml(note, [])).toBe(note);
  });

  test('strips a conversational preamble before the HTML', () => {
    const result = 'Here is the release note for this change:\n\n<p>It is now possible to do the thing.</p>';
    expect(extractHtml(result, [])).toBe('<p>It is now possible to do the thing.</p>');
  });

  test('falls back to an earlier assistant message when the result has no HTML', () => {
    const result = 'Does this release note look correct?';
    const earlier = ['<p>The login timeout has been increased to 30 seconds.</p>'];
    expect(extractHtml(result, earlier)).toBe(earlier[0]!);
  });

  test('throws when no HTML is present anywhere', () => {
    expect(() => extractHtml('Authentication failed: invalid token', [])).toThrow(
      /output contains no HTML tags/,
    );
  });
});
