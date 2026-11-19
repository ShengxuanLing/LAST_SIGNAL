// Minimal static file server for frozen build evidence (own port only).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = process.argv[2];
const port = Number(process.argv[3]);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(root, p));
    if (!file.startsWith(normalize(root))) { res.statusCode = 403; res.end(); return; }
    const s = await stat(file);
    if (!s.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream');
    res.setHeader('cache-control', 'no-store');
    res.end(body);
  } catch {
    try {
      const body = await readFile(join(root, 'index.html'));
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(body);
    } catch { res.statusCode = 404; res.end('not found'); }
  }
}).listen(port, '127.0.0.1', () => process.stdout.write(`STATIC http://localhost:${port} root=${root}\n`));
