import type { Arm } from "./types.js";

export interface Job {
  task: string;
  arm: Arm;
  index: number;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function jobKey(job: Job): string {
  return `${job.task}-${job.arm}-${job.index}`;
}

/** Every (task, arm, run) combination in a seeded random order, so the arms are interleaved. */
export function planJobs(options: { tasks: readonly string[]; arms: readonly Arm[]; runs: number; seed: number }): Job[] {
  const jobs: Job[] = [];
  for (const task of options.tasks) {
    for (const arm of options.arms) {
      for (let index = 1; index <= options.runs; index += 1) {
        jobs.push({ task, arm, index });
      }
    }
  }
  const random = mulberry32(options.seed);
  for (let position = jobs.length - 1; position > 0; position -= 1) {
    const other = Math.floor(random() * (position + 1));
    const swap = jobs[position];
    const target = jobs[other];
    if (swap && target) {
      jobs[position] = target;
      jobs[other] = swap;
    }
  }
  return jobs;
}
