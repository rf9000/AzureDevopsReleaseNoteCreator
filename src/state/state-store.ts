import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import type { ProcessedState } from '../types/index.ts';

export class StateStore {
  private filePath: string;
  private state: ProcessedState;

  constructor(stateDir: string) {
    this.filePath = join(stateDir, 'processed-prs.json');
    this.state = this.load();
  }

  private load(): ProcessedState {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw) as ProcessedState;
        return parsed;
      }
    } catch {
      // file doesn't exist or is corrupted JSON — start fresh
    }
    return { processedPRIds: [], lastRunAt: '' };
  }

  save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    this.state.lastRunAt = new Date().toISOString();
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf-8');
  }

  isProcessed(prId: number): boolean {
    return this.state.processedPRIds.includes(prId);
  }

  markProcessed(prId: number): void {
    if (!this.state.processedPRIds.includes(prId)) {
      this.state.processedPRIds.push(prId);
    }
  }

  reset(): void {
    this.state = { processedPRIds: [], lastRunAt: '' };
    this.save();
  }

  get processedCount(): number {
    return this.state.processedPRIds.length;
  }
}
