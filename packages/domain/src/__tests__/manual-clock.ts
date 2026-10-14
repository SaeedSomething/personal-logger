import type { Clock } from '../models.js';

export class ManualClock implements Clock {
  constructor(private utcMs: number) {}

  nowMs(): number {
    return this.utcMs;
  }

  advance(ms: number): void {
    this.utcMs += ms;
  }

  set(utcMs: number): void {
    this.utcMs = utcMs;
  }
}
