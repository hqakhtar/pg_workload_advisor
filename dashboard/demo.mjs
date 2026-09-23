import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Demo mode has no database driver imports and needs no npm install.
export function demoHTML(source) {
  let html = source.replace('<script defer src="app.js"></script>', '<script defer src="demo-config.js"></script><script defer src="app.js"></script>')
    .replace('<script defer src="local.js"></script>', '<script defer src="local.js"></script><script defer src="demo.js"></script>');
  for (const id of ['pg-password', 'connection-uri', 'ca-cert']) html = html.replace('id="' + id + '"', 'id="' + id + '" disabled');
  return html.replace('id="connection-preview-note" class="connection-notice" hidden', 'id="connection-preview-note" class="connection-notice"')
    .replace('id="connection-privacy-note"', 'id="connection-privacy-note" hidden')
    .replace('id="connect-submit" class="primary">Connect & load data', 'id="connect-submit" class="primary" disabled>Requires PostgreSQL mode');
}

export function createDemoServer() {
  const assets = new Map([
    ['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']],
    ...['app.js', 'help.js', 'local.js', 'demo.js', 'demo-config.js'].map(file => ['/' + file, [file, 'text/javascript']]),
    ['/style.css', ['style.css', 'text/css']]
  ]);
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const port = server.address()?.port;
    if (!['127.0.0.1:' + port, 'localhost:' + port].includes(req.headers.host)) { res.writeHead(403); res.end('Use the localhost address printed by the app.'); return; }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end('Demo mode does not accept database requests.'); return; }
    const item = assets.get(new URL(req.url, 'http://' + req.headers.host).pathname);
    if (!item) { res.writeHead(404); res.end('Not found.'); return; }
    try {
      let data = await readFile(new URL('./public/' + item[0], import.meta.url));
      if (item[0] === 'index.html') data = demoHTML(data.toString());
      res.writeHead(200, { 'Content-Type': item[1] + '; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { res.writeHead(500); res.end('Application asset unavailable.'); }
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4318);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be between 1024 and 65535.');
  const server = createDemoServer();
  server.listen(port, '127.0.0.1', () => console.log('PG Workload Advisor demo: http://127.0.0.1:' + port + '\nSample data only; no PostgreSQL connection. Press Ctrl+C to stop.'));
  server.on('error', () => { console.error('Could not start demo mode. Check whether PORT is already in use.'); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(() => process.exit(0)); server.closeIdleConnections(); });
}
