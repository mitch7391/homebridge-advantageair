// Loopback-only static prototype viewer. Never starts Homebridge or writes config.
import http from 'node:http';
import process from 'node:process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
const root = new URL('../../', import.meta.url);
const allowed = new Map([
  ['/', 'dev/ui-prototype/preview.html'],
  ['/config.schema.json', 'config.schema.json'],
  ...['index.html', 'app.mjs', 'draft.mjs', 'settings-header.png'].map(file => ['/homebridge-ui/public/' + file, 'homebridge-ui/public/' + file]),
]);
const server = http.createServer(async (request, response) => {
  const file = allowed.get(request.url);
  if (request.method !== 'GET' || !file) {
    response.writeHead(404).end();
    return;
  }
  try {
    const content = await readFile(fileURLToPath(new URL(file, root)));
    const type = file.endsWith('.png') ? 'image/png' : file.endsWith('.mjs') ? 'text/javascript'
      : file.endsWith('.json') ? 'application/json' : 'text/html';
    response.setHeader('Content-Type', type);
    response.setHeader('Cache-Control', 'no-store');
    response.end(content);
  } catch {
    response.writeHead(500).end('Prototype file unavailable.');
  }
});
server.listen(18582, '127.0.0.1', () => {
  process.stdout.write('Isolated preview: http://127.0.0.1:18582 — Ctrl+C to stop.\n');
});
