/**
 * Polling-based watcher that periodically checks for completed PRs
 * and triggers release note generation.
 *
 * Uses dependency injection so tests can supply mock implementations
 * without touching module resolution.
 */

import type {
  AppConfig,
  AzureDevOpsPullRequest,
  PRProcessResult,
} from '../types/index.ts';
import { StateStore } from '../state/state-store.ts';
import * as sdk from '../sdk/azure-devops-client.ts';
import * as proc from './pr-processor.ts';
import * as wiProc from './work-item-processor.ts';

// ---------------------------------------------------------------------------
// Dependency injection interface
// ---------------------------------------------------------------------------

export interface WatcherDeps {
  listCompletedPRs: (
    config: AppConfig,
    repoId: string,
    top?: number,
  ) => Promise<AzureDevOpsPullRequest[]>;

  processPR: (
    config: AppConfig,
    pr: AzureDevOpsPullRequest,
  ) => Promise<PRProcessResult>;

  scanTaggedWorkItems: (
    config: AppConfig,
  ) => Promise<{ processed: number; skipped: number; errors: number }>;
}

/** Default production dependencies wired to the real modules. */
const defaultDeps: WatcherDeps = {
  listCompletedPRs: sdk.listCompletedPRs,
  processPR: proc.processPR,
  scanTaggedWorkItems: wiProc.scanTaggedWorkItems,
};

// ---------------------------------------------------------------------------
// Logging helper
// ---------------------------------------------------------------------------

function log(message: string): void {
  const ts = new Date(Date.now() + 3600000).toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] ${message}`);
}

// ---------------------------------------------------------------------------
// Single poll cycle
// ---------------------------------------------------------------------------

export async function runPollCycle(
  config: AppConfig,
  stateStore: StateStore,
  deps: WatcherDeps = defaultDeps,
): Promise<{ processed: number; skipped: number; errors: number }> {
  let totalProcessed = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const repoId of config.repoIds) {
    log(`Polling repo ${repoId}...`);

    const prs = await deps.listCompletedPRs(config, repoId);
    const lookbackCutoff = new Date(Date.now() - config.lookbackDays * 24 * 60 * 60 * 1000).toISOString();
    let skippedByDate = 0;
    const newPRs = prs.filter(pr => {
      if (stateStore.isProcessed(pr.pullRequestId)) return false;
      // Always retry PRs that previously failed, regardless of date
      if (stateStore.isFailed(pr.pullRequestId)) return true;
      // Skip PRs closed before the lookback window (ignore old historical data)
      if (pr.closedDate && pr.closedDate <= lookbackCutoff) {
        skippedByDate++;
        return false;
      }
      return true;
    });

    log(`  Found ${prs.length} completed PRs, ${newPRs.length} new, ${skippedByDate} before ${config.lookbackDays}-day lookback`);

    for (const pr of newPRs) {
      try {
        const result = await deps.processPR(config, pr);
        totalProcessed += result.processed;
        totalSkipped += result.skipped;
        totalErrors += result.errors;

        if (result.errors === 0) {
          stateStore.markProcessed(pr.pullRequestId);
        } else {
          stateStore.markFailed(pr.pullRequestId);
        }
      } catch (err) {
        log(`  PR #${pr.pullRequestId}: Fatal error — ${err}`);
        totalErrors++;
        stateStore.markFailed(pr.pullRequestId);
      }
    }
  }

  // Tag-driven flow: scan work items tagged for release-note creation. WIQL is
  // project-wide, so this runs once per cycle (not per repo). Tag removal is the
  // idempotency mechanism, so there is no per-work-item state to persist.
  try {
    const tagResult = await deps.scanTaggedWorkItems(config);
    totalProcessed += tagResult.processed;
    totalSkipped += tagResult.skipped;
    totalErrors += tagResult.errors;
  } catch (err) {
    log(`  Tag scan failed: ${err}`);
    totalErrors++;
  }

  // Always advance lastRunAt — failed PRs are tracked explicitly in failedPRIds
  // and bypass the date filter, so the date never drifts.
  stateStore.save();
  return { processed: totalProcessed, skipped: totalSkipped, errors: totalErrors };
}

// ---------------------------------------------------------------------------
// Interruptible sleep
// ---------------------------------------------------------------------------

function sleep(ms: number, signal: { aborted: boolean }): Promise<void> {
  return new Promise(resolve => {
    const checkInterval = 1000;
    let elapsed = 0;
    const timer = setInterval(() => {
      elapsed += checkInterval;
      if (signal.aborted || elapsed >= ms) {
        clearInterval(timer);
        resolve();
      }
    }, checkInterval);
  });
}

// ---------------------------------------------------------------------------
// Long-running watcher loop
// ---------------------------------------------------------------------------

export async function startWatcher(config: AppConfig): Promise<void> {
  const stateStore = new StateStore(config.stateDir);
  const signal = { aborted: false };

  const shutdown = () => {
    log('Shutting down...');
    signal.aborted = true;
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  log(`Starting watcher — polling every ${config.pollIntervalMinutes} minutes`);
  log(`Watching ${config.repoIds.length} repo(s)`);
  log(`${stateStore.processedCount} PRs already processed`);
  log(`Lookback window: ${config.lookbackDays} days`);

  while (!signal.aborted) {
    try {
      const result = await runPollCycle(config, stateStore);
      log(`Cycle complete: ${result.processed} processed, ${result.skipped} skipped, ${result.errors} errors`);
    } catch (err) {
      log(`Cycle failed: ${err}`);
    }

    if (!signal.aborted) {
      log(`Sleeping ${config.pollIntervalMinutes} minutes...`);
      await sleep(config.pollIntervalMinutes * 60 * 1000, signal);
    }
  }

  log('Watcher stopped');
}
