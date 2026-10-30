import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const temporaryDirectories: string[] = [];
function tempRuns(contents?: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  temporaryDirectories.push(directory);
  if (contents !== undefined) writeFileSync(join(directory, '2026-10-28.jsonl'), contents);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('readNight', () => {
  it('reads the real night without dropping null owners, failures or recovered errors', () => {
    const digest = readNight(fileURLToPath(new URL('../runs/', import.meta.url)), '2026-10-28');
    expect(digest).toEqual({
      night: '2026-10-28',
      badLines: 1,
      counts: { ok: 10, retry: 4, fail: 1 },
      rows: [
        { job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00' },
        { job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503',
          firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00' },
        { job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held',
          firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00' },
        { job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'quota exceeded',
          firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00' },
        { job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00' },
      ],
    });
  });

  it('distinguishes missing and empty nights', () => {
    expect(readNight(tempRuns(), '2026-10-28')).toBeNull();
    expect(readNight(tempRuns(' \n\r\n'), '2026-10-28')).toEqual({
      night: '2026-10-28', rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts malformed JSON and invalid records while continuing through CRLF and blank lines', () => {
    const valid = { at: '2026-10-28T23:00:00+01:00', job: 'a', status: 'ok', owner: null };
    const invalid = [null, [], {}, { ...valid, at: '2026-02-30T23:00:00Z' },
      { ...valid, at: '2026-10-28T23:00:00' }, { ...valid, job: '' }, { ...valid, job: 1 },
      { ...valid, status: 'unknown' }, { ...valid, owner: 1 }, { ...valid, error: null },
      { at: valid.at, job: valid.job, status: valid.status }];
    const contents = ['{broken', ...invalid.map((record) => JSON.stringify(record)), '', JSON.stringify(valid)].join('\r\n');
    const digest = readNight(tempRuns(contents), '2026-10-28');
    expect(digest?.badLines).toBe(invalid.length + 1);
    expect(digest?.rows).toHaveLength(1);
    expect(digest?.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
  });

  it('orders events by instant while preserving offsets and resolving equal times by file order', () => {
    const runs = [
      { at: '2026-10-29T01:00:00+02:00', job: 'job', status: 'fail', owner: 'first', error: 'late error' },
      { at: '2026-10-28T22:00:00Z', job: 'job', status: 'retry', owner: 'earlier', error: 'early error' },
      { at: '2026-10-28T18:00:00-05:00', job: 'job', status: 'ok', owner: null },
    ];
    const digest = readNight(tempRuns(runs.map((run) => JSON.stringify(run)).join('\n')), '2026-10-28');
    expect(digest?.rows).toEqual([{
      job: 'job', owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: 'late error',
      firstAt: '2026-10-28T22:00:00Z', lastAt: '2026-10-28T18:00:00-05:00',
    }]);
  });

  it.each(['../2026-10-28', '/2026-10-28', '2026-10-28.jsonl', '2026-02-30', '2026-13-01', '2026-1-01'])
  ('rejects unsafe or invalid night names: %s', (night) => {
    expect(readNight(tempRuns(''), night)).toBeNull();
  });

  it('does not hide filesystem errors as a missing night', () => {
    const directory = tempRuns();
    mkdirSync(join(directory, '2026-10-28.jsonl'));
    expect(() => readNight(directory, '2026-10-28')).toThrow();
  });
});
