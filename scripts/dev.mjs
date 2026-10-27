import http from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(fileURLToPath(new URL('../design/', import.meta.url)));
const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT должен быть целым числом от 1 до 65535.');
  process.exit(1);
}
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};
const insideRoot = file => file === root || file.startsWith(`${root}${path.sep}`);
const server = http.createServer(async (request, response) => {
  const fail = (status, text) => {
    response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : text);
  };
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.setHeader('Allow', 'GET, HEAD');
    fail(405, 'Метод не поддерживается.');
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    if (pathname.includes('\0') || pathname.includes('\\')) {
      fail(400, 'Некорректный адрес.');
      return;
    }
    const candidate = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!insideRoot(candidate)) {
      fail(404, 'Не найдено.');
      return;
    }
    const file = await realpath(candidate);
    if (!insideRoot(file)) {
      fail(404, 'Не найдено.');
      return;
    }
    const information = await stat(file);
    if (!information.isFile()) {
      fail(404, 'Не найдено.');
      return;
    }
    response.writeHead(200, {
      'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': information.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(file).on('error', () => response.destroy()).pipe(response);
  } catch (error) {
    if (error instanceof URIError || error?.code === 'ERR_INVALID_URL') fail(400, 'Некорректный адрес.');
    else if (['ENOENT', 'ENOTDIR', 'EACCES'].includes(error?.code)) fail(404, 'Не найдено.');
    else fail(500, 'Не удалось прочитать файл.');
  }
});
server.on('error', error => {
  console.error(`Не удалось запустить локальный сервер (${error.code || 'ошибка'}).`);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log(`Чесно: http://127.0.0.1:${port}`));
