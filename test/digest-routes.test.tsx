import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const tempDirs: string[] = [];

async function makeRunsDir() {
  const runsDir = await mkdtemp(join(tmpdir(), 'rig-digest-routes-'));
  tempDirs.push(runsDir);
  return runsDir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function appFor(runsDir: string) {
  return createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  });
}

describe('digest routes', () => {
  it('serves matching sorted page and JSON digests with original offsets', async () => {
    const runsDir = await makeRunsDir();
    await writeFile(
      join(runsDir, '2026-10-28.jsonl'),
      [
        JSON.stringify({ at: '2026-10-28T09:15:00-04:00', job: 'zeta', status: 'retry', owner: null, error: 'temporary' }),
        JSON.stringify({ at: '2026-10-28T09:20:00-04:00', job: 'alpha', status: 'ok', owner: 'Ada' }),
        JSON.stringify({ at: '2026-10-28T09:18:00-04:00', job: 'zeta', status: 'ok', owner: null }),
      ].join('\n') + '\n',
    );
    const app = appFor(runsDir);

    const jsonResponse = await app.request('/api/digest/2026-10-28');
    expect(jsonResponse.status).toBe(200);
    const digest = await jsonResponse.json();
    expect(digest).toEqual({
      night: '2026-10-28',
      rows: [
        {
          job: 'alpha',
          owner: 'Ada',
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-10-28T09:20:00-04:00',
          lastAt: '2026-10-28T09:20:00-04:00',
        },
        {
          job: 'zeta',
          owner: null,
          runs: 2,
          retries: 1,
          lastStatus: 'ok',
          lastError: 'temporary',
          firstAt: '2026-10-28T09:15:00-04:00',
          lastAt: '2026-10-28T09:18:00-04:00',
        },
      ],
      badLines: 0,
      counts: { ok: 2, retry: 1, fail: 0 },
    });

    const pageResponse = await app.request('/digest/2026-10-28');
    expect(pageResponse.status).toBe(200);
    const html = await pageResponse.text();
    const alphaPosition = html.indexOf('alpha');
    const zetaPosition = html.indexOf('zeta');
    expect(alphaPosition).toBeGreaterThanOrEqual(0);
    expect(zetaPosition).toBeGreaterThan(alphaPosition);
    expect(html).toContain('Ada');
    expect(html).toContain('—');
    expect(html).toContain('09:15:00-04:00');
    expect(html).toContain('09:18:00-04:00');
  });

  it('returns 404 for a missing night on both routes', async () => {
    const app = appFor(await makeRunsDir());

    expect((await app.request('/digest/2026-10-28')).status).toBe(404);
    expect((await app.request('/api/digest/2026-10-28')).status).toBe(404);
  });

  it('renders and returns an empty digest when the night file is empty', async () => {
    const runsDir = await makeRunsDir();
    await writeFile(join(runsDir, '2026-10-28.jsonl'), '');
    const app = appFor(runsDir);

    const jsonResponse = await app.request('/api/digest/2026-10-28');
    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toEqual({
      night: '2026-10-28',
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });

    const pageResponse = await app.request('/digest/2026-10-28');
    expect(pageResponse.status).toBe(200);
    expect(await pageResponse.text()).toContain('nothing ran');
  });

  it('counts malformed lines and still serves the valid row on both routes', async () => {
    const runsDir = await makeRunsDir();
    await writeFile(
      join(runsDir, '2026-10-28.jsonl'),
      '{not json}\n' + JSON.stringify({ at: '2026-10-28T09:15:00+02:00', job: 'build', status: 'fail', owner: null, error: 'broken' }) + '\n',
    );
    const app = appFor(runsDir);

    const jsonResponse = await app.request('/api/digest/2026-10-28');
    expect(jsonResponse.status).toBe(200);
    const digest = await jsonResponse.json();
    expect(digest.badLines).toBe(1);
    expect(digest.rows).toHaveLength(1);
    expect(digest.rows[0]).toMatchObject({ job: 'build', owner: null, lastStatus: 'fail' });

    const pageResponse = await app.request('/digest/2026-10-28');
    expect(pageResponse.status).toBe(200);
    const html = await pageResponse.text();
    expect(html).toContain('build');
    expect(html).toContain('broken');
  });
});
