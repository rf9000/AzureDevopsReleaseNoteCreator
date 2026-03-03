# Azure DevOps Release Note Creator

Automatically generates release notes for Azure DevOps work items linked to completed pull requests. Uses the Claude Agent SDK to produce Continia-formatted HTML release notes from PR context.

## How it works

1. Polls Azure DevOps for completed PRs in configured repositories
2. Finds linked work items missing the `Custom.ReleaseNotes` field
3. Gathers PR context (title, description, changed files, work item type)
4. Calls Claude to generate a release note in Continia HTML format
5. Writes the release note back to the work item

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
| `POLL_INTERVAL_MINUTES` | `15` | Polling interval for watch mode |
| `CLAUDE_MODEL` | `claude-opus-4-6` | Claude model to use |
| `RELEASE_NOTE_PROMPT_PATH` | `.claude/commands/do-CreateReleaseNoteContinia.md` | Path to the prompt file |
| `STATE_DIR` | `.state` | Directory for processed PR state |

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

### `reset-state` — Clear processed state

Clears the local state file so all PRs are reprocessed on the next run.

```bash
bun run src/cli/index.ts reset-state
```

### `--dry-run` flag

Available on `watch` and `run-once`. Generates release notes via Claude and prints them, but skips writing to Azure DevOps.

## Release note format

Release notes follow the Continia HTML format defined in `.claude/commands/do-CreateReleaseNoteContinia.md`:

- **Features/User Stories** get Why / What / Impact sections
- **Bug Fixes** get What / Where-When / Resolution sections

## Development

```bash
bun run typecheck      # TypeScript type checking
bun run test:unit      # Run unit tests (no credentials needed)
bun run test:integration  # Run integration tests (requires .env)
```
