#!/usr/bin/env bun

import { loadConfig } from '../config/index.ts';
import { startWatcher, runPollCycle } from '../services/watcher.ts';
import { StateStore } from '../state/state-store.ts';

const HELP = `
Azure DevOps Release Note Creator

Usage:
  release-notes <command>

Commands:
  watch        Start the long-running watcher (polls every N minutes)
  run-once     Run a single poll cycle and exit
  reset-state  Clear the processed PR state and exit
  help         Show this help message

Environment variables:
  AZURE_DEVOPS_PAT          Azure DevOps personal access token (required)
  AZURE_DEVOPS_ORG          Azure DevOps organization name (required)
  AZURE_DEVOPS_PROJECT      Azure DevOps project name (required)
  AZURE_DEVOPS_REPO_IDS     Comma-separated repository IDs (required)
  RELEASE_NOTES_FIELD       Custom field name (default: Custom.ReleaseNotes)
  POLL_INTERVAL_MINUTES     Polling interval (default: 15)
  CLAUDE_MODEL              Claude model to use (default: claude-sonnet-4-6)
  RELEASE_NOTE_PROMPT_PATH  Path to prompt file (default: src/prompts/release-note.md)
  STATE_DIR                 State directory (default: .state)
`.trim();

const command = process.argv[2];

switch (command) {
  case 'watch': {
    const config = loadConfig();
    await startWatcher(config);
    break;
  }

  case 'run-once': {
    const config = loadConfig();
    const stateStore = new StateStore(config.stateDir);
    const result = await runPollCycle(config, stateStore);
    console.log(`Done: ${result.processed} processed, ${result.skipped} skipped, ${result.errors} errors`);
    break;
  }

  case 'reset-state': {
    const config = loadConfig();
    const stateStore = new StateStore(config.stateDir);
    stateStore.reset();
    console.log('State has been reset');
    break;
  }

  case 'help':
  default:
    console.log(HELP);
    break;
}
