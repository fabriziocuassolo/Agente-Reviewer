import type { StageTiming } from "./types.js";

/** Mide cuánto tarda cada etapa del pipeline para mostrarlo al final. */
export class StageTimer {
  readonly timings: StageTiming[] = [];
  private readonly started = Date.now();

  async measure<T>(stage: string, fn: () => T | Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      return await fn();
    } finally {
      this.timings.push({ stage, ms: Date.now() - start });
    }
  }

  total(): StageTiming {
    return { stage: "Total", ms: Date.now() - this.started };
  }
}
