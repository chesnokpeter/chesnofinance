import { createHash } from 'node:crypto';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const CACHE_LINE = /^const CACHE_NAME = .*;\r?$/gm;
const inside = (root, file) => file === root || file.startsWith(`${root}${path.sep}`);

function applicationAssets(source) {
  const match = source.match(/const APP_SHELL\s*=\s*\[([\s\S]*?)\]\s*\.map\(/);
  if (!match) throw new Error('Не найден список APP_SHELL в design/sw.js.');
  const entries = match[1].split(',').map(item => item.trim()).filter(Boolean);
  if (!entries.length) throw new Error('Список APP_SHELL пуст.');
  return entries.map(entry => {
    const quoted = entry.match(/^(['"])(\.\/[A-Za-z0-9_./-]*)\1$/);
    if (!quoted) throw new Error(`Некорректный путь APP_SHELL: ${entry}`);
    const asset = quoted[2];
    if (asset.split('/').includes('..')) throw new Error(`Путь выходит за папку сайта: ${asset}`);
    return asset;
  });
}

/** Hash exactly the offline shell, excluding its generated cache-name line. */
export async function buildShell(projectRoot = DEFAULT_ROOT, { check = false } = {}) {
  const publicRoot = await realpath(path.resolve(projectRoot, 'design'));
  const workerPath = path.join(publicRoot, 'sw.js');
  const source = await readFile(workerPath, 'utf8');
  const lines = source.match(CACHE_LINE);
  if (lines?.length !== 1) throw new Error('В design/sw.js должна быть одна строка const CACHE_NAME.');
  const assets = applicationAssets(source);
  const digest = createHash('sha256');
  digest.update('chesno-shell-fingerprint-v1\0');
  for (const asset of assets) {
    const assetPath = await realpath(path.resolve(publicRoot, asset === './' ? 'index.html' : asset));
    if (!inside(publicRoot, assetPath)) throw new Error(`Путь выходит за папку сайта: ${asset}`);
    if (assetPath === workerPath) throw new Error('Service Worker не должен кэшировать собственный файл.');
    if (!(await stat(assetPath)).isFile()) throw new Error(`Не найден файл оболочки: ${asset}`);
    const contents = await readFile(assetPath);
    digest.update(`${asset}\0${contents.length}\0`);
    digest.update(contents);
  }
  const workerBody = source.replace(CACHE_LINE, '').replace(/\r\n/g, '\n');
  digest.update(`service-worker\0${Buffer.byteLength(workerBody)}\0`);
  digest.update(workerBody);
  const hash = digest.digest('hex');
  const generatedLine = `const CACHE_NAME = \`\${CACHE_PREFIX}${hash}\`;`;
  const changed = lines[0].replace(/\r$/, '') !== generatedLine;
  if (check && changed) {
    throw new Error('Версия офлайн-оболочки устарела. Выполните npm run build перед публикацией.');
  }
  if (changed && !check) await writeFile(workerPath, source.replace(CACHE_LINE, generatedLine));
  return { hash, changed, assets };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(argument => argument !== '--check') || args.length > 1) {
    console.error('Использование: node scripts/build.mjs [--check]');
    process.exitCode = 1;
  } else {
    try {
      const result = await buildShell(DEFAULT_ROOT, { check: args.includes('--check') });
      console.log(`Офлайн-оболочка ${result.hash.slice(0, 12)}: ${result.assets.length} файлов, ${args.includes('--check') ? 'проверена' : result.changed ? 'обновлена' : 'без изменений'}.`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
