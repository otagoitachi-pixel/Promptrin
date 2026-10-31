// Tiny dev/preview server for dist/ with rebuild-on-change. No dependencies.
//   npm run dev       rebuilds when data, src, scripts or images change
//   npm run preview   serves the existing build only
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, DIST } from './lib/config.mjs';

const PORT = Number(process.env.PORT) || 4173;
const watch = !process.argv.includes('--no-watch');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

let building = false, queued = false;
function build() {
  if (building) { queued = true; return; }
  building = true;
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts/build.mjs')], { stdio: 'inherit', cwd: ROOT });
  child.on('exit', () => { building = false; if (queued) { queued = false; build(); } });
}

if (watch || !fs.existsSync(DIST)) build();
if (watch) {
  let timer;
  for (const dir of ['data', 'src', 'scripts', 'public', 'images']) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) continue;
    fs.watch(full, { recursive: true }, () => { clearTimeout(timer); timer = setTimeout(build, 200); });
  }
  for (const f of ['site.config.json', '.env']) if (fs.existsSync(path.join(ROOT, f))) fs.watch(path.join(ROOT, f), () => { clearTimeout(timer); timer = setTimeout(build, 200); });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.includes('..')) { res.writeHead(400).end('Bad request'); return; }
  let file = path.join(DIST, pathname);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!pathname.endsWith('/')) { res.writeHead(301, { Location: pathname + '/' + url.search }).end(); return; }
    file = path.join(file, 'index.html');
  }
  if (!fs.existsSync(file)) {
    const nf = path.join(DIST, '404.html');
    res.writeHead(404, { 'Content-Type': MIME['.html'] });
    res.end(fs.existsSync(nf) ? fs.readFileSync(nf) : 'Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`\nServing dist/ at http://localhost:${PORT}  (Ctrl+C to stop)`));
