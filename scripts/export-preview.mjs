import { spawn } from 'node:child_process';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// Export through the running service. Keep the generated page outside Git.
const repo = fileURLToPath(new URL('../', import.meta.url));
if (!process.argv[2]) throw new Error('Usage: node scripts/export-preview.mjs <directory outside repo>');
const output = resolve(process.argv[2]);
await mkdir(output, { recursive: true });
const pathFromRepo = relative(await realpath(repo), await realpath(output));
if (!(pathFromRepo.startsWith('../') || isAbsolute(pathFromRepo))) {
  throw new Error('Preview directory must be outside the repository');
}

const listener = createServer();
await new Promise((resolve, reject) => {
  listener.once('error', reject);
  listener.listen(0, '127.0.0.1', resolve);
});
const port = listener.address().port;
await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
const server = spawn(process.execPath, ['--import', 'tsx', '--env-file-if-exists=.env', 'src/server.ts'], {
  cwd: repo,
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let diagnostic = '';
server.stdout.on('data', (chunk) => { diagnostic += chunk; });
server.stderr.on('data', (chunk) => { diagnostic += chunk; });
const stopped = new Promise((resolve) => server.once('exit', resolve));

try {
  const url = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Service exited: ${diagnostic}`);
    try {
      ready = (await fetch(`${url}/health`, { signal: AbortSignal.timeout(500) })).ok;
    } catch { /* Wait for the local listener. */ }
    if (ready) break;
    await delay(100);
  }
  if (!ready) throw new Error(`Service did not start: ${diagnostic}`);
  const response = await fetch(`${url}/digest/2026-10-28`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Digest export returned HTTP ${response.status}`);
  const html = await response.text();
  if (!html.toLowerCase().startsWith('<!doctype html>') || /<script\b/i.test(html)) {
    throw new Error('Expected a self-contained HTML page without scripts');
  }
  await writeFile(resolve(output, 'index.html'), html);
  console.log(`Saved digest HTML to ${resolve(output, 'index.html')}`);
} finally {
  if (server.exitCode === null) server.kill('SIGTERM');
  await stopped;
}
