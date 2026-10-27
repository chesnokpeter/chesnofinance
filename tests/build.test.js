import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildShell } from '../scripts/build.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chesno-build-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'design'));
  await writeFile(path.join(root, 'design/index.html'), '<!doctype html><title>Чесно</title>');
  await writeFile(path.join(root, 'design/app.js'), 'export const value = 1;');
  await writeFile(path.join(root, 'design/styles.css'), 'body { color: white; }');
  await writeFile(path.join(root, 'design/sw.js'), [
    "const CACHE_PREFIX = 'chesno-shell-';",
    'const CACHE_NAME = `${CACHE_PREFIX}initial`;',
    "const BASE = new URL('./', self.location.href);",
    "const APP_SHELL = ['./', './index.html', './app.js', './styles.css'].map(path => new URL(path, BASE).href);",
    "self.addEventListener('install', () => {});"
  ].join('\n'));
  return root;
}

test('shell fingerprint is deterministic and a second build changes no files', async t => {
  const root = await fixture(t);
  const first = await buildShell(root);
  const file = path.join(root, 'design/sw.js');
  const generated = await readFile(file, 'utf8');
  assert.equal(first.changed, true);
  assert.match(first.hash, /^[a-f0-9]{64}$/);
  assert.ok(generated.includes(`const CACHE_NAME = \`\${CACHE_PREFIX}${first.hash}\`;`));
  const second = await buildShell(root);
  assert.equal(second.hash, first.hash);
  assert.equal(second.changed, false);
  assert.equal(await readFile(file, 'utf8'), generated);
  assert.equal((await buildShell(root, { check: true })).hash, first.hash);
});

test('a cached asset change requires a different cache and check does not mutate stale output', async t => {
  const root = await fixture(t);
  const first = await buildShell(root);
  const file = path.join(root, 'design/sw.js');
  const original = await readFile(file, 'utf8');
  await writeFile(path.join(root, 'design/app.js'), 'export const value = 2;');
  await assert.rejects(buildShell(root, { check: true }), /npm run build/);
  assert.equal(await readFile(file, 'utf8'), original);
  const second = await buildShell(root);
  assert.notEqual(second.hash, first.hash);
});

test('worker logic is fingerprinted while its generated cache line is excluded', async t => {
  const root = await fixture(t);
  const first = await buildShell(root);
  const file = path.join(root, 'design/sw.js');
  const generated = await readFile(file, 'utf8');
  await writeFile(file, generated.replace(first.hash, 'hand-edited'));
  const repaired = await buildShell(root);
  assert.equal(repaired.hash, first.hash);
  assert.equal(repaired.changed, true);
  await writeFile(file, `${await readFile(file, 'utf8')}\nself.addEventListener('fetch', () => {});`);
  const logicChange = await buildShell(root);
  assert.notEqual(logicChange.hash, first.hash);
});

test('a missing shell asset aborts without modifying the service worker', async t => {
  const root = await fixture(t);
  const file = path.join(root, 'design/sw.js');
  const original = await readFile(file, 'utf8');
  await rm(path.join(root, 'design/app.js'));
  await assert.rejects(buildShell(root), /ENOENT/);
  assert.equal(await readFile(file, 'utf8'), original);
});

test('CLI --check exits nonzero for stale shell and succeeds after a build', async t => {
  const root = await fixture(t);
  await mkdir(path.join(root, 'scripts'));
  const script = path.join(root, 'scripts/build.mjs');
  await copyFile(fileURLToPath(new URL('../scripts/build.mjs', import.meta.url)), script);
  assert.throws(() => execFileSync(process.execPath, [script, '--check'], { encoding: 'utf8', stdio: 'pipe' }), error => {
    assert.equal(error.status, 1);
    assert.match(error.stderr, /npm run build/);
    return true;
  });
  execFileSync(process.execPath, [script], { encoding: 'utf8', stdio: 'pipe' });
  assert.match(execFileSync(process.execPath, [script, '--check'], { encoding: 'utf8', stdio: 'pipe' }), /проверена/);
});
