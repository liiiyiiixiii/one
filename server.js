import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { auditRepository } from './lib/github.js';

const assets = new Map([['/', ['index.html', 'text/html; charset=utf-8']], ['/style.css', ['style.css', 'text/css; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']]]);
export function createServer({ audit = auditRepository } = {}) {
  let busy = false;
  const cache = new Map();
  return http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    response.setHeader('Cache-Control', 'no-store');
    const json = (status, payload) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(payload)); };
    try {
      if (!/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(request.headers.host || '')) { json(403, { error: '请通过 localhost 或 127.0.0.1 访问。' }); return; }
      let url;
      try { url = new URL(request.url, 'http://localhost'); } catch { json(400, { error: '请求地址无效。' }); return; }
      if (request.method === 'GET' && assets.has(url.pathname)) {
        const [name, type] = assets.get(url.pathname);
        const content = await readFile(new URL(name, import.meta.url));
        response.writeHead(200, { 'Content-Type': type }); response.end(content); return;
      }
      if (url.pathname !== '/api/audit') { json(404, { error: '没有这个页面。' }); return; }
      if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); json(405, { error: '请使用 POST 请求。' }); return; }
      if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) { json(403, { error: '请从本地工具页面发起检查。' }); return; }
      if (!request.headers['content-type']?.startsWith('application/json')) { json(415, { error: '请发送 JSON 数据。' }); return; }
      let body = '';
      for await (const chunk of request) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 2048) { json(413, { error: '请求内容过长。' }); return; }
      }
      let input;
      try { input = JSON.parse(body); } catch { json(400, { error: '请求不是有效的 JSON。' }); return; }
      if (!input || typeof input.repository !== 'string') { json(400, { error: '请输入仓库地址。' }); return; }
      const key = input.repository.trim();
      const saved = cache.get(key);
      if (saved && Date.now() - saved.at < 120_000) { json(200, { ...saved.report, cached: true }); return; }
      if (busy) { json(429, { error: '已有仓库正在检查，请稍后重试。' }); return; }
      busy = true;
      try {
        const report = await audit(key, { signal: AbortSignal.timeout(60_000) });
        if (cache.size >= 20) cache.delete(cache.keys().next().value);
        cache.set(key, { at: Date.now(), report });
        json(200, { ...report, cached: false });
      } finally { busy = false; }
    } catch (error) { json(error.status || 500, { error: error.status ? error.message : '检查未完成，请稍后重试。' }); }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const server = createServer();
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用。请设置 PORT 后重试。` : '服务启动失败。'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`ONE 仓库体检：http://127.0.0.1:${port}`));
}
