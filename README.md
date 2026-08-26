# Azure DevOps Release Note Creator

Automatically generates release notes for Azure DevOps work items. Uses the Claude Agent SDK to produce Continia-formatted HTML release notes from pull-request and work-item context.

There are two ways a note gets created:

## How it works

### PR-driven flow (automatic)

1. Polls Azure DevOps for completed PRs in configured repositories
2. Finds linked work items missing the `Custom.ReleaseNotes` field
3. Gathers PR context (title, description, changed files, work item type)
4. Calls Claude to generate a release note in Continia HTML format
5. Writes the release note back to the work item

### Tag-driven flow (on request)

Tag any work item with `create-releasenote` (configurable via `RELEASE_NOTE_TAG`) to explicitly
request a note — even for work with no PR, or work whose PR was already processed:

1. Each poll cycle also scans for work items carrying the tag (a project-wide WIQL query)
2. Gathers context from the work item (description + comments) **and** any related PRs
   (title, description, changed files, discussion comments)
3. Generates a note; if the work item already has a release note, the new note is **appended**
4. Removes the `create-releasenote` tag so the item is not reprocessed

The tag flow ignores `ASSIGNED_TO_FILTER` (a tag is an explicit human request). Tag removal is the
idempotency mechanism — in `--dry-run` the tag is left in place, so a dry run can be repeated safely.
Images in descriptions/comments are not processed; the flow is text-only.

## Setup

```bash
bun install
cp .env.example .env
# Edit .env with your values
```

### Required environment variables

| Variable | Description |
|----------|-------------|
| `AZURE_DEVOPS_PAT` | Personal access token (Code Read + Work Items Read/Write) |
| `AZURE_DEVOPS_ORG` | Organization name (e.g. `continia-software`) |
| `AZURE_DEVOPS_PROJECT` | Project name (e.g. `Continia Software`) |
| `AZURE_DEVOPS_REPO_IDS` | Comma-separated repository GUIDs |

### Optional environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RELEASE_NOTES_FIELD` | `Custom.ReleaseNotes` | Work item field to write to |
| `RELEASE_NOTE_TAG` | `create-releasenote` | Work item tag that requests a note (tag-driven flow) |
| `POLL_INTERVAL_MINUTES` | `25` | Polling interval for watch mode |
| `CLAUDE_MODEL` | `claude-opus-4-6` | Claude model to use |
| `RELEASE_NOTE_PROMPT_PATH` | `.claude/skills/do-generate-release-note/SKILL.md` | Path to the prompt file (see [Release note format](#release-note-format)) |
| `STATE_DIR` | `.state` | Directory for processed PR state |
| `DEBUG` | _(unset)_ | Set to any value to enable verbose SDK message logging (see [Debugging](#debugging)) |

## Commands

### `watch` — Long-running poller

Polls for completed PRs every N minutes and generates release notes continuously. Exits cleanly on Ctrl+C.

```bash
bun run src/cli/index.ts watch
bun run src/cli/index.ts watch --dry-run   # generate but don't write
```

### `run-once` — Single poll cycle

Runs one poll cycle across all configured repos and exits.

```bash
bun run src/cli/index.ts run-once
bun run src/cli/index.ts run-once --dry-run
```

### `test-pr <id>` — Test a single PR

Fetches a specific PR by ID, generates release notes for its linked work items, and prints the result. Always runs in dry-run mode (no writes).

```bash
bun run src/cli/index.ts test-pr 43747
```

### `process-pr <id>` — Process a single PR (production)

Fetches a specific PR by ID and generates release notes for its linked work items. Unlike `test-pr`, this writes the release notes to Azure DevOps by default.

```bash
bun run src/cli/index.ts process-pr 43747
bun run src/cli/index.ts process-pr 43747 --dry-run   # preview without writing
```

### `process-workitem <id>` — Process a single tagged work item

Fetches a work item by ID, gathers context from it and any related PRs, generates a release note,
appends it to any existing note, and removes the `create-releasenote` tag. Writes by default;
`--dry-run` generates and prints without writing (and leaves the tag in place).

```bash
bun run src/cli/index.ts process-workitem 51234
bun run src/cli/index.ts process-workitem 51234 --dry-run   # preview without writing
```

### `reset-state` — Clear processed state

Clears the local state file so all PRs are reprocessed on the next run.

```bash
bun run src/cli/index.ts reset-state
```

### `--dry-run` flag

Available on `watch`, `run-once`, and `process-pr`. Generates release notes via Claude and prints them, but skips writing to Azure DevOps.

## Release note format

Release notes are header-free flowing-prose HTML (the Description cell of a release-note table row). The
prompt is a single Claude Code skill folder, `.claude/skills/do-generate-release-note/`, so it can be
copied to another repo or shared with the technical writers as one unit:

| File (in the skill folder) | Owner | Contents |
|----------------------------|-------|----------|
| `SKILL.md` | this repo | The prompt, invocable as `/do-generate-release-note`. Short task statement that pulls in the two files below via `@path` lines. |
| `changelog-style-guide.md` | technical writers | The Continia changelog style guide (formatting, voice, terminology, self-check). Authoritative — replace it wholesale when the writers publish a new version. |
| `generation-rules.md` | this repo | Everything the style guide does not cover: what to write about (primary change, hard-omit list, "Previously, …" shape), product conventions, reference examples, approval flow. If it conflicts with the style guide, the style guide wins. |

Claude Code expands the `@path` lines itself when the skill is run interactively; the app does the same
in `loadSystemPrompt()` (`src/services/release-note-generator.ts`) when it reads `SKILL.md` as a system
prompt. `@` paths are resolved from the working directory (Claude Code's convention), so the skill folder
must stay at `.claude/skills/do-generate-release-note/` in whichever repo it is copied to. A missing
include is an error.

## Debugging

Enable verbose SDK message logging to diagnose issues like `error_max_turns`:

**PowerShell (Windows):**
```powershell
$env:DEBUG="true"; bun run src/cli/index.ts watch
```

**bash/zsh (Linux/macOS):**
```bash
DEBUG=true bun run src/cli/index.ts watch
```

To unset on PowerShell afterwards: `Remove-Item Env:DEBUG`

## Development

```bash
bun run typecheck      # TypeScript type checking
bun run test:unit      # Run unit tests (no credentials needed)
bun run test:integration  # Run integration tests (requires .env)
```
