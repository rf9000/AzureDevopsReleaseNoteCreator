import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import type { ProcessedState } from '../types/index.ts';

/** Returns the current time as an ISO string in UTC+1 (Central European Time). */
function nowUtcPlus1(): string {
  const now = new Date();
  const utcPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
  return utcPlus1.toISOString().replace('Z', '+01:00');
}

export class StateStore {
  private filePath: string;
  private state: ProcessedState;
  private processedSet: Set<number>;
  private failedSet: Set<number>;

  constructor(stateDir: string) {
    this.filePath = join(stateDir, 'processed-prs.json');
    this.state = this.load();
    this.processedSet = new Set(this.state.processedPRIds);
    this.failedSet = new Set(this.state.failedPRIds);

    // First run: seed lastRunAt with current time (UTC+1) so we only look forward
    if (!this.state.lastRunAt) {
      this.state.lastRunAt = nowUtcPlus1();
      this.save();
    }
  }

  private load(): ProcessedState {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8');
        const parsed: unknown = JSON.parse(raw);
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          'processedPRIds' in parsed &&
          Array.isArray((parsed as ProcessedState).processedPRIds)
        ) {
          const state = parsed as ProcessedState;
          // Backwards compat: failedPRIds may not exist in older state files
          if (!Array.isArray(state.failedPRIds)) {
            state.failedPRIds = [];
          }
          return state;
        }
      }
    } catch {
      // file doesn't exist or is corrupted JSON — start fresh
    }
    return { processedPRIds: [], failedPRIds: [], lastRunAt: '' };
  }

  save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    this.state.lastRunAt = new Date().toISOString();
    this.state.failedPRIds = Array.from(this.failedSet);
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf-8');
  }

  isProcessed(prId: number): boolean {
    return this.processedSet.has(prId);
  }

  isFailed(prId: number): boolean {
    return this.failedSet.has(prId);
  }

  markProcessed(prId: number): void {
    this.failedSet.delete(prId);
    if (!this.processedSet.has(prId)) {
      this.processedSet.add(prId);
      this.state.processedPRIds.push(prId);
    }
  }

  markFailed(prId: number): void {
    this.failedSet.add(prId);
  }

  reset(): void {
    this.state = { processedPRIds: [], failedPRIds: [], lastRunAt: '' };
    this.processedSet = new Set();
    this.failedSet = new Set();
    this.save();
  }

  get processedCount(): number {
    return this.state.processedPRIds.length;
  }

  get lastRunAt(): string {
    return this.state.lastRunAt;
  }
}
