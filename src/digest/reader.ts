import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, ReadNight, RunStatus } from './types.js';

type Run = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

function validNight(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validTime(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    && validNight(value.slice(0, 10))
    && Number.isFinite(Date.parse(value));
}

function parseRun(line: string): Run | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  if (!('at' in value) || !validTime(value.at)) return null;
  if (!('job' in value) || typeof value.job !== 'string' || !value.job.trim()) return null;
  if (!('status' in value) || (value.status !== 'ok' && value.status !== 'retry' && value.status !== 'fail')) return null;
  if (!('owner' in value) || (value.owner !== null && typeof value.owner !== 'string')) return null;
  const error = 'error' in value ? value.error : undefined;
  if (error !== undefined && typeof error !== 'string') return null;
  return {
    at: value.at,
    job: value.job,
    status: value.status,
    owner: value.owner,
    ...(error !== undefined ? { error } : {}),
  };
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!validNight(night)) return null;
  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const jobs = new Map<string, { row: DigestRow; first: number; last: number; lastError: number }>();
  const counts = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const run = parseRun(line);
    if (!run) {
      badLines++;
      continue;
    }
    counts[run.status]++;
    const time = Date.parse(run.at);
    const existing = jobs.get(run.job);
    if (!existing) {
      jobs.set(run.job, {
        row: {
          job: run.job,
          owner: run.owner,
          runs: 1,
          retries: run.status === 'retry' ? 1 : 0,
          lastStatus: run.status,
          lastError: run.error ?? null,
          firstAt: run.at,
          lastAt: run.at,
        },
        first: time,
        last: time,
        lastError: run.error === undefined ? -Infinity : time,
      });
      continue;
    }
    const { row } = existing;
    row.runs++;
    if (run.status === 'retry') row.retries++;
    if (time < existing.first) {
      row.firstAt = run.at;
      existing.first = time;
    }
    if (time >= existing.last) {
      row.lastAt = run.at;
      row.lastStatus = run.status;
      row.owner = run.owner;
      existing.last = time;
    }
    if (run.error !== undefined && time >= existing.lastError) {
      row.lastError = run.error;
      existing.lastError = time;
    }
  }

  const rows = [...jobs.values()].map(({ row }) => row)
    .sort((left, right) => left.job < right.job ? -1 : left.job > right.job ? 1 : 0);
  return { night, rows, badLines, counts };
};
