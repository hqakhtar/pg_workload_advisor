import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { AppError, connectionUriFromSettings, openDatabase, readDashboard, collectCapture, safeError } from './database.mjs';

const COOKIE = 'citus_local_session';
export function createApp(deps = { openDatabase, readDashboard, collectCapture }) {
  const sessions = new Map();
  const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  const clean = async session => { await session.database?.pool.end().catch(() => {}); session.database = null; };
  const expiry = setInterval(() => { for (const [key, session] of sessions) if (!session.busy && Date.now() - session.lastSeen > 30 * 60 * 1000) { sessions.delete(key); void clean(session); } }, 60000).unref();
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const port = server.address()?.port;
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!hosts.includes(req.headers.host)) return json(res, 403, { error: 'Use the localhost address printed by this app.' });
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed.' });
      const paths = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/help.js': ['help.js', 'text/javascript'], '/local.js': ['local.js', 'text/javascript'] };
      const item = paths[url.pathname]; if (!item) return json(res, 404, { error: 'Not found.' });
      try { const data = await readFile(new URL('./public/' + item[0], import.meta.url)); res.writeHead(200, { 'Content-Type': item[1], 'Cache-Control': 'no-store' }); res.end(req.method === 'HEAD' ? undefined : data); } catch { json(res, 500, { error: 'Application asset unavailable.' }); }
      return;
    }
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'Cross-origin requests are not allowed.' });
    const key = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
    let session = sessions.get(key);
    if (url.pathname === '/api/session' && req.method === 'GET') {
      if (!session) {
        if (sessions.size >= 32) return json(res, 429, { error: 'Too many local sessions. Close unused sessions or restart the app.' });
        const id = randomBytes(32).toString('hex'); session = { csrf: randomBytes(32).toString('hex'), database: null, busy: false, lastSeen: Date.now() }; sessions.set(id, session);
        res.setHeader('Set-Cookie', `${COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/`);
      }
      session.lastSeen = Date.now(); return json(res, 200, { csrf: session.csrf, connected: !!session.database, database: session.database?.info ?? null });
    }
    if (!session || req.headers['x-csrf-token'] !== session.csrf) return json(res, 401, { error: 'Local session expired. Reload the page and reconnect.' });
    session.lastSeen = Date.now();
    if (session.busy) return json(res, 409, { error: 'A database operation is already running. Please wait.' });
    session.busy = true;
    try {
      let body = {};
      if (req.method === 'POST') {
        if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new AppError(415, 'Expected JSON.');
        let bytes = 0, chunks = [];
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 150000) throw new AppError(413, 'Request is too large.'); chunks.push(chunk); }
        try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { throw new AppError(400, 'Invalid JSON.'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError(400, 'Expected a JSON object.');
      }
      if (url.pathname === '/api/connect' && req.method === 'POST') {
        if (body.settings !== undefined && body.connectionString !== undefined) throw new AppError(400, 'Use connection settings or a connection URI, not both.');
        const uri = body.settings !== undefined ? connectionUriFromSettings(body.settings) : body.connectionString;
        const candidate = await deps.openDatabase(uri, body.ca || '');
        await clean(session); session.database = candidate;
        return json(res, 200, { connected: true, database: candidate.info });
      }
      if (url.pathname === '/api/disconnect' && req.method === 'POST') { await clean(session); return json(res, 200, { connected: false }); }
      if (!session.database) throw new AppError(409, 'Connect to PostgreSQL first.');
      const policy = req.method === 'POST' ? (body.policy || 'default') : (url.searchParams.get('policy') || 'default');
      if (typeof policy !== 'string' || policy.length > 128) throw new AppError(400, 'Invalid policy name.');
      if (url.pathname === '/api/dashboard' && req.method === 'GET') return json(res, 200, await deps.readDashboard(session.database.pool, policy));
      if (url.pathname === '/api/collect' && req.method === 'POST') {
        const capture = await deps.collectCapture(session.database.pool, policy);
        // Return the committed capture separately. A later refresh error must not imply collection rolled back.
        return json(res, 200, { collected: true, capture });
      }
      throw new AppError(404, 'Unknown API endpoint.');
    } catch (error) { const result = safeError(error); json(res, result.status, result); }
    finally { session.busy = false; }
  });
  const dispose = async () => { clearInterval(expiry); await Promise.all([...sessions.values()].map(clean)); sessions.clear(); };
  return { server, dispose };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4317);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be between 1024 and 65535.');
  const { server, dispose } = createApp();
  server.listen(port, '127.0.0.1', () => console.log(`PG Workload Advisor: http://127.0.0.1:${port}\nConnection details stay in memory. Press Ctrl+C to stop.`));
  server.on('error', () => { console.error('Could not start the local server. Check whether PORT is already in use.'); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(async () => { await dispose(); process.exit(0); }); server.closeIdleConnections(); });
}
